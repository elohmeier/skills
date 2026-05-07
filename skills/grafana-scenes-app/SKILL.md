---
name: grafana-scenes-app
description: Build Grafana app plugins with @grafana/scenes. Use when the user asks to create, scaffold, structure, or develop a Grafana app/plugin that uses scenes — including SceneApp routing, SceneAppPage tabs/drilldowns, EmbeddedScene composition, VizPanel/PanelBuilders, scene variables (Query, Custom, AdHoc, GroupBy), SceneQueryRunner, SceneDataTransformer, layouts (flex, CSS grid, grid), custom SceneObjectBase classes, behaviors, URL sync, and the alternative @grafana/scenes-react hooks API.
---

# Grafana App Plugins with @grafana/scenes

This skill helps developers build Grafana app plugins using the **@grafana/scenes** framework. Scenes is Grafana's reactive scene-graph library for building dashboard-like, interactive apps with first-class support for variables, time ranges, queries, transformations, drilldowns, and URL synchronization.

## When to use this skill

Use this skill when the user wants to:

- Scaffold a new Grafana app plugin that uses scenes
- Add a new page, tab, or drilldown to an existing scenes app
- Design a scene (layouts, panels, queries, variables, transformations)
- Build a custom `SceneObjectBase` class with state and a renderer
- Add behaviors, URL sync, or cross-panel cursor sync
- Choose between the imperative `@grafana/scenes` API and the React-hooks `@grafana/scenes-react` API
- Wire scene routing into an `AppPlugin` (`module.tsx`, `App.tsx`, `plugin.json`)

If the user is building a **panel plugin** or **datasource plugin**, this skill does not apply — point them at `@grafana/create-plugin` directly.

## How to apply

1. **Identify what they need.** New project? Use the scaffold workflow. Adding to an existing project? Use the relevant template/reference doc.
2. **Read the relevant reference file.** The `references/` directory contains detailed docs on each subsystem. Don't dump them all into context — read only what's relevant. Each is fully indexed below.
3. **Adapt a template.** The `templates/` directory has copy-paste-ready scaffolds with placeholders. Always rename `${...}` placeholders before writing files.
4. **Verify against the user's setup.** Ask which Grafana version, datasource, and bundler they're using before committing to a template — versions of `@grafana/data`, `@grafana/scenes`, etc. must match (`grafanaDependency` in `plugin.json`).

## Two API choices

| API                     | When to use                                                                          | Style                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `@grafana/scenes`       | Default. Full feature set: SceneApp routing, drilldowns, tabs, complex scene graphs. | Imperative — instantiate scene objects, compose into a tree.              |
| `@grafana/scenes-react` | Lighter apps, React-first teams, simple dashboards with hooks. WIP/newer.            | Declarative — `<SceneContextProvider>`, `<VizPanel>`, `useQueryRunner()`. |

When unsure, recommend `@grafana/scenes` — it's the mature, fully-featured API and matches the official `create-plugin` template.

## Quick scaffold workflow (new app)

```bash
npx @grafana/create-plugin@latest
# Select: "App (with Scenes)" template
# Provide: org name, plugin name
cd <plugin-dir>
npm install
npm run server   # docker compose up — Grafana + plugin volume mounted
npm run dev      # webpack/rspack watch
```

This creates: `module.tsx`, `components/App/App.tsx`, `pages/<Name>/<name>Page.ts` + `<name>Scene.ts`, `plugin.json`, `provisioning/`, e2e tests.

If the user can't or won't run `create-plugin`, copy `templates/scene-app/` and update placeholders.

## Reference index

Read the file relevant to the user's question — don't preload all of them.

