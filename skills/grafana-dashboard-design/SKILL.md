---
name: grafana-dashboard-design
description: Design, analyze, create, and manipulate Grafana dashboards and panel JSON. Use when Codex needs to improve dashboard layout, choose Grafana panel types, write or review dashboard JSON, tune PromQL-backed panels, handle series labels, configure transformations, field overrides, tables, links, variables, thresholds, legends, or reason about how Grafana renders panels.
---

# Grafana Dashboard Design

Use this skill for practical Grafana dashboard work: design reviews, dashboard JSON edits, panel selection, PromQL panel tuning, table and transformation setup, and explaining why a panel renders a certain way.

## First Steps

1. Identify the dashboard goal: service health, infrastructure capacity, debugging, executive/status overview, or exploratory analysis.
2. Identify the data shape before choosing a panel: time series, single reduced value, rows and columns, logs, traces, geospatial, histogram buckets, categorical states, or node/edge graph.
3. Prefer fixing data shape at the query when it is cheap and semantically clear. Use transformations when joining, reshaping, hiding, renaming, calculating, or adapting mixed data for one panel.
4. Set units, decimals, thresholds, value mappings, legend, tooltips, and field overrides deliberately. These are not cosmetic; they determine whether the panel is readable.
5. Validate by inspecting the final data frames, not only the visualization. In Grafana, use panel Inspect/Data and transformation debug.

## Reference Map

Load only the reference needed for the task:

- [rendering-model.md](references/rendering-model.md): how Grafana panel JSON becomes rendered React panels, including query, transformation, field config, `PanelChrome`, and plugin behavior.
- [dashboard-design.md](references/dashboard-design.md): dashboard structure, layout, maturity, navigation, variables, and design checklists from Grafana best practices.
- [panel-types.md](references/panel-types.md): what each core visualization is good for, required data shape, and common configuration details.
- [queries-and-transformations.md](references/queries-and-transformations.md): PromQL handling, series naming, query options, variables, transformations, tables, joining, reducing, and field overrides.

Reusable JSON starts in `assets/`:

- `assets/service-red-dashboard.json`: RED service dashboard skeleton for Prometheus.
- `assets/infrastructure-use-dashboard.json`: USE infrastructure dashboard skeleton for Prometheus/node exporter.
- `assets/table-detail-panel.json`: table panel template with organize/filter-friendly defaults.
- `assets/panel-snippets.json`: copyable panel fragments for common stat, time series, table, and text panels.

## Workflow

When creating or changing a dashboard:

1. Start with observability strategy.
   - RED: request rate, errors, duration for services and alert-linked user impact.
   - USE: utilization, saturation, errors for infrastructure resources.
   - Golden signals: latency, traffic, errors, saturation for user-facing systems.
2. Build a top-down information path.
   - First row: status and highest signal KPIs.
   - Middle rows: correlated trends and breakdowns.
   - Lower rows or drilldowns: detailed tables, logs, traces, and rare diagnostics.
3. Choose panels by data shape.
   - Time series for numeric values over time.
   - Stat, gauge, or bar gauge for reduced values.
   - Table for row-level or mixed-type detail.
   - State timeline/status history for categorical state over time.
   - Heatmap/histogram for distributions.
   - Logs/traces/node graph/geomap/canvas only when the source data really matches those domains.
4. Configure query output.
   - Use stable `refId`s (`A`, `B`, `C`) and meaningful PromQL labels.
   - Use Prometheus `$__rate_interval` for `rate()` and `increase()` unless there is a clear reason not to.
   - Use legend templates such as `{{method}} {{route}}` only with labels that are actually present and bounded.
   - Pick query `Format` and `Type` to match the panel: time series range for graphs, instant/table for stat or table when appropriate, heatmap for histogram bucket panels.
5. Shape and label fields.
   - Use transformations in intentional order. Every transformation receives the previous transformation's output.
   - Use field overrides for display concerns: unit, decimals, display name, min/max, color, thresholds, custom panel field options.
   - Prefer display names and legends that remove redundant metric names and expose the discriminating labels.
6. Finish with usability.
   - Add dashboard variables instead of cloning dashboards.
   - Add dashboard links/data links for directed drilldown.
   - Add panel descriptions for non-obvious panels and a text panel for dashboard purpose/runbook links.
   - Avoid aggressive auto-refresh and avoid stacking unless the stacked meaning is truthful.

## Editing Dashboard JSON

Keep edits compatible with Grafana's dashboard model:

- Panels persist `type`, `title`, `gridPos`, `targets`, `datasource`, `options`, `fieldConfig`, `transformations`, `links`, time overrides, and repeat settings.
- `fieldConfig` should contain `defaults` and `overrides`; do not put display-only changes in query strings when field config can express them.
- Query `targets` need stable `refId`s. Transformations and expressions often reference them.
- Use `gridPos` units on a 24-column grid. Keep related panels aligned and avoid tiny panels for dense legends or tables.
- When changing panel type, review `options` and `fieldConfig.custom`; panel-specific custom options may not apply to the new panel.
- For generated dashboards, keep IDs nullable or absent when importing into a new Grafana instance unless targeting an existing dashboard.

## Validation

Before finalizing:

- Confirm each panel has a clear question and a matching data shape.
- Confirm units, thresholds, legends, and null/no-value handling.
- Confirm PromQL cardinality is bounded by labels and variables.
- Confirm tables have predictable columns, sort behavior, hidden noisy fields, and data links where useful.
- Confirm transformations are ordered, disabled transforms are intentional, and transformed output still fits the visualization.
- For JSON edits, run any repo or project-specific validation/import tooling when available.
