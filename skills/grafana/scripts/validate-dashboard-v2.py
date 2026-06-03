#!/usr/bin/env python3
"""Validate Grafana dashboard v2 JSON against Grafana's checked-in CUE schema."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_CACHE_DIR = Path.home() / ".cache" / "grafana-dashboard-v2-schema"
DEFAULT_GRAFANA_REF = "main"
RAW_GITHUB_BASE = "https://raw.githubusercontent.com/grafana/grafana"
SCHEMA_REL = Path("apps/dashboard/pkg/apis/dashboard")
OPENAPI_REL = Path("packages/grafana-openapi/src/apis")
VERSIONS = ("v2", "v2beta1", "v2alpha1")
DYNAMIC_KIND_DEFINITIONS = {"TransformationKind"}
TYPE_DISCRIMINATED_UNIONS = {
    "DashboardValueMapOrRangeMapOrRegexMapOrSpecialValueMap": (
        "type",
        [
            ("value", "DashboardValueMap"),
            ("range", "DashboardRangeMap"),
            ("regex", "DashboardRegexMap"),
            ("special", "DashboardSpecialValueMap"),
        ],
    ),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate Grafana dashboard v2 JSON with Grafana's dashboard_spec.cue.",
    )
    parser.add_argument("files", nargs="+", type=Path, help="Dashboard JSON files to validate")
    parser.add_argument(
        "--grafana-repo",
        type=Path,
        default=Path(os.environ["GRAFANA_REPO"]) if os.environ.get("GRAFANA_REPO") else None,
        help="Optional Grafana checkout path. If omitted, schemas are fetched from raw GitHub and cached.",
    )
    parser.add_argument(
        "--grafana-ref",
        default=os.environ.get("GRAFANA_REF", DEFAULT_GRAFANA_REF),
        help=f"Grafana git ref for raw GitHub schema fetches (default: {DEFAULT_GRAFANA_REF}, or GRAFANA_REF).",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path(os.environ.get("GRAFANA_SCHEMA_CACHE", DEFAULT_CACHE_DIR)),
        help=f"Schema cache directory (default: {DEFAULT_CACHE_DIR}, or GRAFANA_SCHEMA_CACHE).",
    )
    parser.add_argument(
        "--refresh-cache",
        action="store_true",
        help="Re-fetch schema files even if cached copies exist.",
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Use only a local Grafana checkout or cached schema files; do not fetch from GitHub.",
    )
    parser.add_argument(
        "--version",
        choices=("auto",) + VERSIONS,
        default="auto",
        help="Dashboard API version/schema to use. auto reads resource apiVersion, otherwise defaults to v2.",
    )
    parser.add_argument(
        "--format",
        choices=("auto", "spec", "resource"),
        default="auto",
        help="Accepted for compatibility; input is auto-detected as raw spec or resource wrapper.",
    )
    parser.add_argument(
        "--skip-editor-schema",
        action="store_true",
        help="Only run CUE validation; skip the OpenAPI/Monaco-style required-property pass.",
    )
    return parser.parse_args()


def load_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        raise ValueError(f"invalid JSON: {e}") from e
    except OSError as e:
        raise ValueError(str(e)) from e


def detect_format(doc: Any) -> str:
    if isinstance(doc, dict) and "spec" in doc and any(k in doc for k in ("apiVersion", "kind", "metadata")):
        return "resource"
    return "spec"


def version_from_resource(doc: dict[str, Any]) -> str | None:
    api_version = doc.get("apiVersion")
    if not isinstance(api_version, str):
        return None

    version = api_version.rsplit("/", 1)[-1]
    return version if version in VERSIONS else None


def extract_spec(path: Path, doc: Any) -> tuple[dict[str, Any], str, list[str]]:
    actual_format = detect_format(doc)
    notes: list[str] = []

    if actual_format == "resource":
        if not isinstance(doc, dict):
            raise ValueError("resource input must be a JSON object")
        if doc.get("kind") not in ("Dashboard", "DashboardWithAccessInfo"):
            notes.append(f"{path}: resource kind is {doc.get('kind')!r}; validating spec only")
        spec = doc.get("spec")
        if not isinstance(spec, dict):
            raise ValueError("resource spec must be a JSON object")
        return spec, actual_format, notes

    if not isinstance(doc, dict):
        raise ValueError("spec input must be a JSON object")
    return doc, actual_format, notes


def schema_rel_path(version: str) -> Path:
    return SCHEMA_REL / version / "dashboard_spec.cue"


def openapi_rel_path(version: str) -> Path:
    return OPENAPI_REL / f"dashboard.grafana.app-{version}.json"


def resolve_version(requested: str, doc: Any) -> str:
    if requested != "auto":
        return requested
    if isinstance(doc, dict):
        detected = version_from_resource(doc)
        if detected is not None:
            return detected
    return "v2"


def run_cue_vet(schema: Path, spec: dict[str, Any]) -> subprocess.CompletedProcess[str]:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".json", delete=False) as f:
        json.dump(spec, f, separators=(",", ":"))
        f.write("\n")
        temp_path = Path(f.name)

    try:
        return subprocess.run(
            ["cue", "vet", "--all-errors", str(schema), str(temp_path), "-d", "DashboardSpec"],
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    finally:
        temp_path.unlink(missing_ok=True)


def local_schema_file(grafana_repo: Path | None, rel_path: Path) -> Path | None:
    if grafana_repo is None:
        return None
    path = grafana_repo / rel_path
    if not path.is_file():
        return None
    return path


def cache_ref_key(ref: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", ref).strip("-") or "ref"
    return safe[:80]


def cached_schema_file(cache_dir: Path, ref: str, rel_path: Path) -> Path:
    return cache_dir / cache_ref_key(ref) / rel_path


def raw_github_url(ref: str, rel_path: Path) -> str:
    encoded_ref = urllib.parse.quote(ref, safe="")
    return f"{RAW_GITHUB_BASE}/{encoded_ref}/{rel_path.as_posix()}"


def fetch_to_cache(cache_path: Path, ref: str, rel_path: Path) -> None:
    url = raw_github_url(ref, rel_path)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            data = response.read()
    except urllib.error.URLError as e:
        raise ValueError(f"failed to fetch {url}: {e}") from e
    cache_path.write_bytes(data)


def resolve_schema_file(args: argparse.Namespace, rel_path: Path) -> Path:
    local_path = local_schema_file(args.grafana_repo, rel_path)
    if local_path is not None:
        return local_path
    if args.grafana_repo is not None:
        raise ValueError(f"schema not found in Grafana checkout: {args.grafana_repo / rel_path}")

    cache_path = cached_schema_file(args.cache_dir, args.grafana_ref, rel_path)
    if args.refresh_cache or not cache_path.is_file():
        if args.offline:
            raise ValueError(f"schema not cached and offline mode is enabled: {cache_path}")
        fetch_to_cache(cache_path, args.grafana_ref, rel_path)
    return cache_path


def load_editor_schema(openapi_file: Path, version: str) -> dict[str, Any]:
    path = openapi_file

    with path.open("r", encoding="utf-8") as f:
        openapi = json.load(f)

    schemas = openapi.get("components", {}).get("schemas")
    if not isinstance(schemas, dict):
        raise ValueError(f"OpenAPI schema does not contain component schemas: {path}")

    spec_schema = schemas.get("DashboardSpec") or schemas.get(
        f"com.github.grafana.grafana.apps.dashboard.pkg.apis.dashboard.{version}.DashboardSpec"
    )
    if not isinstance(spec_schema, dict):
        raise ValueError(f"DashboardSpec schema not found in OpenAPI schema: {path}")

    definitions = {convert_ref_to_definition_key(k): flatten_single_ref_all_of(v) for k, v in schemas.items()}
    json_schema = {
        "$schema": "http://json-schema.org/draft-07/schema#",
        **flatten_single_ref_all_of(spec_schema),
        "definitions": definitions,
    }
    replace_refs(json_schema)
    fix_editor_schema_mismatches(definitions)
    return json_schema


def flatten_single_ref_all_of(schema: Any) -> Any:
    if not isinstance(schema, dict):
        return schema
    result = dict(schema)
    all_of = result.get("allOf")
    if isinstance(all_of, list) and len(all_of) == 1 and isinstance(all_of[0], dict) and "$ref" in all_of[0]:
        result["$ref"] = all_of[0]["$ref"]
        result.pop("allOf", None)
    return result


def convert_ref_to_definition_key(key: str) -> str:
    return key.replace(".", "_")


def replace_refs(obj: Any) -> None:
    if isinstance(obj, list):
        for item in obj:
            replace_refs(item)
        return
    if not isinstance(obj, dict):
        return

    ref = obj.get("$ref")
    if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
        obj["$ref"] = f"#/definitions/{convert_ref_to_definition_key(ref.removeprefix('#/components/schemas/'))}"

    for value in obj.values():
        replace_refs(value)


def fix_editor_schema_mismatches(definitions: dict[str, Any]) -> None:
    fix_kind_constraints(definitions)
    fix_discriminated_unions(definitions)


def definition_suffix(key: str) -> str:
    match = re.search(r"(?:^|_)Dashboard(\w+)$", key)
    return f"Dashboard{match.group(1)}" if match else key


def fix_kind_constraints(definitions: dict[str, Any]) -> None:
    for key, schema in definitions.items():
        if not isinstance(schema, dict):
            continue
        kind_prop = schema.get("properties", {}).get("kind")
        if not isinstance(kind_prop, dict) or kind_prop.get("type") != "string":
            continue

        match = re.search(r"(?:^|_)Dashboard(\w+)Kind$", key)
        if match and f"{match.group(1)}Kind" not in DYNAMIC_KIND_DEFINITIONS:
            kind_prop["const"] = match.group(1)
        elif key.endswith("_DashboardElementReference") or key == "DashboardElementReference":
            kind_prop["const"] = "ElementReference"


def fix_discriminated_unions(definitions: dict[str, Any]) -> None:
    for key, schema in definitions.items():
        if not isinstance(schema, dict):
            continue

        properties = schema.get("properties")
        if "KindOr" in key and isinstance(properties, dict):
            variants = collect_kind_variants(properties)
            if variants:
                apply_discriminated_union(schema, "kind", variants, ["kind", "spec"])
                continue

        suffix = definition_suffix(key)
        if suffix in TYPE_DISCRIMINATED_UNIONS:
            discriminator, configured = TYPE_DISCRIMINATED_UNIONS[suffix]
            variants = []
            prefix = key[: -len(suffix)] if key.endswith(suffix) else ""
            for value, ref_suffix in configured:
                ref_key = f"{prefix}{ref_suffix}"
                if ref_key in definitions:
                    variants.append((value, f"#/definitions/{ref_key}"))
            if variants:
                apply_discriminated_union(schema, discriminator, variants)


def collect_kind_variants(properties: dict[str, Any]) -> list[tuple[str, str]]:
    variants = []
    for prop_schema in properties.values():
        if not isinstance(prop_schema, dict):
            return []
        ref = prop_schema.get("$ref")
        if not isinstance(ref, str):
            return []
        match = re.search(r"(?:^|_)Dashboard(\w+)Kind$", ref.removeprefix("#/definitions/"))
        if match:
            variants.append((match.group(1), ref))
    return variants


def apply_discriminated_union(
    schema: dict[str, Any],
    discriminator: str,
    variants: list[tuple[str, str]],
    required_fields: list[str] | None = None,
) -> None:
    schema.clear()
    schema["type"] = "object"
    schema["required"] = required_fields or [discriminator]
    schema["properties"] = {discriminator: {"type": "string", "enum": [value for value, _ in variants]}}
    schema["allOf"] = [
        {"if": {"properties": {discriminator: {"const": value}}}, "then": {"$ref": ref}} for value, ref in variants
    ]


def editor_required_errors(spec: dict[str, Any], schema: dict[str, Any]) -> list[str]:
    return validate_required(spec, schema, "$", schema.get("definitions", {}))


def validate_required(instance: Any, schema: Any, path: str, definitions: dict[str, Any]) -> list[str]:
    if not isinstance(schema, dict):
        return []

    if "$ref" in schema:
        ref_schema = resolve_ref(schema["$ref"], definitions)
        return validate_required(instance, ref_schema, path, definitions)

    errors: list[str] = []

    all_of = schema.get("allOf")
    if isinstance(all_of, list):
        for item in all_of:
            if not isinstance(item, dict):
                continue
            if "if" in item and "then" in item:
                if simple_condition_matches(instance, item["if"]):
                    errors.extend(validate_required(instance, item["then"], path, definitions))
            else:
                errors.extend(validate_required(instance, item, path, definitions))

    if schema.get("type") == "object" and isinstance(instance, dict):
        for field in schema.get("required", []):
            if field not in instance:
                errors.append(f'{path}: Missing property "{field}".')

        properties = schema.get("properties", {})
        if isinstance(properties, dict):
            for field, property_schema in properties.items():
                if field in instance:
                    errors.extend(validate_required(instance[field], property_schema, f"{path}.{field}", definitions))

        additional = schema.get("additionalProperties")
        if isinstance(additional, dict):
            known = set(properties.keys()) if isinstance(properties, dict) else set()
            for field, value in instance.items():
                if field not in known:
                    errors.extend(validate_required(value, additional, f"{path}.{field}", definitions))

    items = schema.get("items")
    if schema.get("type") == "array" and isinstance(instance, list) and isinstance(items, dict):
        for i, item in enumerate(instance):
            errors.extend(validate_required(item, items, f"{path}[{i}]", definitions))

    return errors


def resolve_ref(ref: str, definitions: dict[str, Any]) -> Any:
    prefix = "#/definitions/"
    if not isinstance(ref, str) or not ref.startswith(prefix):
        return {}
    return definitions.get(ref.removeprefix(prefix), {})


def simple_condition_matches(instance: Any, condition: Any) -> bool:
    if not isinstance(instance, dict) or not isinstance(condition, dict):
        return False
    properties = condition.get("properties")
    if not isinstance(properties, dict):
        return False
    for field, field_schema in properties.items():
        if not isinstance(field_schema, dict) or "const" not in field_schema:
            return False
        if instance.get(field) != field_schema["const"]:
            return False
    return True


def validate_file(path: Path, args: argparse.Namespace) -> bool:
    try:
        doc = load_json(path)
        spec, input_format, notes = extract_spec(path, doc)
        version = resolve_version(args.version, doc)
        schema = resolve_schema_file(args, schema_rel_path(version))

        result = run_cue_vet(schema, spec)
        for note in notes:
            print(note, file=sys.stderr)
        editor_errors = []
        if not args.skip_editor_schema:
            openapi_file = resolve_schema_file(args, openapi_rel_path(version))
            editor_schema = load_editor_schema(openapi_file, version)
            editor_errors = editor_required_errors(spec, editor_schema)

        if result.returncode != 0 or editor_errors:
            print(f"{path}: invalid DashboardSpec ({version}, input={input_format})", file=sys.stderr)
            output = (result.stdout + result.stderr).strip()
            if output:
                print(output, file=sys.stderr)
            if editor_errors:
                print("Editor schema required-property errors:", file=sys.stderr)
                for error in editor_errors:
                    print(error, file=sys.stderr)
            return False

        source = f"local:{args.grafana_repo}" if args.grafana_repo else f"github:{args.grafana_ref}"
        print(f"{path}: ok ({version}, input={input_format}, schema={source})")
        return True
    except ValueError as e:
        print(f"{path}: {e}", file=sys.stderr)
        return False


def main() -> int:
    args = parse_args()
    if shutil.which("cue") is None:
        print("cue executable not found in PATH", file=sys.stderr)
        return 2

    if args.grafana_repo is not None:
        args.grafana_repo = args.grafana_repo.expanduser().resolve()
    args.cache_dir = args.cache_dir.expanduser().resolve()
    ok = True
    for path in args.files:
        ok = validate_file(path.expanduser(), args) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
