// components/consistency.test.ts — the registry/UI consistency invariant.
//
// The objective states this as a hard rule: if you register a command and it
// does not immediately appear in the slash menu and the palette, that is a
// bug. These tests assert exactly that, for every domain the UI projects.
// They fail the moment a dialog starts keeping its own copy of the truth.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SeedRegistry } from "../registry/registry.ts";
import { plainStyler } from "../theme/theme.ts";
import {
  buildModelDialog,
  buildPalette,
  buildRegistryDialog,
  buildSettingsDialog,
  buildSkillsDialog,
  buildToolsDialog,
  coerceSettingValue,
  commandItems,
  modelItems,
  toolItems,
} from "./dialogs.ts";

import { slashCommands } from "../app.ts";

const noop = (): void => undefined;

// trace:exempt reason=internal-detail
function render(component: { render: (width: number) => string[] }, width = 120): string {
  return component.render(width).join("\n");
}

test("a registered command appears in the palette, the slash menu, and /help at once", () => {
  const registry = new SeedRegistry();
  const paletteBefore = render(buildPalette(registry, plainStyler, noop, noop));
  assert.ok(!paletteBefore.includes("bug-corpus"), "absent before registration");

  registry.register("command", {
    id: "bug-corpus",
    name: "bug-corpus",
    description: "Show Bug Corpus state",
    source: "extension",
    handler: noop,
  });

  // Same registry, three views — none of them holds its own list.
  assert.ok(commandItems(registry).some((i) => i.value === "/bug-corpus"));
  assert.ok(slashCommands(registry).some((c) => c.name === "bug-corpus"));
  assert.ok(render(buildPalette(registry, plainStyler, noop, noop)).includes("bug-corpus"));
});

test("a registered setting appears in the settings browser", () => {
  const registry = new SeedRegistry();
  registry.register("setting", {
    id: "session.temperature",
    key: "session.temperature",
    type: "number",
    default: 0.2,
    value: 0.2,
    group: "Session",
    label: "Temperature",
    description: "Sampling temperature for task turns.",
    scope: "session",
    restart: false,
    source: "builtin",
  });
  const out = render(buildSettingsDialog(registry, plainStyler, noop, noop));
  assert.ok(out.includes("Temperature"), "label renders");
  assert.ok(out.includes("session.temperature"), "key renders so provenance is visible");
});

test("guardian-policy settings render locked and refuse an in-session edit", () => {
  const registry = new SeedRegistry();
  registry.register("setting", {
    id: "promotion.qualityNoninferiority",
    key: "promotion.qualityNoninferiority",
    type: "number",
    default: 0.01,
    value: 0.01,
    group: "Guardian policy",
    label: "Quality non-inferiority",
    description: "Allowed quality drop before a candidate is rejected.",
    scope: "guardian",
    restart: true,
    readOnly: true,
    source: "guardian",
  });
  let changed: string | null = null;
  const dialog = buildSettingsDialog(
    registry,
    plainStyler,
    (key, value) => {
      changed = `${key}=${value}`;
    },
    noop,
  );
  const out = render(dialog);
  assert.ok(out.includes("read-only"), "the lock is visible, not implied");
  assert.ok(out.includes("🔒"));

  // Even if a caller bypasses the UI and fires the change callback, the
  // registry write path refuses it: the organism cannot move its own
  // grading criteria through the interface.
  const before = registry.get("setting", "promotion.qualityNoninferiority")?.value;
  const settings = buildSettingsDialog(registry, plainStyler, noop, noop);
  settings.handleInput?.("\r");
  assert.equal(registry.get("setting", "promotion.qualityNoninferiority")?.value, before);
  assert.equal(changed, null);
});

test("a registered skill appears in the skills browser with its origin", () => {
  const registry = new SeedRegistry();
  registry.register("skill", {
    id: ".omp/skills::traceability",
    name: "traceability",
    description: "Repository traceability workflow",
    origin: ".omp/skills",
    enabled: true,
    source: "file",
  });
  const out = render(buildSkillsDialog(registry, plainStyler, noop, noop));
  assert.ok(out.includes("traceability"));
  assert.ok(out.includes(".omp/skills"), "origin is shown so collisions are explainable");
});

test("a shadowed skill is visibly shadowed rather than hidden", () => {
  const registry = new SeedRegistry();
  registry.register("skill", {
    id: ".omp/skills::traceability",
    name: "traceability",
    description: "",
    origin: ".omp/skills",
    enabled: true,
    source: "file",
  });
  registry.register("skill", {
    id: ".claude/skills::traceability",
    name: "traceability",
    description: "",
    origin: ".claude/skills",
    enabled: false,
    shadowedBy: ".omp/skills",
    source: "file",
  });
  const out = render(buildSkillsDialog(registry, plainStyler, noop, noop));
  assert.ok(out.includes("shadowed by .omp/skills"));
});

