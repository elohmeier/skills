# Dashboard visible-data validation

Use `scripts/dashboard_visible_data.ts` to query a live Grafana instance and inspect the data users would see after dashboard variables, standard transformations, field overrides, display names, units, mappings, reducers, and table sorting are applied.

This complements schema validation:

- `scripts/dashboard-v2 validate` proves that stable-v2 JSON conforms to Grafana's pinned generated types and CUE schema and that layout references match elements.
- `dashboard_visible_data.ts` checks live query execution and the resulting visible values for classic and v2 dashboards.

## Install the script dependencies

Install once inside the skill's `scripts` directory:

```bash
npm install --prefix <grafana-skill>/scripts
```

The dependency versions are pinned in `scripts/package.json`. They should normally match or closely track the Grafana instance used for validation because transformation and display behavior can change between Grafana releases.

## Configure Grafana access

The script reads configuration from environment variables, or from `.env` and `mise.toml` in the current working directory:

```bash
export GRAFANA_URL='https://grafana.example.com'
export GRAFANA_TOKEN='replace-with-a-service-account-token'
```

`GRAFANA_TOKEN` is optional for a local instance that allows anonymous query access. Keep tokens out of dashboard JSON, command history, output files, and version control.

Optional connection settings:

- `GRAFANA_TLS_VERIFY=false` disables certificate verification. Use only for a controlled development endpoint.
- `GRAFANA_RESOLVE=host:port:address` provides curl `--resolve`-style DNS overrides.
- `GRAFANA_HOST_HEADER` overrides the HTTP `Host` header.
- `GRAFANA_SNI_HOSTNAME` overrides the TLS SNI hostname.

## Run the checks

From the dashboard repository, use the script-local runtime so relative dashboard paths and local `.env` resolve against the current working directory:

```bash
<grafana-skill>/scripts/node_modules/.bin/tsx \
  <grafana-skill>/scripts/dashboard_visible_data.ts \
  dashboards/service-red.json \
  --list-panels
```

Query one panel with a controlled scope and time range:

```bash
<grafana-skill>/scripts/node_modules/.bin/tsx \
  <grafana-skill>/scripts/dashboard_visible_data.ts \
  dashboards/service-red.json \
  --panel-id 3 \
  --from now-30m \
  --to now \
  --var service=checkout
```

Generate machine-readable evidence for several panels:

```bash
<grafana-skill>/scripts/node_modules/.bin/tsx \
  <grafana-skill>/scripts/dashboard_visible_data.ts \
  dashboards/service-red.json \
  --panel-ids 2,3,4,5 \
  --format json \
  --output .tmp/service-red-visible-data.json
```

Useful options include:

- `--panel-type table`, `--panel-id`, or `--panel-ids` to keep validation bounded.
- `--var name=value` to test normal, empty, single-value, and broad scopes.
- `--step 30s` to control `intervalMs` for Prometheus and Loki queries.
- `--raw-frames` to compare datasource frames with transformed/displayed output.
- `--include-hidden-targets` when an expression depends on hidden queries.
- `--include-collapsed` for classic panels nested in collapsed rows.
- `--concurrency` and `--timeout` to control backend load and request timeouts.

Run `dashboard_visible_data.ts --help` for the full CLI.

The script reads saved variable values but does not execute dashboard variable queries. Override datasource and scope variables with `--var`, especially when a reusable dashboard has empty defaults.

For a multi-query table, start with `--raw-frames` and compare the entity and frame counts before and after transformations. Repeated entity rows plus one generic `Value` column usually mean a metric-label pivot did not produce distinct value fields. Prefer one query per numeric column, refId-filtered preparation, and an outer `joinByField`; see [queries-and-transformations.md](queries-and-transformations.md#multi-metric-prometheus-inventory-tables).

The script honors classic top-level transformation filters and stable-v2 `spec.filter` values. Check refId-filtered pipelines with both one returned series and several returned series because `merge` can produce refIds such as `A` or `merge-A-A-A` depending on the result shape.

## Run Grafana's transformation editor diagnostics headlessly

Use `scripts/dashboard_editor_diagnostics.ts` when the validation result must include messages rendered by Grafana's transformation editors. This is separate from the approximate visible-data renderer: by default it creates one synthetic frame per query, mounts the skill-pinned Grafana release's own transformation rows and lazy-loaded editors under jsdom, and collects every `role="alert"` inside an editor. It downloads and caches the pinned upstream source and frontend runtime on first use; later runs reuse the cache.

Validate a bounded panel from the dashboard repository without a Grafana endpoint or source-path setting:

```bash
<grafana-skill>/scripts/node_modules/.bin/tsx \
  <grafana-skill>/scripts/dashboard_editor_diagnostics.ts \
  dashboards/service-red.json \
  --panel-id 8
```

The synthetic frame shape makes transformation diagnostics deterministic and catches configurations that become ineffective with one frame, without encoding transformation-specific warning rules. It does not claim that a live datasource currently returns that shape.

The command only selects panels that have transformations. By default, editor alerts and transformations missing from the upstream registry produce exit status `1`. Use `--report-only` when editor alerts should be reported without changing the exit status; registry errors still fail. CLI and harness failures return `2`. `--grafana-source` can override the automatically cached release for a trusted local checkout; it is not required for normal use.

This check does not match warning text and has no transformation-specific validation rules. It executes Grafana's `TransformationOperationRows` and `TransformationOperationRow`, including preceding transformations and the current frame matcher, then renders the actual editor from `getStandardTransformers`. New upstream editor alerts therefore surface without a local ruleset.

Editor diagnostics remain data-shape-dependent and deliberately cover the one-frame-per-query state. Use the separate visible-data CLI when current datasource results matter. A transformation editor that is quiet for the synthetic shape is not proof that it will be quiet for every runtime response.

## Interpret results

For `dashboard_visible_data.ts`, exit status `0` means every selected panel query completed without a reported query error, `1` means at least one panel returned an error, and CLI or connection failures return `2`. For `dashboard_editor_diagnostics.ts`, `0` means no failing editor or registry diagnostics were found, `1` means diagnostics were found, and CLI or harness failures return `2`.

Review more than the exit status:

- Does a valid zero render as zero rather than no data?
- Does an absent series remain distinct from a zero value?
- Do field units, mappings, display names, reducers, transformations, and sorting match the dashboard contract?
- Do variable overrides select the expected series without unbounded expansion?
- Are empty frames, datasource errors, and partial results recognizable?
- Are series and row counts within the performance budget?
- For joined inventory tables, is there exactly one row per entity and one distinctly named field per metric?

The visible-data script approximates Grafana's visible-data pipeline with `@grafana/data`; it does not render panel plugin UI, evaluate browser layout, exercise data links, or prove accessibility. The editor-diagnostics script executes the upstream transformation/editor path but still does not render the visualization plugin or dashboard layout. For v2 dashboards, the tools preserve layout order but do not emulate the selected tab, section-variable scope, repeats, or conditional rendering; select panel IDs and pass variable overrides explicitly. Unsupported visible-data transformations produce warnings and may leave output raw for that step. Pair these checks with a browser review for representative tasks and failure states.
