import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { DataFrame } from "@grafana/data";

import {
  applyGrafanaTransformations,
  collectDashboardEditorDiagnosticsInput,
  dataTransformerConfigs,
  initGrafanaDataForCli,
  materializeJoinLabelFields,
  type JsonObject,
} from "./dashboard_visible_data.ts";

test("editor diagnostics use synthetic frames without a Grafana endpoint", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grafana-editor-synthetic-test-"));
  const dashboard = path.join(directory, "dashboard.json");
  fs.writeFileSync(dashboard, JSON.stringify({
    title: "Synthetic diagnostics test",
    panels: [{
      id: 8,
      title: "Status",
      type: "table",
      targets: [{ refId: "A", expr: "up" }, { refId: "B", expr: "process_start_time_seconds" }],
      transformations: [{ id: "merge", options: {}, filter: { id: "byRefId", options: "A" } }],
    }],
  }));

  try {
    const captured = collectDashboardEditorDiagnosticsInput(dashboard, { panelId: "8" });
    assert.deepEqual(captured.panels[0].frames, [
      {
        schema: {
          name: "A",
          refId: "A",
          fields: [{ name: "Value", type: "number" }],
        },
        data: { values: [[1]] },
      },
      {
        schema: {
          name: "B",
          refId: "B",
          fields: [{ name: "Value", type: "number" }],
        },
        data: { values: [[2]] },
      },
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("classic and stable-v2 transformations normalize to Grafana runtime configs", () => {
  assert.deepEqual(
    dataTransformerConfigs([
      {
        id: "merge",
        options: { mode: "outer" },
        filter: { id: "byRefId", options: "A" },
        disabled: true,
        topic: "series",
      },
      {
        kind: "Transformation",
        group: "organize",
        spec: {
          options: { renameByName: { Value: "State" } },
          filter: { id: "byRefId", options: "B" },
          disabled: false,
          topic: "annotations",
        },
      },
    ]),
    [
      {
        id: "merge",
        options: { mode: "outer" },
        filter: { id: "byRefId", options: "A" },
        disabled: true,
        topic: "series",
      },
      {
        id: "organize",
        options: { renameByName: { Value: "State" } },
        filter: { id: "byRefId", options: "B" },
        disabled: false,
        topic: "annotations",
      },
    ],
  );
});

function prometheusFrame(refId: string, source: string, value: number): DataFrame {
  return {
    refId,
    length: 1,
    fields: [
      {
        name: "Value",
        type: "number" as DataFrame["fields"][number]["type"],
        config: {},
        values: [value],
        labels: { source },
      },
    ],
  };
}

function inventoryTransformations(stableV2: boolean): JsonObject[] {
  const transform = (id: string, options: JsonObject, filter?: JsonObject): JsonObject => stableV2
    ? {
        kind: "Transformation",
        group: id,
        spec: { options, ...(filter ? { filter } : {}) },
      }
    : { id, options, ...(filter ? { filter } : {}) };
  const byRefId = (options: string): JsonObject => ({ id: "byRefId", options });
  const metric = (refId: string, displayName: string): JsonObject[] => [
    transform("merge", {}, byRefId(refId)),
    transform(
      "organize",
      { renameByName: { Value: displayName } },
      byRefId(`/^(?:${refId}|merge-${refId}(?:-${refId})*)$/`),
    ),
  ];

  return [
    transform("labelsToFields", { mode: "columns" }),
    ...metric("A", "State"),
    ...metric("B", "Temperature"),
    transform("joinByField", { byField: "source", mode: "outer" }),
  ];
}

async function renderInventory(frames: DataFrame[], stableV2: boolean): Promise<DataFrame> {
  initGrafanaDataForCli();
  const transformations = inventoryTransformations(stableV2);
  const warnings: string[] = [];
  const materialized = materializeJoinLabelFields(frames, transformations);
  const transformed = await applyGrafanaTransformations(materialized, transformations, {}, warnings);

  assert.deepEqual(warnings, []);
  assert.equal(transformed.length, 1);
  return transformed[0];
}

function displayName(field: DataFrame["fields"][number]): string {
  return field.config.displayName || field.name;
}

test("classic refId filters keep one inventory row per entity", async () => {
  const frame = await renderInventory(
    [
      prometheusFrame("A", "host-1", 2),
      prometheusFrame("A", "host-2", 1),
      prometheusFrame("B", "host-1", 58),
      prometheusFrame("B", "host-2", 61),
    ],
    false,
  );

  assert.equal(frame.length, 2);
  assert.deepEqual(frame.fields.map(displayName), ["source", "State", "Temperature"]);
  assert.deepEqual(frame.fields[0].values, ["host-1", "host-2"]);
  assert.deepEqual(frame.fields[1].values, [2, 1]);
  assert.deepEqual(frame.fields[2].values, [58, 61]);
});

test("stable-v2 spec.filter works for a single entity without duplicate join fields", async () => {
  const frame = await renderInventory(
    [
      prometheusFrame("A", "host-1", 2),
      prometheusFrame("B", "host-1", 58),
    ],
    true,
  );

  assert.equal(frame.length, 1);
  assert.deepEqual(frame.fields.map(displayName), ["source", "State", "Temperature"]);
  assert.equal(frame.fields.filter((field) => field.name === "source").length, 1);
  assert.deepEqual(frame.fields[0].values, ["host-1"]);
});
