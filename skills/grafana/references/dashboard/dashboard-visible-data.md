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

## Interpret results

Exit status `0` means every selected panel query completed without a reported query error. Exit status `1` means at least one panel returned an error. CLI or connection failures return `2`.

Review more than the exit status:

- Does a valid zero render as zero rather than no data?
- Does an absent series remain distinct from a zero value?
- Do field units, mappings, display names, reducers, transformations, and sorting match the dashboard contract?
- Do variable overrides select the expected series without unbounded expansion?
- Are empty frames, datasource errors, and partial results recognizable?
- Are series and row counts within the performance budget?

The script approximates Grafana's visible-data pipeline with `@grafana/data`; it does not render panel plugin UI, evaluate browser layout, exercise data links, or prove accessibility. For v2 dashboards, it preserves layout order but does not emulate the selected tab, section-variable scope, repeats, or conditional rendering; select panel IDs and pass variable overrides explicitly. Unsupported transformations produce warnings and may leave output raw for that step. Pair it with schema validation and a browser review for representative tasks and failure states.
