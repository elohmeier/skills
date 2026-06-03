---
name: grafana
description: Work with Grafana dashboards and Grafana app plugins. Use when Codex needs to design, review, create, edit, or validate dashboard JSON and panels, including dashboard.grafana.app v2/v2beta1 schema validation; tune PromQL-backed dashboards, transformations, variables, thresholds, legends, tables, and links; or build Grafana app plugins with @grafana/scenes, including SceneApp routing, SceneAppPage tabs and drilldowns, EmbeddedScene composition, VizPanel/PanelBuilders, scene variables, SceneQueryRunner, SceneDataTransformer, layouts, custom SceneObjectBase classes, behaviors, URL sync, and @grafana/scenes-react.
---

# Grafana

Use this skill for Grafana work across two related domains:

- **Dashboards and panel JSON**: dashboard design, layout, visualization choice, PromQL panel tuning, transformations, variables, field config, overrides, table setup, links, thresholds, legends, and rendering behavior.
- **Grafana app plugins with @grafana/scenes**: app scaffolding, SceneApp routing, pages, tabs, drilldowns, scene composition, variables, queries, transformations, layouts, custom scene objects, behaviors, URL sync, and the `@grafana/scenes-react` API.

If the user is building a panel plugin or datasource plugin instead of a scenes app, this skill only applies to the Grafana concepts around panels and data shape; point them at `@grafana/create-plugin` for plugin-specific scaffolding.

## Choose the Track

Before loading references, classify the task:

- Dashboard JSON, existing dashboards, panel behavior, PromQL panels, variables, transformations, field config, table/data-link work: use the dashboard track.
- Grafana app plugins, `@grafana/scenes`, routing, SceneAppPage, EmbeddedScene, VizPanel, PanelBuilders, scene variables, custom scene objects, scenes-react: use the scenes app track.
- Both can apply when building a scenes app that embeds dashboard-like panels. In that case, use scenes references for app structure and dashboard references for panel/data-shape decisions.

## Dashboard Track

First steps:

1. Identify the dashboard goal: service health, infrastructure capacity, debugging, executive/status overview, or exploratory analysis.
2. Identify the data shape before choosing a panel: time series, single reduced value, rows and columns, logs, traces, geospatial, histogram buckets, categorical states, or node/edge graph.
3. Prefer fixing data shape at the query when it is cheap and semantically clear. Use transformations when joining, reshaping, hiding, renaming, calculating, or adapting mixed data for one panel.
4. Set units, decimals, thresholds, value mappings, legend, tooltips, and field overrides deliberately. These determine whether the panel is readable.
5. Validate by inspecting final data frames, not only the visualization. In Grafana, use panel Inspect/Data and transformation debug.

Dashboard references:

- [references/dashboard/rendering-model.md](references/dashboard/rendering-model.md): how Grafana panel JSON becomes rendered React panels, including query, transformation, field config, `PanelChrome`, and plugin behavior.
- [references/dashboard/dashboard-design.md](references/dashboard/dashboard-design.md): dashboard structure, layout, maturity, navigation, variables, and design checklists from Grafana best practices.
- [references/dashboard/panel-types.md](references/dashboard/panel-types.md): what each core visualization is good for, required data shape, and common configuration details.
- [references/dashboard/queries-and-transformations.md](references/dashboard/queries-and-transformations.md): PromQL handling, series naming, query options, variables, transformations, tables, joining, reducing, and field overrides.
- [references/dashboard/generated-dashboard-management.md](references/dashboard/generated-dashboard-management.md): generated dashboards, Jsonnet/source-of-truth provenance, metadata annotations, managed dashboards, and plugin-owned dashboards.

Reusable dashboard JSON starts in `assets/dashboard/`:

- `assets/dashboard/service-red-dashboard.json`: RED service dashboard skeleton for Prometheus.
- `assets/dashboard/infrastructure-use-dashboard.json`: USE infrastructure dashboard skeleton for Prometheus/node exporter.
- `assets/dashboard/table-detail-panel.json`: table panel template with organize/filter-friendly defaults.
- `assets/dashboard/panel-snippets.json`: copyable panel fragments for common stat, time series, table, and text panels.

