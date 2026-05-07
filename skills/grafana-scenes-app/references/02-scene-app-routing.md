# SceneApp routing: pages, tabs, drilldowns, URL sync

`SceneApp` is the root container for a multi-page scenes app. It composes `SceneAppPage` instances, integrates with Grafana's breadcrumbs and sidebar, and manages bidirectional URL ↔ state sync.

## The hierarchy

```
SceneApp
  └─ SceneAppPage (a top-level route)
       ├─ getScene() → EmbeddedScene   (the page body)
       ├─ tabs?: SceneAppPage[]        (sub-pages sharing breadcrumb)
       └─ drilldowns?: { routePath, getPage }[]
              └─ getPage(routeMatch, parent) → SceneAppPage  (built per request)
```

Each `SceneAppPage` is itself a `SceneObjectBase`. Tabs are nested `SceneAppPage` objects with their own URL pattern. Drilldowns are dynamically constructed for routes containing parameters (e.g., `:roomId`).

## Setting up SceneApp

```tsx
// components/App/App.tsx
import { AppRootProps } from "@grafana/data";
import { SceneApp, useSceneApp } from "@grafana/scenes";
import React from "react";
import { homePage } from "../../pages/Home/homePage";
import { withDrilldownPage } from "../../pages/WithDrilldown/withDrilldownPage";
import { withTabsPage } from "../../pages/WithTabs/withTabsPage";
import { PluginPropsContext } from "../../utils/utils.plugin";

function getSceneApp() {
  return new SceneApp({
    pages: [homePage, withTabsPage, withDrilldownPage],
    urlSyncOptions: {
      updateUrlOnInit: true,
      createBrowserHistorySteps: true,
    },
  });
}

function AppWithScenes() {
  const scene = useSceneApp(getSceneApp);
  return <scene.Component model={scene} />;
}

export default function App(props: AppRootProps) {
  return (
    <PluginPropsContext.Provider value={props}>
      <AppWithScenes />
    </PluginPropsContext.Provider>
  );
}
```

**`useSceneApp(factory)` is mandatory.** It memoizes the SceneApp instance, persists state across re-renders, and connects URL sync. Calling `new SceneApp(...)` in a render body breaks navigation and resets state on every render.

## SceneAppPage state

```ts
interface SceneAppPageState {
  // Identity
  title: string; // Shown in breadcrumb and (sometimes) page header
  subTitle?: string; // Renders below title
  titleImg?: string; // Image before title
  titleIcon?: IconName; // Grafana icon name before title

  // Routing — provide BOTH url and routePath
  url: string; // Absolute path: '/a/<id>/home'
  routePath?: string; // Route pattern: 'home', 'page-with-tabs/*', ':roomId/*'

  // Body
  getScene?: (routeMatch) => EmbeddedScene;

  // Composition
  tabs?: SceneAppPageLike[];
  drilldowns?: SceneAppDrilldownView[];
  getParentPage?: () => SceneAppPageLike; // For breadcrumb chain

  // Controls (rendered top-right of page header)
  controls?: SceneObject[];

  // Behavior
  hideFromBreadcrumbs?: boolean;
  preserveUrlKeys?: string[]; // Keys preserved when nav-ing between tabs/drilldowns
}
```

### `url` vs `routePath`

- `url` is the **absolute** URL used for navigation (links, breadcrumbs).
- `routePath` is the **relative** route pattern matched by React Router. It's relative to the parent's path.

For a top-level page without children: `routePath: 'home'` is fine.

For a page with tabs or drilldowns: `routePath: 'page-with-tabs/*'` so React Router descends.

For a tab inside a tab page: `routePath: 'tab-two'` (relative to parent).

For a drilldown: `routePath: ':roomName/*'` (still relative).

## A simple page

```ts
// pages/Home/homePage.ts
import { SceneAppPage } from "@grafana/scenes";
import { ROUTES } from "../../constants";
import { prefixRoute } from "../../utils/utils.routing";
import { homeScene } from "./homeScene";

export const homePage = new SceneAppPage({
  title: "Home page",
  subTitle: "Overview",
  url: prefixRoute(ROUTES.Home),
  routePath: ROUTES.Home,
  getScene: () => homeScene(),
});
```

```ts
// utils/utils.routing.ts
import { PLUGIN_BASE_URL } from "../constants";
export function prefixRoute(route: string): string {
  return `${PLUGIN_BASE_URL}/${route}`;
}
```

## A page with tabs

Tabs share the page header and breadcrumb. Each tab is a `SceneAppPage` with its own scene.

