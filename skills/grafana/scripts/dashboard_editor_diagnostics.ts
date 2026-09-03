#!/usr/bin/env tsx
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectDashboardEditorDiagnosticsInput,
  DashboardDataError,
  type DashboardVisibleDataOptions,
  writeOutput,
} from "./dashboard_visible_data.js";

interface Args {
  dashboard: string;
  grafanaSource: string;
  reportOnly: boolean;
  output?: string;
  format: "text" | "json";
  options: DashboardVisibleDataOptions;
}

interface EditorAlert {
  transformationIndex: number;
  transformationId: string;
  transformationName: string;
  message: string;
}

interface HarnessPanelOutput {
  id: string;
  title: string;
  alerts: EditorAlert[];
  unknownTransformations: Array<{ index: number; id: string }>;
}

interface HarnessOutput {
  schemaVersion: 1;
  grafanaVersion: string;
  dashboard: string;
  panels: HarnessPanelOutput[];
}

interface DiagnosticsOutput {
  schemaVersion: 1;
  dashboard: string;
  sourceGrafanaVersion: string;
  sourceGrafanaCommit: string;
  sourceGrafanaDirty: boolean;
  panels: HarnessPanelOutput[];
  summary: {
    editorAlerts: number;
    unknownTransformations: number;
  };
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const source = resolveGrafanaSource(args.grafanaSource);
  const input = collectDashboardEditorDiagnosticsInput(args.dashboard, args.options);
  const harness = runHarness(source.path, input);

  const panels = harness.panels;
  const output: DiagnosticsOutput = {
    schemaVersion: 1,
    dashboard: harness.dashboard,
    sourceGrafanaVersion: harness.grafanaVersion,
    sourceGrafanaCommit: source.commit,
    sourceGrafanaDirty: source.dirty,
    panels,
    summary: {
      editorAlerts: panels.reduce((total, panel) => total + panel.alerts.length, 0),
      unknownTransformations: panels.reduce((total, panel) => total + panel.unknownTransformations.length, 0),
    },
  };

  const rendered = args.format === "json" ? JSON.stringify(output, null, 2) : renderText(output);
  writeOutput(rendered, args.output);

  if (output.summary.unknownTransformations > 0) {
    return 1;
  }
  return !args.reportOnly && output.summary.editorAlerts > 0 ? 1 : 0;
}

function resolveGrafanaSource(configuredSource: string): {
  path: string;
  version: string;
  commit: string;
  dirty: boolean;
} {
  if (configuredSource) {
    return inspectGrafanaSource(configuredSource);
  }

  const pinnedVersion = pinnedGrafanaVersion();
  const cacheBase = process.env.XDG_CACHE_HOME
    ? path.resolve(process.env.XDG_CACHE_HOME)
    : path.join(os.homedir(), ".cache");
  const source = path.join(cacheBase, "grafana-skill", "editor-diagnostics", `grafana-${pinnedVersion}`);
  if (!fs.existsSync(path.join(source, "package.json"))) {
    bootstrapGrafanaSource(source, pinnedVersion);
  }
  ensureGrafanaFrontendDependencies(source);
  const inspected = inspectGrafanaSource(source);
  if (normalizedVersion(inspected.version) !== normalizedVersion(pinnedVersion)) {
    throw new DashboardDataError(
      `cached Grafana source ${source} is ${inspected.version}, expected pinned release ${pinnedVersion}`,
    );
  }
  return inspected;
}

function pinnedGrafanaVersion(): string {
  const packagePath = path.join(scriptDirectory, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const version = packageJson.dependencies?.["@grafana/data"] || "";
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
    throw new DashboardDataError(`${packagePath} must pin @grafana/data to an exact release version`);
  }
  return version;
}