Dashboard workflow:

1. Start with observability strategy: RED for services, USE for infrastructure, and golden signals for user-facing systems.
2. Build a top-down information path: status and KPIs first, correlated trends next, detailed tables/logs/traces/drilldowns lower down.
3. Choose panels by data shape. Use time series for numeric values over time, stat/gauge/bar gauge for reduced values, table for row-level detail, state timeline/status history for categorical state over time, and heatmap/histogram for distributions.
4. Configure query output with stable `refId`s, bounded labels, Prometheus `$__rate_interval` for `rate()` and `increase()`, and query format/type matching the panel.
5. Shape and label fields with transformations in intentional order and field overrides for units, decimals, display names, min/max, colors, thresholds, and panel-specific options.
6. Finish with usability: variables instead of cloned dashboards, dashboard links/data links for drilldown, panel descriptions for non-obvious panels, and truthful stacking only.

Dashboard JSON guardrails:

- Panels persist `type`, `title`, `gridPos`, `targets`, `datasource`, `options`, `fieldConfig`, `transformations`, `links`, time overrides, and repeat settings.
- `fieldConfig` should contain `defaults` and `overrides`; do not put display-only changes in query strings when field config can express them.
- Query `targets` need stable `refId`s because transformations and expressions often reference them.
- Use `gridPos` units on a 24-column grid. Keep related panels aligned and avoid tiny panels for dense legends or tables.
- When changing panel type, review `options` and `fieldConfig.custom`; panel-specific custom options may not apply to the new panel.
- For generated dashboards, keep IDs nullable or absent when importing into a new Grafana instance unless targeting an existing dashboard.
- For Jsonnet/GitOps/generated dashboards, read `references/dashboard/generated-dashboard-management.md` before recommending custom dashboard fields or edit-lock behavior.

Dashboard schema validation:

- For `dashboard.grafana.app/v2` or `v2beta1` JSON, use `scripts/validate-dashboard-v2.py`. It validates against Grafana's checked-in `apps/dashboard/pkg/apis/dashboard/<version>/dashboard_spec.cue` and also checks required properties from Grafana's OpenAPI/Monaco editor schema.
- The script accepts raw dashboard `spec` JSON or resource wrappers with `spec`; wrapper presence or absence is not itself a validation failure.
- By default, the script fetches the required schema files from `raw.githubusercontent.com/grafana/grafana/<ref>/...` and caches them under `~/.cache/grafana-dashboard-v2-schema`. Use `--grafana-ref` to pin a branch/tag/commit and `--refresh-cache` to update cached files.
- Set `GRAFANA_REPO` or pass `--grafana-repo` to validate against a local Grafana checkout instead of the cached raw GitHub files. Use `--offline` to forbid network fetches.

## Scenes App Track

First steps:

1. Identify whether the user is scaffolding a new app, adding to an existing app, debugging scenes behavior, or choosing between APIs.
2. Read only the relevant reference file from `references/scenes/`.
3. Adapt a template from `templates/` when writing app files. Always rename `${...}` placeholders before writing files.
4. Verify Grafana version, datasource, bundler, and package versions against `grafanaDependency` in `plugin.json`.

API choice:

| API                     | When to use                                                                          | Style                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `@grafana/scenes`       | Default. Full feature set: SceneApp routing, drilldowns, tabs, complex scene graphs. | Imperative: instantiate scene objects and compose a tree.                |
| `@grafana/scenes-react` | Lighter apps, React-first teams, simple dashboards with hooks. WIP/newer.            | Declarative: `<SceneContextProvider>`, `<VizPanel>`, `useQueryRunner()`. |

When unsure, recommend `@grafana/scenes`; it is the mature API and matches the official create-plugin template.

Quick scaffold workflow for a new scenes app:

```bash
npx @grafana/create-plugin@latest
# Select: "App (with Scenes)" template
# Provide: org name, plugin name
cd <plugin-dir>
npm install
npm run server
npm run dev
```