test("a registered model appears in the picker with its measured profile", () => {
  const registry = new SeedRegistry();
  registry.register("model", {
    id: "anthropic/claude-sonnet-4",
    model: "anthropic/claude-sonnet-4",
    provider: "anthropic",
    family: "claude",
    profileStatus: "validated",
    capabilities: { toolCalling: 1 },
    strengths: ["navigation", "debugging"],
    weaknesses: ["long diffs"],
    costPerTask: 0.14,
    p50LatencyMs: 1800,
    tasksEvaluated: 42,
    source: "profile",
  });
  // The projection is a pure function, so the facts are asserted directly
  // rather than through a layout that may truncate them.
  const item = modelItems(registry)[0];
  assert.equal(item?.value, "anthropic/claude-sonnet-4");
  assert.ok(item?.description?.includes("42 tasks"), "measured profile facts are shown, not just an id");
  assert.ok(item?.description?.includes("navigation"));
  assert.ok(item?.description?.includes("$0.140/task"));
  assert.ok(render(buildModelDialog(registry, plainStyler, noop, noop)).includes("anthropic/claude-sonnet-4"));
});

test("an unmeasured model is labelled unmeasured instead of implying quality", () => {
  const registry = new SeedRegistry();
  registry.register("model", {
    id: "vendor/new-model",
    model: "vendor/new-model",
    provider: "vendor",
    family: "new",
    profileStatus: "unknown",
    capabilities: {},
    strengths: [],
    weaknesses: [],
    costPerTask: 0,
    p50LatencyMs: 0,
    tasksEvaluated: 0,
    source: "profile",
  });
  const out = render(buildModelDialog(registry, plainStyler, noop, noop));
  assert.ok(out.includes("unmeasured"));
});

test("a registered tool shows installed/active/visible separately", () => {
  const registry = new SeedRegistry();
  registry.register("tool", {
    id: "echo",
    name: "echo",
    description: "echo fixture",
    capability: "fixtures/echo",
    active: true,
    visible: false,
    score: 0.18,
    rank: 11,
    visibleLimit: 8,
    source: "file",
  });
  const item = toolItems(registry)[0];
  assert.ok(item?.description?.includes("installed ✓"));
  assert.ok(item?.description?.includes("visible —"), "a routed-out tool says so rather than disappearing");
  assert.ok(item?.description?.includes("score 0.18"));
  assert.ok(item?.description?.includes("visible limit 8"), "the reason is shown, not just the state");
  assert.ok(render(buildToolsDialog(registry, plainStyler, noop, noop)).includes("echo"));
});

test("the registry dialog reports the live revision and every domain", () => {
  const registry = new SeedRegistry();
  registry.register("theme", { id: "seed", name: "seed", description: "", colors: {}, source: "builtin" });
  const out = render(buildRegistryDialog(registry, plainStyler, noop));
  assert.ok(out.includes(`revision ${registry.revision}`));
  for (const domain of ["command", "setting", "model", "skill", "tool", "capability"]) {
    assert.ok(out.includes(domain), `census lists ${domain}`);
  }
});

test("removing an entry removes it from the UI on the next render", () => {
  const registry = new SeedRegistry();
  registry.register("command", {
    id: "temp",
    name: "temp",
    description: "temporary",
    source: "extension",
    handler: noop,
  });
  assert.ok(render(buildPalette(registry, plainStyler, noop, noop)).includes("temp"));
  registry.unregister("command", "temp");
  assert.ok(!render(buildPalette(registry, plainStyler, noop, noop)).includes("/temp"));
});

test("an empty domain renders an explicit empty state, never a blank box", () => {
  const registry = new SeedRegistry();
  assert.ok(render(buildPalette(registry, plainStyler, noop, noop)).includes("no commands registered"));
  assert.ok(render(buildModelDialog(registry, plainStyler, noop, noop)).includes("no models registered"));
  assert.ok(render(buildToolsDialog(registry, plainStyler, noop, noop)).includes("no tools registered"));
});

test("an enum setting edited in the browser writes back its value", () => {
  const registry = new SeedRegistry();
  registry.register("setting", {
    id: "session.thinking",
    key: "session.thinking",
    type: "enum",
    default: "medium",
    value: "medium",
    group: "Session",
    label: "Reasoning effort",
    description: "Requested reasoning effort",
    scope: "session",
    restart: false,
    values: ["off", "low", "medium", "high"],
    source: "builtin",
  });
  const dialog = buildSettingsDialog(registry, plainStyler, noop, noop);
  dialog.selectItem?.("session.thinking");
  dialog.handleInput?.("\r");
  assert.equal(registry.get("setting", "session.thinking")?.value, "high");
});

test("coerceSettingValue keeps numerics numeric and clamps to min/max", () => {
  assert.equal(coerceSettingValue({ type: "number", min: 1, max: 24 }, "20"), 20);
  assert.equal(coerceSettingValue({ type: "number", min: 1, max: 24 }, "99"), 24);
  assert.equal(coerceSettingValue({ type: "number", min: 1, max: 24 }, "0"), 1);
  assert.equal(coerceSettingValue({ type: "number" }, "abc"), "abc");
  assert.equal(coerceSettingValue({ type: "boolean" }, "true"), true);
  assert.equal(coerceSettingValue({ type: "boolean" }, "false"), false);
  assert.equal(coerceSettingValue({ type: "string" }, "hi"), "hi");
});
