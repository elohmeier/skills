# Stable Dashboard v2 Tooling

Use `scripts/dashboard-v2` for stable `dashboard.grafana.app/v2` conversion, local validation, strict live validation, and conversion-first Jsonnet rendering. The tool imports Grafana's own dashboard migration, conversion, generated Go types, and embedded CUE validator at the exact module revision printed by:

```bash
scripts/dashboard-v2 version
```

It intentionally does not support `v2alpha1`, `v2beta1`, approximate conversion, or compatibility with the retired helper interfaces.

The wrapper requires the Go version declared in `scripts/dashboard-v2-tool/go.mod`; with normal Go toolchain selection, the first invocation can download that toolchain and the pinned modules. Only `render` additionally requires the `jsonnet` executable. Conversion and validation do not require a Grafana source checkout.

## Conversion contract

Classic input follows Grafana's own sequence:

1. Run all classic schema migrations through Grafana's current `LATEST_VERSION`.
2. Assign unique panel IDs with Grafana's migration helper.
3. Wrap the migrated model as a v1 dashboard resource.
4. Call Grafana's direct v1-to-stable-v2 converter.
5. Validate the resulting stable-v2 spec with Grafana's embedded CUE validator.
6. Fail if the preservation audit detects changed or missing panels, query `refId`s, transformations, plugin IDs/versions, annotations, links, variables, library references, or layout references.

For a v1 resource, the tool starts at step 3 because a served v1 resource is already expected to contain the current classic schema model.

Grafana conversion depends on server-side datasource and library-element indexes. Never replace these with guessed plugin types, default UIDs, or hard-coded plugin versions. Export a complete snapshot from the same organization/namespace that owns the dashboard:

```bash
export GRAFANA_URL=https://grafana.example.test
export GRAFANA_TOKEN=...
scripts/dashboard-v2 export-context --output conversion-context.json
```

The token must be able to list every datasource and library element that the Grafana conversion service would see. The snapshot contains no datasource secrets. Commit it only if datasource names, UIDs, folder UIDs, and library panel models are acceptable repository data.

Convert raw classic dashboard JSON:

```bash
scripts/dashboard-v2 convert \
  --input dashboard.json \
  --input-format classic \
  --context conversion-context.json \
  --name service-overview \
  --namespace default \
  --output dashboard.v2.json
```

Use `--input-format export` for the legacy HTTP response shape with a top-level `dashboard` property, or `--input-format v1` for a `dashboard.grafana.app/v1` or `v1beta1` resource. Use `--output-format spec` only when a downstream generator explicitly owns the wrapper.

The example at `assets/dashboard/conversion-context.example.json` documents the context shape. Both catalog sections must say `"complete": true`; this is a deliberate assertion, not a way to make a partial catalog valid.

## Jsonnet after conversion

Jsonnet is an authoring and patching layer, not a schema converter. Do not implement classic-to-v2 conversion in Jsonnet and do not add a `normalize` function that guesses missing Grafana context.

For a converted baseline, have the Jsonnet source load the file supplied by the render command:

```jsonnet
local base = std.extVar('grafanaDashboardV2');

base {
  title: base.title + ' (generated)',
}
```

Then render it through the same conversion and validation boundary:

```bash
scripts/dashboard-v2 render \
  --input dashboard.json \
  --input-format classic \
  --context conversion-context.json \
  --name service-overview \
  --jsonnet dashboard.jsonnet \
  --jpath assets/dashboard \
  --output dashboard.generated.json
```

`render` supplies `grafanaDashboardV2` as Jsonnet code from a temporary JSON file, validates the rendered stable-v2 spec with Grafana's validator, and verifies that every element is referenced by the layout exactly once. Intentional query changes happen after the baseline preservation audit.

For new dashboards, author stable v2 directly. `assets/dashboard/v2.libsonnet` contains thin schema-shaped constructors; `assets/dashboard/prometheus.libsonnet` contains Prometheus query and transformation helpers. They require datasource UIDs and plugin versions at the call site. They contain no converter, environment defaults, or hidden normalization.

## Validation levels

Local validation uses the pinned generated stable-v2 Go types, Grafana's embedded `ValidateDashboardSpec` CUE validator, and an exact layout-to-element reference audit:

```bash
scripts/dashboard-v2 validate --input dashboard.v2.json --input-format resource
scripts/dashboard-v2 validate --input dashboard-spec.json --input-format spec
```

This is deterministic and offline after Go has populated its module cache. It validates the schema model but cannot reproduce every API-server admission rule or installed-plugin constraint.

The authoritative check is Grafana's stable-v2 resource API with strict field validation and a dry run:

```bash
scripts/dashboard-v2 validate-live \
  --input dashboard.v2.json \
  --namespace default
```

The request is sent to:

```text
POST /apis/dashboard.grafana.app/v2/namespaces/<namespace>/dashboards?dryRun=All&fieldValidation=Strict
```

It does not persist the dashboard. Use a CA file when needed; reserve `--insecure-skip-tls-verify` for explicitly accepted test environments.

## Updating the Grafana pin

Treat a pin update as a behavior change:

1. Update the direct Grafana dashboard and apimachinery module versions in `scripts/dashboard-v2-tool/go.mod` and the version constant in `main.go`.
2. Run `go mod tidy` and `go test ./...` in `scripts/dashboard-v2-tool`.
3. Run the relevant conversion golden tests in the matching Grafana checkout.
4. Convert fixtures containing rows, library panels, transformations, variables, annotations, datasource strings, explicit datasource refs, and null threshold steps.
5. Review the JSON diff and preservation-audit failures before accepting the update.
