// tui/sources.ts — populate the live registry from real runtime state.
//
// Purpose: the single place where Seed's runtime facts (capabilities, models,
// skills, settings, commands) become registry entries the interactive
// frontend projects.
// Why it exists: the TUI must never hard-code a second copy of what the
// runtime knows; everything it shows is registered here from the same
// functions the headless CLI calls.
// Responsibilities: read capabilities/models/skills/config, register them,
// and register the engine-backed commands that share the CLI's handlers.
// Invariants: read-only against the filesystem; every registration goes
// through SeedRegistry (so it emits an event); missing sources register
// nothing rather than inventing entries.
// Public functions: buildRegistry, readConfigToml.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SeedRegistry, seedRegistry } from "@carterlasalle/seed-tui/src/registry/registry.ts";
import type {
  CapabilityEntry,
  CommandEntry,
  ModelEntry,
  SettingEntry,
  ToolEntry,
} from "@carterlasalle/seed-tui/src/registry/types.ts";
import { registerCoreCommands } from "@carterlasalle/seed-tui/src/commands/builtin.ts";
import { discoverCapabilities } from "../capabilities.ts";
import { listModels } from "../models.ts";
import { runDoctor } from "../doctor.ts";
import { showChampion } from "../champion.ts";
import { recentRuns, seedRoot, stateDir } from "../state.ts";
import { SETTINGS_SCHEMA, isPersisted, tomlPath } from "./settings-schema.ts";
import { discoverSkills } from "./skills.ts";

/** Minimal `[section] key = value` reader for ~/.seed/config.toml. */
// trace:v1 id=impl.cli-tui-config-read work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function readConfigToml(path: string): Record<string, Record<string, unknown>> {
  if (!existsSync(path)) return {};
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  const out: Record<string, Record<string, unknown>> = {};
  let section = "";
  // trace:exempt reason=internal-detail
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line.length === 0) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    // trace:exempt reason=internal-detail
    if (header) {
      section = (header[1] ?? "").trim();
      out[section] ??= {};
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv || section.length === 0) continue;
    const key = kv[1] ?? "";
    const raw = (kv[2] ?? "").trim();
    let value: unknown = raw;
    if (raw === "true" || raw === "false") value = raw === "true";
    else if (/^-?\d+(\.\d+)?$/.test(raw)) value = Number(raw);
    else if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      value = raw.slice(1, -1);
    }
    out[section] ??= {};
    out[section][key] = value;
  }
  return out;
}

// trace:exempt reason=internal-detail
function settingEntries(): SettingEntry[] {
  const config = readConfigToml(join(process.env.HOME ?? "", ".seed", "config.toml"));
  return SETTINGS_SCHEMA.map((def) => {
    let value = def.default;
    // trace:exempt reason=internal-detail
    if (isPersisted(def)) {
      const path = tomlPath(def.key);
      // trace:exempt reason=internal-detail
      if (path) {
        const section = config[path.section];
        if (section && section[path.key] !== undefined) value = section[path.key];
      }
    }
    return {
      id: def.key,
      key: def.key,
      type: def.type,
      default: def.default,
      value,
      group: def.group,
      label: def.label,
      description: def.description,
      scope: def.scope,
      restart: def.restart,
      ...(def.min !== undefined ? { min: def.min } : {}),
      ...(def.max !== undefined ? { max: def.max } : {}),
      ...(def.values ? { values: [...def.values] } : {}),
      ...(def.readOnly ? { readOnly: true } : {}),
      source: def.scope === "guardian" ? "guardian" : "builtin",
    };
  });
}

// trace:exempt reason=internal-detail
function modelEntries(root?: string): ModelEntry[] {
  return listModels(root).map((profile) => ({
    id: profile.model,
    model: profile.model,
    provider: profile.provider ?? "unknown",
    family: profile.family ?? "unknown",
    profileStatus: profile.profileStatus,
    capabilities: { ...profile.capabilities },
    strengths: [...profile.strengths],
    weaknesses: [...profile.weaknesses],
    costPerTask: profile.costPerTask,
    p50LatencyMs: profile.p50LatencyMs,
    tasksEvaluated: profile.tasksEvaluated,
    source: "profile",
  }));
}

