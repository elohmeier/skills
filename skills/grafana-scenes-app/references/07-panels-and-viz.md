# Panels and visualizations

`VizPanel` is the scene wrapper around any Grafana visualization plugin (timeseries, stat, table, etc.). `PanelBuilders` is a fluent helper that produces correctly-typed `VizPanel` instances.

## PanelBuilders — the fluent API

```ts
import { PanelBuilders } from "@grafana/scenes";

const panel = PanelBuilders.timeseries()
  .setTitle("HTTP requests")
  .setDescription("Rate of incoming requests")
  .setUnit("reqps")
  .setOption("legend", { displayMode: "list", placement: "right" })
  .setOption("tooltip", { mode: "multi", sort: "desc" })
  .setCustomFieldConfig("lineWidth", 2)
  .setCustomFieldConfig("fillOpacity", 10)
  .setColor({ mode: "palette-classic" })
  .setData(queryRunner)
  .setMin(0)
  .setMax(100)
  .setNoValue("-")
  .build();
```

Available builders (each returns a typed builder):

```
PanelBuilders.barchart()
PanelBuilders.bargauge()
PanelBuilders.canvas()
PanelBuilders.dashlist()
PanelBuilders.datagrid()
PanelBuilders.debug()
PanelBuilders.flamegraph()
PanelBuilders.gauge()
PanelBuilders.geomap()
PanelBuilders.heatmap()
PanelBuilders.histogram()
PanelBuilders.logs()
PanelBuilders.news()
PanelBuilders.nodegraph()
PanelBuilders.piechart()
PanelBuilders.stat()
PanelBuilders.statetimeline()
PanelBuilders.statushistory()
PanelBuilders.table()
PanelBuilders.text()
PanelBuilders.timeseries()
PanelBuilders.trend()
PanelBuilders.traces()
PanelBuilders.xychart()
```

`.build()` returns a `VizPanel<TOptions, TFieldConfig>`. The builder enforces types — `setOption('legend', ...)` for a `timeseries` panel is type-checked against the timeseries options interface.

### Common builder methods

```ts
// Display
.setTitle(string)
.setDescription(string)
.setDisplayMode('default' | 'transparent')
.setHoverHeader(boolean)
.setMenu(VizPanelMenu | undefined)

// Data wiring
.setData(SceneDataProvider)
.setTimeRange(SceneTimeRangeLike)

// Field config — defaults
.setUnit('bytes')
.setMin(0)
.setMax(100)
.setDecimals(2)
.setNoValue('-')
.setColor({ mode: 'palette-classic' })
.setMappings([{ type: 'value', options: { '0': { text: 'Off' } } }])
.setThresholds({ mode: 'absolute', steps: [...] })
.setLinks([{ title: 'Open', url: '/path?${__url.params}' }])

// Field config — custom (panel-specific)
.setCustomFieldConfig('lineWidth', 2)

// Field overrides — match fields and customize
.setOverrides((b) => b
  .matchFieldsWithName('errors')
  .overrideColor({ mode: 'fixed', fixedColor: 'red' })
  .overrideUnit('errs/s')
)

// Options (panel-specific)
.setOption('legend', { displayMode: 'list' })

// Behaviors (per-panel)
.setBehaviors([...])
.setHeaderActions([...])
```

## Direct VizPanel construction

For full control or runtime building, construct `VizPanel` directly:

```ts
import { VizPanel } from "@grafana/scenes";

new VizPanel({
  pluginId: "timeseries",
  title: "Custom panel",
  options: { legend: { displayMode: "list" } },
  fieldConfig: {
    defaults: {
      unit: "bytes",
      color: { mode: "palette-classic" },
    },
    overrides: [],
  },
  $data: queryRunner,
});
```

## Panel menu

```ts
import { VizPanelMenu } from "@grafana/scenes";

const menu = new VizPanelMenu({
  items: [
    {
      text: "Open in explore",
      onClick: () => locationService.push("/explore"),
    },
    { type: "divider" },
    { text: "Inspect", onClick: () => {/* ... */} },
  ],
});

PanelBuilders.timeseries()
  .setMenu(menu)
  .build();
```

For a dynamically-built menu:

```ts
const menu = new VizPanelMenu({});
menu.addActivationHandler(() => {
  menu.setState({
    items: computeMenuItems(menu.parent),
  });
});
```

## Header actions

Render arbitrary scene objects in the panel header (right side):

```ts
PanelBuilders.timeseries()
  .setHeaderActions([
    new SceneToolbarInput({ value: "", onChange: (v) => {} }),
  ])
  .build();
```

## Panel context — sharing state across panels

`PanelContext` (Grafana's panel-internal API) is plumbed through automatically. You usually don't need to touch it directly; `CursorSync` and other behaviors use it.

## Runtime panel plugins

Register a panel plugin only known to your scene (not visible to other plugins):

```ts
import { sceneUtils } from "@grafana/scenes";
import { MyPanel } from "./MyPanel";

sceneUtils.registerRuntimePanelPlugin({
  pluginId: "my-runtime-panel",
  plugin: new PanelPlugin(MyPanel)
    .setPanelOptions((b) => b.addTextInput({ path: "title", name: "Title" })),
});

// Then use:
PanelBuilders.custom("my-runtime-panel").setOption("title", "Hello").build();
```

This is powerful for app-specific visualizations that don't merit a full plugin.

## Subheader — adding content below the panel header

```ts
new VizPanel({
  pluginId: "timeseries",
  title: "Trend",
  subHeader: new SceneCanvasText({ text: "Last updated: now" }),
  // ...
});
```

`subHeader` accepts a React node, single scene object, or array of scene objects.

## VizPanelExploreButton

Show an "Explore" button that opens the queries in Grafana Explore:

```ts
import { VizPanelExploreButton } from "@grafana/scenes";

PanelBuilders.timeseries()
  .setHeaderActions([new VizPanelExploreButton({})])
  .build();
```

## Common gotchas

- **Panel doesn't render** — check `pluginId` is a real plugin name and not a typo. Also verify `$data` is set somewhere up the tree.
- **Options autocomplete missing** — make sure `PanelBuilders.<type>()` is the entry point, not `new VizPanel(...)`. The builders carry the options/fieldConfig types.
- **Field config not applying** — `defaults` apply to all fields; `overrides` apply only to matched fields. Verify your matcher.
- **Variables not interpolating in title/option strings** — they should auto-interpolate. If they don't, check the variable is in scope (ancestor `SceneVariableSet`).
- **Stat/gauge shows "No data"** — common when the query returns multiple series with no reduction. Use a `SceneDataTransformer` with `reduce` transformation, or set `options.reduceOptions.calcs = ['lastNotNull']`.