| File                                       | Use when                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `references/01-plugin-anatomy.md`          | Setting up a new plugin: `plugin.json`, `module.tsx`, scripts, dependencies, provisioning      |
| `references/02-scene-app-routing.md`       | `SceneApp`, `SceneAppPage`, `useSceneApp`, tabs, drilldowns, breadcrumbs, URL sync             |
| `references/03-scene-objects-and-state.md` | Core concepts — `SceneObjectBase`, state, `useState()`, parent/child, `sceneGraph`, activation |
| `references/04-data-and-queries.md`        | `SceneQueryRunner`, `SceneDataTransformer`, data layers, time range, datasource refs           |
| `references/05-variables.md`               | All variable types, `SceneVariableSet`, `VariableValueSelectors`, interpolation, macros        |
| `references/06-layouts.md`                 | `SceneFlexLayout`, `SceneCSSGridLayout`, `SceneGridLayout`, `SplitLayout`, responsive `md`     |
| `references/07-panels-and-viz.md`          | `VizPanel`, `PanelBuilders`, options, fieldConfig, panel menu, runtime panel plugins           |
| `references/08-custom-scene-objects.md`    | Building your own `SceneObjectBase` subclass with state, renderer, activation handlers         |
| `references/09-behaviors.md`               | `$behaviors`, `ActWhenVariableChanged`, `CursorSync`, `LiveNowTimer`, custom behaviors         |
| `references/10-scenes-react.md`            | The hooks/component API: `SceneContextProvider`, `useQueryRunner`, `<VizPanel>`                |

## Template index

Each template has its own README explaining placeholders.

| Path                                       | What it gives you                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `templates/plugin-skeleton/`               | Bare `plugin.json`, `module.tsx`, `constants.ts`, `utils/` for any scenes app                              |
| `templates/scene-app/`                     | Full `App.tsx` + `pages/Home/{homePage,homeScene}.ts` wiring `SceneApp` ➜ `SceneAppPage` ➜ `EmbeddedScene` |
| `templates/scene-app/pages/WithTabs/`      | Page with tabs (sub-pages sharing breadcrumb root)                                                         |
| `templates/scene-app/pages/WithDrilldown/` | Page with dynamic drilldown route (`:param`)                                                               |
| `templates/custom-scene-object/`           | A reusable `SceneObjectBase` subclass with state, renderer, activation handler                             |
| `templates/scenes-react/`                  | Equivalent app built with `@grafana/scenes-react` hooks                                                    |

## Critical guardrails

- **Never share scene object instances across multiple parents.** A scene object's `parent` is set automatically when it's part of another object's state. To use the same logical object in two places, either `clone()` it or wrap with `SceneObjectRef`.
- **Always memoize the `SceneApp` instance** with `useSceneApp(getSceneApp)`. Recreating it on every render breaks URL sync and loses state.
- **Match versions.** `@grafana/data`, `@grafana/runtime`, `@grafana/ui`, and `@grafana/scenes` must be compatible with `grafanaDependency` in `plugin.json`. The current scenes-app template uses `>=12.3.0`.
- **Provision a datasource for dev.** Apps that query data need a datasource; the create-plugin template uses `gdev-testdata`. Add a `provisioning/datasources/default.yaml`.
- **`module.tsx` uses top-level `await`.** `await initPluginTranslations(...)` runs before `App` lazy-loads. Don't move the import below the lazy-loaded component.
- **Routing patterns matter.** Pages with tabs need `routePath: '<base>/*'` so React Router descends into tab routes. Drilldowns need their own `routePath: ':param/*'`.

## What to do first

When a user describes their goal, decide:

1. Are they scaffolding from scratch? ➜ Recommend `npx @grafana/create-plugin@latest` (scenes-app template), or copy `templates/plugin-skeleton/` + `templates/scene-app/`.
2. Are they adding a feature? ➜ Read `references/02-scene-app-routing.md` (for navigation) or `references/03-scene-objects-and-state.md` (for behavior).
3. Are they confused about the API? ➜ Show `references/03-scene-objects-and-state.md` and the comparison in `references/10-scenes-react.md`.
4. Are they debugging? ➜ Common issues are URL sync (memoize the SceneApp), shared instances (clone or use Ref), variable interpolation timing (use `sceneGraph.interpolate()`).