// trace:exempt reason=internal-detail
function capabilityEntries(root?: string): CapabilityEntry[] {
  return discoverCapabilities(root).map((manifest) => ({
    id: manifest.name,
    name: manifest.name,
    version: manifest.version,
    kind: manifest.kind,
    description: manifest.description ?? "",
    dir: manifest.dir,
    permissions: [...(manifest.permissions ?? [])],
    tools: [...(manifest.tools ?? [])],
    source: "file",
  }));
}

/** One tool entry per tool a capability declares; the router decides visibility. */
// trace:exempt reason=internal-detail
function toolEntries(capabilities: CapabilityEntry[], visibleLimit: number): ToolEntry[] {
  const out: ToolEntry[] = [];
  // trace:exempt reason=internal-detail
  for (const capability of capabilities) {
    // trace:exempt reason=internal-detail
    for (const tool of capability.tools) {
      out.push({
        id: tool,
        name: tool,
        description: capability.description,
        capability: capability.name,
        active: true,
        visibleLimit,
        source: "file",
      });
    }
  }
  return out;
}

/**
 * Build the populated registry. This is the one call the interactive
 * frontend and any headless inspector share.
 */
// trace:v1 id=impl.cli-tui-build-registry work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function buildRegistry(root?: string): SeedRegistry {
  const registry = seedRegistry();
  const repo = seedRoot(root);

  for (const entry of settingEntries()) registry.register("setting", entry);
  for (const entry of modelEntries(root)) registry.register("model", entry);

  const skills = discoverSkills(repo);
  for (const entry of skills) registry.register("skill", entry);

  const capabilities = capabilityEntries(root);
  for (const entry of capabilities) registry.register("capability", entry);

  const visibleLimitSetting = registry.get("setting", "capabilities.visibleToolLimit");
  const visibleLimit =
    typeof visibleLimitSetting?.value === "number" ? visibleLimitSetting.value : 8;
  for (const entry of toolEntries(capabilities, visibleLimit)) registry.register("tool", entry);

  registerCoreCommands(registry);
  registerEngineCommands(registry);
  registerRenderers(registry);
  return registry;
}

/** Commands whose handlers are the same functions the headless CLI calls. */
// trace:v1 id=impl.cli-tui-engine-commands work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function registerEngineCommands(registry: SeedRegistry): void {
  // trace:exempt reason=internal-detail
  const add = (name: string, description: string, run: (root?: string) => Promise<string> | string): void => {
    const entry: CommandEntry = {
      id: name,
      name,
      description,
      source: "builtin",
      handler: async (_args, ctx) => {
        ctx.print(await run());
      },
    };
    registry.register("command", entry);
  };

  // trace:exempt reason=internal-detail
  add("doctor", "Environment and state health checks", async () => {
    const report = await runDoctor();
    return report.checks.map((c) => `${c.ok ? "ok" : "FAIL"} ${c.name}: ${c.detail}`).join("\n");
  });
  // trace:exempt reason=internal-detail
  add("champion", "Current champion pointer and history", async () => {
    const pointer = await showChampion();
    const history = pointer.history
      .slice(-5)
      .map((h) => `${h.ref}  ${h.reason}`)
      .join("\n");
    return `champion ${pointer.ref}${history ? `\n${history}` : ""}`;
  });
  // trace:exempt reason=internal-detail
  add("capabilities", "List capability manifests", () => {
    const caps = discoverCapabilities();
    return caps.length === 0
      ? "no capabilities discovered"
      : caps.map((c) => `${c.name}@${c.version} [${c.kind}] ${c.description ?? ""}`).join("\n");
  });
  // trace:exempt reason=internal-detail
  add("status", "Queue depth and recent runs", () => {
    const runs = recentRuns(5);
    return runs.length === 0
      ? "no runs recorded"
      : runs.map((r) => `${r.ok ? "ok" : "failed"} ${r.id} ${r.prompt.slice(0, 60)}`).join("\n");
  });
  add("paths", "Resolved state locations", () =>
    `repo   ${seedRoot()}\nstate  ${stateDir()}`,
  );
}

/** Built-in renderers so a tool card never falls back to raw JSON. */
// trace:v1 id=impl.cli-tui-renderers work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function registerRenderers(registry: SeedRegistry): void {
  const renderers = [
    { for: "python", summary: "python turn" },
    { for: "echo", summary: "capability echo" },
    { for: "tool", summary: "tool call" },
  ];
  // trace:exempt reason=internal-detail
  for (const r of renderers) {
    registry.register("renderer", {
      id: r.for,
      for: r.for,
      summary: r.summary,
      source: "builtin",
    });
  }
}
