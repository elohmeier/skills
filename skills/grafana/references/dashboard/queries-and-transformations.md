# Queries, PromQL, Transformations, And Tables

Use this for query shaping, Prometheus details, series naming, transformations, and tabular data.

## Source Anchors

- Query overview: `docs/sources/visualizations/panels-visualizations/query-transform-data/_index.md`
- Transformations: `docs/sources/visualizations/panels-visualizations/query-transform-data/transform-data/index.md`
- Calculation types: `docs/sources/visualizations/panels-visualizations/query-transform-data/calculation-types/index.md`
- Expressions: `docs/sources/visualizations/panels-visualizations/query-transform-data/expression-queries/index.md`
- SQL expressions: `docs/sources/visualizations/panels-visualizations/query-transform-data/sql-expressions/index.md`
- Prometheus query editor: `docs/sources/datasources/prometheus/query-editor/_index.md`
- Prometheus variables: `docs/sources/datasources/prometheus/template-variables/_index.md`
- Standard options: `docs/sources/visualizations/panels-visualizations/configure-standard-options/index.md`
- Overrides: `docs/sources/visualizations/panels-visualizations/configure-overrides/index.md`
- Legend: `docs/sources/visualizations/panels-visualizations/configure-legend/index.md`
- Tooltips: `docs/sources/visualizations/panels-visualizations/configure-tooltips/index.md`
- Data links/actions: `docs/sources/visualizations/panels-visualizations/configure-data-links/index.md`

## PromQL Panel Rules

- Use `rate(metric[$__rate_interval])` or `increase(metric[$__rate_interval])` for counters.
- Prefer ratios with matching label sets:
  - `sum(rate(http_requests_total{status=~"5.."}[$__rate_interval])) by (service) / sum(rate(http_requests_total[$__rate_interval])) by (service)`
- Bound cardinality in panel queries. Avoid unbounded labels like `pod`, `instance`, `path`, `user`, `trace_id`, or raw URL unless the panel is specifically a detail panel.
- For multi-value variables, use regex matchers: `{service=~"$service"}`.
- Use `label_replace` only when the datasource cannot provide a better label; prefer instrumentation and recording rules for stable labels.
- Use `topk`, `bottomk`, `sort_desc`, or aggregation to make legends readable.
- Use recording rules for expensive or repeated PromQL, especially histogram quantiles, burn rates, and high-cardinality aggregations.

## Prometheus Query Editor Options

- `Legend`: Auto displays unique labels; verbose displays all labels; custom supports label templates like `{{service}} {{route}}`.
- `Min step`: sets minimum interval between returned points and aligns query range to that step. Supports `$__interval` and `$__rate_interval`.
- `Format`:
  - Time series: default for graphs.
  - Table: for table panels and row-like instant/range output.
  - Heatmap: for histogram metrics in heatmap panels.
- `Type`:
  - Range: multiple points over time.
  - Instant: one value per series, useful for stat/table.
  - Both: both range and instant where the datasource supports it.
- Exemplars are not available for instant queries.

## Series Labeling

- Make legends answer "which thing is this?" without repeating the metric name.
- Use short, bounded label combinations:
  - Good: `{{method}} {{route}} {{status}}`
  - Good: `{{namespace}}/{{workload}}`
  - Risky: `{{pod}}` on an overview; better for detail dashboards.
- For service dashboards, aggregate away volatile labels on overview panels:
  - `sum by (service, route, status) (...)` instead of keeping `pod` or `instance`.
- For comparison panels, keep exactly the labels needed for the visual grouping.
- If Grafana transformations rename fields, field overrides and data links should target final display names.

## Transformation Rules

- Transformations run after query results and before field overrides/visualization.
- Order matters. Each transformation consumes the previous output.
- Disable transformations during debugging instead of deleting them.
- Use transformation debug to compare input and output.
- Filter transformations by query refId when only one query should be transformed.
- Variables in transformation text inputs are interpolated before transformation execution.

## Common Transformations

- Add field from calculation: row math, binary/unary operations, cumulative/window functions, row index, alias, replace all fields.
- Concatenate fields: combine fields from multiple frames into one frame.
- Config from query results: use one query to drive min/max/unit/threshold/value mappings for other fields.
- Convert field type: convert strings/numbers/time, useful before time series or table rendering.
- Extract fields: parse structured strings such as JSON, key-value, or regex into fields.
- Filter data by query refId: isolate query outputs before later transforms.
- Filter data by values: keep/drop rows based on conditions.
- Filter fields by name: keep/drop fields, supports regex and dashboard variables.
- Group by: aggregate rows by fields and calculations.
- Grouping to matrix: produce matrix-like tables/heatmaps from row data.
- Group to nested tables: create expandable nested table structure.
- Join by field: join time series or SQL-like frames by a key such as time or id.
- Join by labels: join series into table by common labels.
- Labels to fields: convert labels into table columns; useful for Prometheus instant/table output.
- Limit: cap rows.
- Merge series/tables: combine frames when shared fields align.
- Organize fields by name: reorder, hide, and rename fields for single-frame table output.
- Partition by values: split rows into separate frames by a field.
- Prepare time series: convert between long, wide, and multi-frame time series formats.
- Reduce: reduce fields or series to calculations for stat/gauge/table summaries.
- Rename by regex: clean display names.
- Series to rows: convert multiple series to rows, often for table summaries.
- Time series to table: create tabular summaries from time series.

## Table Handling

- Use table panels for exact row/column detail, not for every metric overview.
- Ensure each row has a complete enough column structure; missing fields can prevent useful display.
- If multiple frames are returned, table shows a dataset selector. Merge or join only when the combined table has a clear key.
- Use "Organize fields by name" for final column order, hide, and rename.
- Use field overrides for:
  - Column width and alignment.
  - Cell type: auto, colored text/background, gauge, sparkline, JSON, image, data links.
  - Units/decimals/no-value per column.
- Use table footer calculations for numeric summaries.
- Use column filtering for temporary user-side filtering; use query filters for persistent and cheaper filtering.
- Add data links/actions to IDs, services, trace IDs, dashboard drilldowns, or runbooks.

## Field Overrides And Display

- Defaults apply to every field; overrides apply only to matched fields.
- Matchers include field name, regex, field type, query refId, and values.
- Use overrides for per-series color, axis, line style, transform constant/negative, fill below, table width, cell type, thresholds, units, and display name.
- In time series, the transform override changes drawn values without changing tooltip/legend values. Use constant for instant-style horizontal lines or negative Y for mirrored comparisons.

## Troubleshooting

- Different results after rearranging functions often means query or transformation order changed semantics.
- Slow panel: check query cardinality, time range, min step, max data points, recording rules, and unnecessary transformations.
- Empty time series: confirm range query, time field, numeric fields, and data format.
- Bad stat value: confirm reduce calculation and instant vs range query.
- Bad table: inspect frames, field names, and whether transformations produce one usable frame.