function bootstrapGrafanaSource(destination: string, version: string): void {
  const parent = path.dirname(destination);
  const temporary = `${destination}.partial-${process.pid}`;
  fs.mkdirSync(parent, { recursive: true });
  if (fs.existsSync(temporary)) {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.error(`Bootstrapping Grafana ${version} editor runtime in ${destination}`);
  try {
    runChecked(
      "git",
      [
        "clone",
        "--depth",
        "1",
        "--filter=blob:none",
        "--single-branch",
        "--branch",
        `v${version}`,
        "https://github.com/grafana/grafana.git",
        temporary,
      ],
      process.cwd(),
      "could not download the pinned Grafana source",
    );
    fs.renameSync(temporary, destination);
  } finally {
    if (fs.existsSync(temporary)) {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
}

function ensureGrafanaFrontendDependencies(source: string): void {
  if (fs.existsSync(path.join(source, "node_modules", "jest"))) {
    return;
  }
  console.error(`Installing Grafana frontend dependencies in ${source}`);
  const useMise = fs.existsSync(path.join(source, "mise.toml")) && commandAvailable("mise");
  const command = useMise ? "mise" : "corepack";
  const args = useMise
    ? ["exec", "--", "corepack", "yarn", "install", "--immutable"]
    : ["yarn", "install", "--immutable"];
  runChecked(command, args, source, "could not install the pinned Grafana frontend dependencies");
}

function runChecked(command: string, args: string[], cwd: string, message: string): void {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) {
    throw new DashboardDataError(`${message}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new DashboardDataError(`${message} (exit ${result.status ?? "unknown"})`);
  }
}

function inspectGrafanaSource(value: string): {
  path: string;
  version: string;
  commit: string;
  dirty: boolean;
} {
  const source = path.resolve(value);
  const packagePath = path.join(source, "package.json");
  const jestConfigPath = path.join(source, "jest.config.js");
  if (!fs.existsSync(packagePath) || !fs.existsSync(jestConfigPath)) {
    throw new DashboardDataError(`${source} is not a Grafana source checkout`);
  }
  if (!fs.existsSync(path.join(source, "node_modules", "jest"))) {
    throw new DashboardDataError(
      `Grafana frontend dependencies are missing; run 'corepack yarn install --immutable' in ${source}`,
    );
  }
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { version?: string };
  const version = packageJson.version || "";
  if (!version) {
    throw new DashboardDataError(`Grafana source package.json has no version: ${packagePath}`);
  }
  const commit = gitOutput(source, ["rev-parse", "HEAD"]);
  const dirty = gitOutput(source, ["status", "--porcelain", "--untracked-files=no"]).length > 0;
  return { path: source, version, commit, dirty };
}

function gitOutput(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new DashboardDataError(result.stderr.trim() || `git ${args.join(" ")} failed in ${cwd}`);
  }
  return result.stdout.trim();
}

function normalizedVersion(value: string): string {
  return value.trim().replace(/\+.*$/, "");
}

function runHarness(source: string, input: unknown): HarnessOutput {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "grafana-editor-diagnostics-"));
  const inputPath = path.join(temporaryDirectory, "input.json");
  const outputPath = path.join(temporaryDirectory, "output.json");
  fs.writeFileSync(inputPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");

  try {
    const jestArgs = [
      "exec",
      "--",
      "corepack",
      "yarn",
      "jest",
      "--runInBand",
      "--silent",
      "--watchAll=false",
      "--config",
      path.join(scriptDirectory, "grafana_editor_diagnostics_jest.config.cjs"),
    ];
    const useMise = fs.existsSync(path.join(source, "mise.toml")) && commandAvailable("mise");
    const command = useMise ? "mise" : "corepack";
    const commandArgs = useMise ? jestArgs : jestArgs.slice(3);
    const result = spawnSync(command, commandArgs, {
      cwd: source,
      encoding: "utf8",
      env: {
        ...process.env,
        GRAFANA_SOURCE: source,
        GRAFANA_EDITOR_DIAGNOSTICS_INPUT: inputPath,
        GRAFANA_EDITOR_DIAGNOSTICS_OUTPUT: outputPath,
      },
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.error) {
      throw new DashboardDataError(`could not start Grafana editor harness: ${result.error.message}`);
    }
    if (result.status !== 0) {
      const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      throw new DashboardDataError(`Grafana editor harness failed${details ? `:\n${details}` : ""}`);
    }
    if (!fs.existsSync(outputPath)) {
      throw new DashboardDataError("Grafana editor harness produced no output");
    }
    const output = JSON.parse(fs.readFileSync(outputPath, "utf8")) as HarnessOutput;
    if (output.schemaVersion !== 1 || !Array.isArray(output.panels)) {
      throw new DashboardDataError("Grafana editor harness produced unsupported output");
    }
    return output;
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function commandAvailable(command: string): boolean {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function renderText(output: DiagnosticsOutput): string {
  const lines = [
    `Dashboard: ${output.dashboard}`,
    `Grafana: source ${output.sourceGrafanaVersion} (${output.sourceGrafanaCommit.slice(0, 12)}${output.sourceGrafanaDirty ? ", dirty" : ""}); input synthetic (one frame per query)`,
  ];

  for (const panel of output.panels) {
    if (!panel.alerts.length && !panel.unknownTransformations.length) {
      continue;
    }
    lines.push("", `Panel ${panel.id}: ${panel.title}`);
    for (const transformation of panel.unknownTransformations) {
      lines.push(`  unknown transformation ${transformation.index + 1}: ${transformation.id}`);
    }
    for (const alert of panel.alerts) {
      lines.push(
        `  editor alert ${alert.transformationIndex + 1}: ${alert.transformationName} (${alert.transformationId}): ${alert.message}`,
      );
    }
  }

  lines.push(
    "",
    `Summary: ${output.summary.editorAlerts} editor alert(s), ${output.summary.unknownTransformations} unknown transformation(s)`,
  );
  return lines.join("\n");
}

function parseArgs(argv: string[]): Args {
  const options: DashboardVisibleDataOptions = {};
  const args: Args = {
    dashboard: "",
    grafanaSource: process.env.GRAFANA_SOURCE || "",
    reportOnly: false,
    format: "text",
    options,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = (): string => {
      const value = argv[++index];
      if (value == null) {
        throw new DashboardDataError(`${arg} expects a value`);
      }
      return value;
    };

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--grafana-source") {
      args.grafanaSource = next();
    } else if (arg === "--report-only") {
      args.reportOnly = true;
    } else if (arg === "--panel-id") {
      options.panelId = next();
    } else if (arg === "--panel-ids") {
      options.panelIds = splitList(next());
    } else if (arg === "--panel-type") {
      options.panelTypes = [...(options.panelTypes ?? []), ...splitList(next())];
    } else if (arg === "--var") {
      options.vars = [...(options.vars ?? []), next()];
    } else if (arg === "--include-hidden-targets") {
      options.includeHiddenTargets = true;
    } else if (arg === "--include-collapsed") {
      options.includeCollapsed = true;
    } else if (arg === "--format") {
      const format = next();
      if (format !== "text" && format !== "json") {
        throw new DashboardDataError("--format expects text or json");
      }
      args.format = format;
    } else if (arg === "--output") {
      args.output = next();
    } else if (arg.startsWith("--")) {
      throw new DashboardDataError(`unknown option ${arg}`);
    } else if (!args.dashboard) {
      args.dashboard = arg;
    } else {
      throw new DashboardDataError(`unexpected argument ${arg}`);
    }
  }

  if (!args.dashboard) {
    throw new DashboardDataError("missing dashboard JSON file");
  }
  return args;
}

function splitList(value: string): string[] {
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (!values.length) {
    throw new DashboardDataError("expected a non-empty comma-separated value");
  }
  return values;
}

function printHelp(): void {
  console.log(`Usage: dashboard_editor_diagnostics.ts <dashboard.json> [options]

Mount Grafana's real transformation editors headlessly with one synthetic frame per query and
report semantic editor alerts. No Grafana server is needed. Editor alerts fail validation unless
--report-only is used. The pinned Grafana source/runtime is cached automatically on first use.

Options:
  --grafana-source PATH       Override the automatically cached pinned Grafana source
  --report-only               Report editor alerts without failing for them
  --panel-id ID               Validate one panel
  --panel-ids ID[,ID...]      Validate selected panels
  --panel-type TYPE           Filter by panel type; repeatable/comma-separated
  --var NAME=VALUE            Override a dashboard variable; repeatable
  --include-hidden-targets    Also run hidden query targets
  --include-collapsed         Include classic panels inside collapsed rows
  --format text|json          Output format (default: text)
  --output FILE               Write output to FILE instead of stdout`);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    const message = error instanceof DashboardDataError ? error.message : (error as Error).stack || String(error);
    console.error(`error: ${message}`);
    process.exitCode = 2;
  },
);
