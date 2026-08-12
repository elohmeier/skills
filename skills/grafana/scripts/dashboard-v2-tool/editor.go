package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	dashv2 "github.com/grafana/grafana/apps/dashboard/pkg/apis/dashboard/v2"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/santhosh-tekuri/jsonschema/v6/kind"
	"k8s.io/kube-openapi/pkg/validation/spec"
)

const grafanaEditorSchemaURL = "https://grafana.local/schemas/dashboard-v2-editor.json"

var kindDefinitionPattern = regexp.MustCompile(`_Dashboard(\w+Kind)$`)

func validateGrafanaEditorCompatibility(data []byte, inputFormat string) error {
	var input any
	if err := json.Unmarshal(data, &input); err != nil {
		return fmt.Errorf("decode %s input for Grafana editor validation: %w", inputFormat, err)
	}
	if inputFormat == "resource" {
		resource, ok := input.(map[string]any)
		if !ok {
			return errors.New("Grafana editor validation requires a JSON object")
		}
		var found bool
		input, found = resource["spec"]
		if !found {
			return errors.New("Grafana editor validation requires resource.spec")
		}
	}

	schemaDocument, err := grafanaEditorSchemaDocument()
	if err != nil {
		return err
	}
	compiler := jsonschema.NewCompiler()
	compiler.DefaultDraft(jsonschema.Draft7)
	if err := compiler.AddResource(grafanaEditorSchemaURL, schemaDocument); err != nil {
		return fmt.Errorf("register Grafana editor schema: %w", err)
	}
	schema, err := compiler.Compile(grafanaEditorSchemaURL)
	if err != nil {
		return fmt.Errorf("compile Grafana editor schema: %w", err)
	}
	if err := schema.Validate(input); err != nil {
		var validationErr *jsonschema.ValidationError
		if !errors.As(err, &validationErr) {
			return fmt.Errorf("Grafana editor compatibility validation failed: %w", err)
		}
		problems := editorValidationProblems(validationErr)
		return fmt.Errorf("Grafana editor compatibility validation failed: %s", strings.Join(problems, "; "))
	}
	return nil
}

func grafanaEditorSchemaDocument() (map[string]any, error) {
	definitions := map[string]any{}
	openAPIDefinitions := dashv2.GetOpenAPIDefinitions(func(name string) spec.Ref {
		return spec.MustCreateRef("#/definitions/" + escapeJSONPointerToken(editorDefinitionKey(name)))
	})
	for name, definition := range openAPIDefinitions {
		schema, err := schemaAsMap(definition.Schema)
		if err != nil {
			return nil, fmt.Errorf("encode Grafana OpenAPI definition %s: %w", name, err)
		}
		definitions[editorDefinitionKey(name)] = flattenSingleRefAllOf(schema)
	}

	rootName := editorDefinitionKey((dashv2.DashboardSpec{}).OpenAPIModelName())
	root, ok := definitions[rootName].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("Grafana OpenAPI definition %s is missing", rootName)
	}
	document := cloneMap(root)
	document["$schema"] = "http://json-schema.org/draft-07/schema#"
	document["definitions"] = definitions
	fixEditorOpenAPIMismatches(definitions)
	return document, nil
}

