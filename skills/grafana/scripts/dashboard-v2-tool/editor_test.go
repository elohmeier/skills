package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func editorFixture(t *testing.T) (map[string]any, []byte) {
	t.Helper()
	path := filepath.Join("..", "..", "assets", "dashboard", "tabbed-dashboard-v2.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var resource map[string]any
	if err := json.Unmarshal(data, &resource); err != nil {
		t.Fatal(err)
	}
	return resource, data
}

func firstEditorPanelDefaults(t *testing.T, resource map[string]any) (string, map[string]any) {
	t.Helper()
	spec := resource["spec"].(map[string]any)
	elements := spec["elements"].(map[string]any)
	keys := make([]string, 0, len(elements))
	for key := range elements {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		element := elements[key].(map[string]any)
		if element["kind"] != "Panel" {
			continue
		}
		panelSpec := element["spec"].(map[string]any)
		vizConfig := panelSpec["vizConfig"].(map[string]any)
		vizSpec := vizConfig["spec"].(map[string]any)
		fieldConfig := vizSpec["fieldConfig"].(map[string]any)
		return key, fieldConfig["defaults"].(map[string]any)
	}
	t.Fatal("fixture has no panel")
	return "", nil
}

func encodeEditorFixture(t *testing.T, resource map[string]any) []byte {
	t.Helper()
	data, err := json.Marshal(resource)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestGrafanaEditorCompatibilityAcceptsFixture(t *testing.T) {
	_, data := editorFixture(t)
	if err := validateGrafanaEditorCompatibility(data, "resource"); err != nil {
		t.Fatal(err)
	}
}

func TestGrafanaEditorCompatibilityRejectsNullThreshold(t *testing.T) {
	resource, _ := editorFixture(t)
	panel, defaults := firstEditorPanelDefaults(t, resource)
	defaults["thresholds"] = map[string]any{
		"mode":  "absolute",
		"steps": []any{map[string]any{"color": "green", "value": nil}},
	}
	err := validateGrafanaEditorCompatibility(encodeEditorFixture(t, resource), "resource")
	want := "elements." + panel + ".spec.vizConfig.spec.fieldConfig.defaults.thresholds.steps[0].value: Incorrect type. Expected \"number\"."
	if err == nil || !strings.Contains(err.Error(), want) {
		t.Fatalf("expected Grafana editor threshold error %q, got %v", want, err)
	}
}

func TestGrafanaEditorCompatibilityRejectsNullRangeBounds(t *testing.T) {
	resource, _ := editorFixture(t)
	panel, defaults := firstEditorPanelDefaults(t, resource)
	defaults["mappings"] = []any{map[string]any{
		"type": "range",
		"options": map[string]any{
			"from": nil,
			"to":   nil,
			"result": map[string]any{
				"text": "unbounded",
			},
		},
	}}
	err := validateGrafanaEditorCompatibility(encodeEditorFixture(t, resource), "resource")
	if err == nil {
		t.Fatal("expected Grafana editor range-bound errors")
	}
	for _, field := range []string{"from", "to"} {
		want := "elements." + panel + ".spec.vizConfig.spec.fieldConfig.defaults.mappings[0].options." + field + ": Incorrect type. Expected \"number\"."
		if !strings.Contains(err.Error(), want) {
			t.Errorf("expected Grafana editor range-bound error %q, got %v", want, err)
		}
	}
}
