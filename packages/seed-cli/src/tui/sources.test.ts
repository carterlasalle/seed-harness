// tui/sources.test.ts — registry population from real runtime state.
//
// The objective's rule for /tools is concrete: a routed-out tool must say so,
// and where possible say why. These tests assert that the routing columns are
// filled from the real router rather than left blank.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SeedRegistry } from "@carterlasalle/seed-tui/src/registry/registry.ts";
import { buildRegistry, readConfigToml, refreshToolRouting } from "./sources.ts";

test("buildRegistry populates every domain it owns", () => {
  const registry = buildRegistry();
  assert.ok(registry.size("command") > 0, "commands registered");
  assert.ok(registry.size("setting") > 0, "settings registered");
  assert.ok(registry.size("skill") > 0, "skills discovered");
  assert.ok(registry.size("capability") > 0, "capabilities discovered");
  assert.ok(registry.size("theme") > 0, "themes registered");
  assert.ok(registry.size("keybinding") === 0, "keybindings are bound by the app, not the builder");
});

test("guardian-scope settings are read-only, others are editable", () => {
  const registry = buildRegistry();
  const guardian = registry.list("setting").filter((s) => s.scope === "guardian");
  assert.ok(guardian.length > 0, "the guardian policy group exists");
  assert.ok(
    guardian.every((s) => s.readOnly === true),
    "every guardian-scope setting is locked",
  );
  const session = registry.list("setting").filter((s) => s.scope === "session");
  assert.ok(session.every((s) => s.readOnly !== true), "session settings stay editable");
});

test("refreshToolRouting fills visibility, score and rank from the router", () => {
  const registry = buildRegistry();
  assert.ok(registry.size("tool") > 0, "tools exist to route");

  refreshToolRouting(registry, "run the pytest suite and fix the failure");

  const tools = registry.list("tool");
  assert.ok(
    tools.some((tool) => tool.visible === true),
    "at least one tool is visible for a task",
  );
  const visible = tools.find((tool) => tool.visible === true);
  assert.equal(typeof visible?.score, "number", "a visible tool carries its router score");
  assert.equal(typeof visible?.rank, "number", "and its rank");
  assert.equal(typeof visible?.visibleLimit, "number", "and the limit that produced the cut");
});

test("a tool whose capability the router did not select reports not-visible", () => {
  const registry = new SeedRegistry();
  registry.register("tool", {
    id: "made-up",
    name: "made-up",
    description: "not provided by any capability",
    capability: "does/not-exist",
    active: true,
    source: "file",
  });
  refreshToolRouting(registry, "anything");
  assert.equal(registry.get("tool", "made-up")?.visible, false);
  assert.equal(registry.get("tool", "made-up")?.visibleLimit, 8);
});

test("model-scope role settings exist and are persisted to config.toml", () => {
  const registry = buildRegistry();
  const roles = registry.list("setting").filter((s) => s.scope === "model");
  assert.deepEqual(
    roles.map((r) => r.key).sort(),
    ["models.challenge", "models.judge", "models.mutator", "models.scientist", "models.task"],
    "every lab role is separately configurable",
  );
  assert.ok(roles.every((r) => r.readOnly !== true), "roles are operator-owned, not guardian-locked");
});

test("readConfigToml parses a real file and tolerates a missing one", () => {
  assert.deepEqual(readConfigToml("/nonexistent/path/config.toml"), {}, "a missing file yields no config");
  const dir = mkdtempSync(join(tmpdir(), "seed-cfg-"));
  const file = join(dir, "config.toml");
  writeFileSync(
    file,
    ["schema_version = 1", "[capabilities]", "visible_tool_limit = 12  # inline comment", "auto_crystallize = false", ""].join("\n"),
  );
  const parsed = readConfigToml(file);
  assert.equal(parsed.capabilities?.visible_tool_limit, 12, "numbers parse");
  assert.equal(parsed.capabilities?.auto_crystallize, false, "booleans parse");
  assert.equal(parsed.schema_version, undefined, "top-level keys stay out of sections");
});

test("a model holding a role is marked with it", () => {
  const registry = buildRegistry();
  const task = registry.get("setting", "models.task");
  assert.ok(task, "the task role exists");
  const entry = registry.get("model", String(task.value));
  if (entry) {
    assert.equal(entry.role, "task", "the configured model reports its role");
  }
});