```ts
// pages/WithTabs/withTabsPage.ts
import { SceneAppPage } from "@grafana/scenes";
import { ROUTES } from "../../constants";
import { prefixRoute } from "../../utils/utils.routing";
import { tabOneScene, tabTwoScene } from "./scenes";

export const withTabsPage = new SceneAppPage({
  title: "Page with tabs",
  // CRITICAL: trailing /* so React Router descends into tab routes
  url: prefixRoute(ROUTES.WithTabs),
  routePath: `${ROUTES.WithTabs}/*`,
  hideFromBreadcrumbs: true,
  getScene: () => tabOneScene(),
  tabs: [
    new SceneAppPage({
      title: "Server names",
      url: prefixRoute(ROUTES.WithTabs),
      routePath: "/", // Default tab
      getScene: () => tabOneScene(),
    }),
    new SceneAppPage({
      title: "House locations",
      url: prefixRoute(`${ROUTES.WithTabs}/tab-two`),
      routePath: "/tab-two",
      getScene: () => tabTwoScene(),
    }),
  ],
});
```

`getScene` on the parent serves as a default for the bare `/page-with-tabs` URL. The first tab's `routePath: '/'` ensures it loads when no sub-route is present.

## A page with drilldown

Drilldowns build a fresh `SceneAppPage` per matched URL. Parameters arrive in `routeMatch.params`.

```ts
// pages/WithDrilldown/withDrilldownPage.ts
import {
  EmbeddedScene,
  SceneAppPage,
  SceneFlexLayout,
  SceneTimePicker,
  SceneTimeRange,
} from "@grafana/scenes";
import { ROUTES } from "../../constants";
import { prefixRoute } from "../../utils/utils.routing";
import { roomDetailScene } from "./roomDetailScene";
import { withDrilldownScene } from "./withDrilldownScene";

export const withDrilldownPage = new SceneAppPage({
  $timeRange: new SceneTimeRange({ from: "now-6h", to: "now" }),
  title: "Page with drilldown",
  controls: [new SceneTimePicker({ isOnCanvas: true })],
  url: prefixRoute(ROUTES.WithDrilldown),
  routePath: `${ROUTES.WithDrilldown}/*`,
  getScene: withDrilldownScene,
  drilldowns: [
    {
      routePath: "room/:roomName/*",
      getPage(routeMatch, parent) {
        const roomName = routeMatch.params.roomName;
        return new SceneAppPage({
          url: `${prefixRoute(ROUTES.WithDrilldown)}/room/${roomName}`,
          routePath: "room/:roomName/*",
          title: `${decodeURIComponent(roomName)} details`,
          getParentPage: () => parent, // For breadcrumb back-link
          getScene: () => roomDetailScene(roomName),
        });
      },
    },
  ],
});
```

How drilldowns get triggered: when user navigates (e.g., from a table row data link) to `/a/<id>/page-with-drilldown/room/Bedroom`, the parent's `routePath: '*'` matches, then the drilldown's `routePath: 'room/:roomName/*'` matches and `getPage` is called with `routeMatch.params = { roomName: 'Bedroom' }`.

You can combine tabs **inside** a drilldown by giving the returned `SceneAppPage` its own `tabs: [...]`.

## URL sync

`SceneApp` automatically syncs scene state to the URL when you provide `urlSyncOptions`:

```ts
new SceneApp({
  pages: [...],
  urlSyncOptions: {
    updateUrlOnInit: true,            // Push current state to URL on mount
    createBrowserHistorySteps: true,  // Each state change is a history entry (back button works)
    namespace: 'myapp',                // Optional prefix for URL params: ?myapp-var-region=us
    excludeFromNamespace: ['from', 'to'], // Don't prefix these keys
  },
});
```

State that auto-syncs (when scene objects opt in via `SceneObjectUrlSyncConfig`):

- Time range: `?from=now-6h&to=now`
- Time zone: `?timezone=utc`
- Variables: `?var-region=us-east&var-cluster=prod`
- Refresh interval: `?refresh=10s`
- Tab/drilldown route is part of the path itself, not query string.

## Preserving URL state across navigation

When users move between tabs or drilldowns, you typically want time range and variables to follow them.

```ts
new SceneAppPage({
  title: 'Tab',
  url: ...,
  routePath: ...,
  preserveUrlKeys: ['from', 'to', 'timezone', 'var-region', 'var-cluster'],
  getScene: () => myScene(),
});
```

`preserveUrlKeys` is also useful in breadcrumb links and deep links between pages.

## Breadcrumbs

Grafana's breadcrumb integration is automatic for `SceneApp`. Each `SceneAppPage` adds an entry. To customize:

- `hideFromBreadcrumbs: true` — skip this page in the trail
- `getParentPage: () => parentPageRef` — manually wire ancestry (for drilldowns that don't share the same getScene tree)
- `titleImg` / `titleIcon` — visual prefix in the trail

## Avoiding common pitfalls

1. **`routePath` mismatch.** A page with tabs needs `routePath: '<base>/*'`. Without `/*`, React Router won't render tab routes.
2. **Forgetting `useSceneApp`.** If you just do `<scene.Component model={new SceneApp(...)} />` you lose state on every render and break URL sync.
3. **Re-using scene objects across pages.** Each page's `getScene()` should return a fresh `EmbeddedScene`. If you want shared state, use a top-level `SceneVariableSet` on the `SceneApp` itself, or `SceneObjectRef`.
4. **Top-level controls.** `SceneAppPage` has `controls?: SceneObject[]` for the page header (right side). For per-scene controls (time picker inside the scene body), put them on `EmbeddedScene.controls`.
5. **Nav 404s.** Every `plugin.json` `includes` page must match a `SceneAppPage.url`. Otherwise the sidebar link goes nowhere.
