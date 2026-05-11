# Dashboard Design Reference

Use this for dashboard design, review, and restructuring.

## Source Anchors

- Best practices: `docs/sources/visualizations/dashboards/build-dashboards/best-practices/index.md`
- Variables: `docs/sources/visualizations/dashboards/variables/_index.md`
- Add variables: `docs/sources/visualizations/dashboards/variables/add-template-variables/index.md`
- Variable syntax: `docs/sources/visualizations/dashboards/variables/variable-syntax/index.md`
- Dashboard links: `docs/sources/visualizations/dashboards/build-dashboards/manage-dashboard-links/`
- Panel options: `docs/sources/visualizations/panels-visualizations/configure-panel-options/index.md`
- Data links/actions: `docs/sources/visualizations/panels-visualizations/configure-data-links/index.md`

## Strategy Patterns

Use RED for services:

- Rate: requests per second or throughput.
- Errors: error count or error ratio.
- Duration: latency distribution, usually percentile or histogram.

Use USE for infrastructure:

- Utilization: percent busy, for example CPU, memory, disk, network.
- Saturation: queue length, load, throttling, backlog.
- Errors: hardware, kernel, network, or device errors.

Use golden signals for user-facing systems:

- Latency, traffic, errors, saturation.

## Layout Rules

- One dashboard should answer one main question or support one operational workflow.
- Put highest-signal status panels first, then correlated graphs, then details.
- Use rows only when they improve scanning or hide less-common detail.
- Align panels to a consistent 24-column grid.
- Avoid tiny time series with large legends; legends need width.
- Prefer a few strong panels over many weak panels.
- Use threshold colors semantically and consistently. Do not make color carry multiple meanings in the same dashboard.
- Avoid stacked graphs unless the sum is meaningful and the stack does not hide important individual behavior.
- Normalize axes when comparing resources with different capacities, for example CPU percent instead of raw core-seconds.
- Split panels when magnitudes differ enough that one series hides another.

## Management Maturity

Low maturity signs:

- Many copied dashboards, no clear owner, little reuse, no version control, random browsing to find dashboards.

Medium maturity:

- Template variables prevent per-node or per-service clones.
- Dashboards reflect a strategy such as RED or USE.
- Drilldowns guide users from overview to detail.
- JSON is version controlled.

High maturity:

- Sprawl is actively reduced.
- Dashboards are generated or templated for consistency.
- Production dashboard edits are controlled.
- Usage is reviewed and obsolete dashboards are removed.

## Variables And Reuse

- Use variables for datasource, cluster, namespace, service, instance, route, and environment instead of duplicating dashboards.
- For multi-value Prometheus label variables, use regex matchers (`=~`) in PromQL.
- Use `${var}` when embedding a variable in the middle of a word or when specifying format options.
- Use `${var:raw}`, `${var:csv}`, `${var:json}`, `${var:regex}`, or `${var:queryparam}` only when the target syntax requires it.
- Use URL parameters to link to a dashboard with selected variables rather than copying dashboards.

## Documentation And Navigation

- Add a text panel for dashboard purpose, ownership, runbook links, and expected use.
- Add panel descriptions when a query, transformation, threshold, or unit choice is not obvious.
- Use dashboard links for related dashboards and data links for point-level drilldown.
- Add links from alert notifications to the most relevant dashboard and variable state.

## Design Review Checklist

- What question does this dashboard answer?
- Who uses it during normal operation and during incidents?
- Can the first row tell whether users are affected?
- Are RED/USE/golden signal panels grouped consistently?
- Are labels and legends stable, short, and meaningful?
- Are thresholds justified and documented?
- Are variables reducing dashboard copies?
- Is refresh interval appropriate for data freshness and backend cost?
- Are details reachable without cluttering the overview?