If the user cannot or does not want to run `create-plugin`, copy `templates/plugin-skeleton/` plus `templates/scene-app/` and update placeholders.

Scenes references:

| File                                              | Use when                                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `references/scenes/01-plugin-anatomy.md`          | Setting up a new plugin: `plugin.json`, `module.tsx`, scripts, dependencies, provisioning     |
| `references/scenes/02-scene-app-routing.md`       | `SceneApp`, `SceneAppPage`, `useSceneApp`, tabs, drilldowns, breadcrumbs, URL sync            |
| `references/scenes/03-scene-objects-and-state.md` | Core concepts: `SceneObjectBase`, state, `useState()`, parent/child, `sceneGraph`, activation |
| `references/scenes/04-data-and-queries.md`        | `SceneQueryRunner`, `SceneDataTransformer`, data layers, time range, datasource refs          |
| `references/scenes/05-variables.md`               | Variable types, `SceneVariableSet`, `VariableValueSelectors`, interpolation, macros           |
| `references/scenes/06-layouts.md`                 | `SceneFlexLayout`, `SceneCSSGridLayout`, `SceneGridLayout`, `SplitLayout`, responsive `md`    |
| `references/scenes/07-panels-and-viz.md`          | `VizPanel`, `PanelBuilders`, options, fieldConfig, panel menu, runtime panel plugins          |
| `references/scenes/08-custom-scene-objects.md`    | Building a `SceneObjectBase` subclass with state, renderer, activation handlers               |
| `references/scenes/09-behaviors.md`               | `$behaviors`, `ActWhenVariableChanged`, `CursorSync`, `LiveNowTimer`, custom behaviors        |
| `references/scenes/10-scenes-react.md`            | Hooks/component API: `SceneContextProvider`, `useQueryRunner`, `<VizPanel>`                   |

Template index:

| Path                                       | What it gives you                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `templates/plugin-skeleton/`               | Bare `plugin.json`, `module.tsx`, `constants.ts`, `utils/` for any scenes app                                   |
| `templates/scene-app/`                     | Full `App.tsx` plus `pages/Home/{homePage,homeScene}.ts` wiring `SceneApp` to `SceneAppPage` to `EmbeddedScene` |
| `templates/scene-app/pages/WithTabs/`      | Page with tabs                                                                                                  |
| `templates/scene-app/pages/WithDrilldown/` | Page with dynamic drilldown route (`:param`)                                                                    |
| `templates/custom-scene-object/`           | Reusable `SceneObjectBase` subclass with state, renderer, activation handler                                    |
| `templates/scenes-react/`                  | Equivalent app built with `@grafana/scenes-react` hooks                                                         |

Scenes guardrails:

- Never share scene object instances across multiple parents. To use the same logical object in two places, `clone()` it or wrap it with `SceneObjectRef`.
- Always memoize the `SceneApp` instance with `useSceneApp(getSceneApp)`. Recreating it on every render breaks URL sync and loses state.
- Match versions. `@grafana/data`, `@grafana/runtime`, `@grafana/ui`, and `@grafana/scenes` must be compatible with `grafanaDependency` in `plugin.json`.
- Provision a datasource for dev apps that query data. The create-plugin template uses `gdev-testdata`; add `provisioning/datasources/default.yaml` when needed.
- `module.tsx` uses top-level `await` for `initPluginTranslations(...)` before `App` lazy-loads. Do not move the import below the lazy-loaded component.
- Pages with tabs need `routePath: '<base>/*'` so React Router descends into tab routes. Drilldowns need their own `routePath: ':param/*'`.

## Validation

For dashboard work, confirm each panel has a clear question, matching data shape, correct units/thresholds/legends/null handling, bounded PromQL cardinality, predictable table columns, useful data links, and intentional transformation order.

For scenes apps, run the repo's lint, typecheck, and tests when available. For UI changes, start the app if practical and verify routing, panels, variables, query behavior, URL sync, and responsive layout.