func schemaAsMap(value any) (map[string]any, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func editorDefinitionKey(name string) string {
	return strings.ReplaceAll(name, ".", "_")
}

func escapeJSONPointerToken(value string) string {
	value = strings.ReplaceAll(value, "~", "~0")
	return strings.ReplaceAll(value, "/", "~1")
}

func cloneMap(input map[string]any) map[string]any {
	result := make(map[string]any, len(input))
	for key, value := range input {
		result[key] = value
	}
	return result
}

func flattenSingleRefAllOf(schema map[string]any) map[string]any {
	result := cloneMap(schema)
	allOf, ok := result["allOf"].([]any)
	if !ok || len(allOf) != 1 {
		return result
	}
	item, ok := allOf[0].(map[string]any)
	if !ok {
		return result
	}
	ref, ok := item["$ref"].(string)
	if !ok {
		return result
	}
	result["$ref"] = ref
	delete(result, "allOf")
	return result
}

func fixEditorOpenAPIMismatches(definitions map[string]any) {
	fixEditorKindConstraints(definitions)
	fixEditorScalarUnions(definitions)
	fixEditorOpaqueMaps(definitions)
	fixEditorAnyValueProperties(definitions)
	fixEditorDiscriminatedUnions(definitions)
}

func fixEditorKindConstraints(definitions map[string]any) {
	for key, rawSchema := range definitions {
		schema, ok := rawSchema.(map[string]any)
		if !ok {
			continue
		}
		kindProperty := nestedMap(schema, "properties", "kind")
		if kindProperty == nil || kindProperty["type"] != "string" {
			continue
		}
		match := kindDefinitionPattern.FindStringSubmatch(key)
		if len(match) == 2 {
			if match[1] != "TransformationKind" {
				kindProperty["const"] = strings.TrimSuffix(match[1], "Kind")
			}
			continue
		}
		if strings.HasSuffix(key, "_DashboardElementReference") {
			kindProperty["const"] = "ElementReference"
		}
	}
}

func fixEditorScalarUnions(definitions map[string]any) {
	replacements := map[string]map[string]any{
		"DashboardStringOrArrayOfString": {
			"oneOf": []any{
				map[string]any{"type": "string"},
				map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
			},
		},
		"DashboardStringOrFloat64": {
			"oneOf": []any{map[string]any{"type": "string"}, map[string]any{"type": "number"}},
		},
	}
	for key, rawSchema := range definitions {
		schema, ok := rawSchema.(map[string]any)
		if !ok {
			continue
		}
		for suffix, replacement := range replacements {
			if !strings.HasSuffix(key, "_"+suffix) {
				continue
			}
			delete(schema, "type")
			delete(schema, "properties")
			delete(schema, "required")
			for replacementKey, value := range replacement {
				schema[replacementKey] = value
			}
			break
		}
	}
}

func fixEditorOpaqueMaps(definitions map[string]any) {
	properties := map[string][]string{
		"DashboardFieldConfig":         {"custom"},
		"DashboardVizConfigSpec":       {"options"},
		"DashboardDataQueryKind":       {"spec"},
		"DashboardAnnotationQuerySpec": {"legacyOptions"},
	}
	for key, rawSchema := range definitions {
		schema, ok := rawSchema.(map[string]any)
		if !ok {
			continue
		}
		for suffix, names := range properties {
			if !strings.HasSuffix(key, "_"+suffix) {
				continue
			}
			schemaProperties := mapValue(schema["properties"])
			for _, name := range names {
				if _, found := schemaProperties[name]; found {
					schemaProperties[name] = map[string]any{"type": "object", "additionalProperties": true}
				}
			}
		}
	}
}

func fixEditorAnyValueProperties(definitions map[string]any) {
	properties := map[string][]string{
		"DashboardDynamicConfigValue":    {"value"},
		"DashboardMatcherConfig":         {"options"},
		"DashboardDataTransformerConfig": {"options"},
	}
	for key, rawSchema := range definitions {
		schema, ok := rawSchema.(map[string]any)
		if !ok {
			continue
		}
		for suffix, names := range properties {
			if !strings.HasSuffix(key, "_"+suffix) {
				continue
			}
			schemaProperties := mapValue(schema["properties"])
			for _, name := range names {
				if _, found := schemaProperties[name]; found {
					schemaProperties[name] = map[string]any{}
				}
			}
		}
	}
}

type editorUnionVariant struct {
	value string
	ref   string
}

func fixEditorDiscriminatedUnions(definitions map[string]any) {
	for key, rawSchema := range definitions {
		schema, ok := rawSchema.(map[string]any)
		if !ok {
			continue
		}
		if strings.Contains(key, "KindOr") {
			variants := collectEditorKindVariants(mapValue(schema["properties"]))
			if len(variants) > 0 {
				applyEditorDiscriminatedUnion(schema, "kind", variants, []any{"kind", "spec"})
				continue
			}
		}

		const suffix = "DashboardValueMapOrRangeMapOrRegexMapOrSpecialValueMap"
		if !strings.HasSuffix(key, "_"+suffix) {
			continue
		}
		prefix := strings.TrimSuffix(key, suffix)
		candidates := []struct {
			value     string
			refSuffix string
		}{
			{value: "value", refSuffix: "DashboardValueMap"},
			{value: "range", refSuffix: "DashboardRangeMap"},
			{value: "regex", refSuffix: "DashboardRegexMap"},
			{value: "special", refSuffix: "DashboardSpecialValueMap"},
		}
		variants := make([]editorUnionVariant, 0, len(candidates))
		for _, candidate := range candidates {
			definitionKey := prefix + candidate.refSuffix
			if _, found := definitions[definitionKey]; found {
				variants = append(variants, editorUnionVariant{
					value: candidate.value,
					ref:   "#/definitions/" + escapeJSONPointerToken(definitionKey),
				})
			}
		}
		if len(variants) > 0 {
			applyEditorDiscriminatedUnion(schema, "type", variants, nil)
		}
	}
}

func collectEditorKindVariants(properties map[string]any) []editorUnionVariant {
	if len(properties) == 0 {
		return nil
	}
	variants := make([]editorUnionVariant, 0, len(properties))
	for _, rawProperty := range properties {
		property, ok := rawProperty.(map[string]any)
		if !ok {
			return nil
		}
		ref, ok := property["$ref"].(string)
		if !ok {
			return nil
		}
		match := kindDefinitionPattern.FindStringSubmatch(ref)
		if len(match) != 2 {
			continue
		}
		variants = append(variants, editorUnionVariant{value: strings.TrimSuffix(match[1], "Kind"), ref: ref})
	}
	return variants
}

func applyEditorDiscriminatedUnion(schema map[string]any, discriminator string, variants []editorUnionVariant, required []any) {
	delete(schema, "type")
	delete(schema, "properties")
	delete(schema, "required")
	schema["type"] = "object"
	if required == nil {
		required = []any{discriminator}
	}
	schema["required"] = required
	enum := make([]any, 0, len(variants))
	conditions := make([]any, 0, len(variants))
	for _, variant := range variants {
		enum = append(enum, variant.value)
		conditions = append(conditions, map[string]any{
			"if": map[string]any{"properties": map[string]any{
				discriminator: map[string]any{"const": variant.value},
			}},
			"then": map[string]any{"$ref": variant.ref},
		})
	}
	schema["properties"] = map[string]any{
		discriminator: map[string]any{"type": "string", "enum": enum},
	}
	schema["allOf"] = conditions
}

func nestedMap(input map[string]any, keys ...string) map[string]any {
	current := input
	for _, key := range keys {
		next, ok := current[key].(map[string]any)
		if !ok {
			return nil
		}
		current = next
	}
	return current
}

func mapValue(value any) map[string]any {
	result, _ := value.(map[string]any)
	return result
}

func editorValidationProblems(root *jsonschema.ValidationError) []string {
	leaves := editorValidationLeaves(root)
	problems := make([]string, 0, len(leaves))
	seen := map[string]struct{}{}
	for _, validationErr := range leaves {
		problem := editorValidationPath(validationErr.InstanceLocation) + ": " + editorValidationMessage(validationErr)
		if _, found := seen[problem]; found {
			continue
		}
		seen[problem] = struct{}{}
		problems = append(problems, problem)
	}
	sort.Strings(problems)
	return problems
}

func editorValidationLeaves(validationErr *jsonschema.ValidationError) []*jsonschema.ValidationError {
	if len(validationErr.Causes) == 0 {
		return []*jsonschema.ValidationError{validationErr}
	}
	var leaves []*jsonschema.ValidationError
	for _, cause := range validationErr.Causes {
		leaves = append(leaves, editorValidationLeaves(cause)...)
	}
	return leaves
}

func editorValidationPath(parts []string) string {
	if len(parts) == 0 {
		return "$"
	}
	var result strings.Builder
	for index, part := range parts {
		if _, err := strconv.Atoi(part); err == nil {
			fmt.Fprintf(&result, "[%s]", part)
			continue
		}
		if index > 0 {
			result.WriteByte('.')
		}
		result.WriteString(part)
	}
	return result.String()
}

func editorValidationMessage(validationErr *jsonschema.ValidationError) string {
	if typeErr, ok := validationErr.ErrorKind.(*kind.Type); ok {
		expected := make([]string, 0, len(typeErr.Want))
		for _, value := range typeErr.Want {
			expected = append(expected, strconv.Quote(value))
		}
		return "Incorrect type. Expected " + strings.Join(expected, ", ") + "."
	}
	return validationErr.Error()
}
