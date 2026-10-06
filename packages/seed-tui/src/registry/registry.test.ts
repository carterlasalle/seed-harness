// registry/registry.test.ts — the live registry's contract.
//
// These tests exist because "the UI is a projection of the registry" is only
// true if the registry actually publishes every mutation and reflects it
// immediately. Each case below fails if that stops being true.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SeedRegistry, seedRegistry } from "./registry.ts";
import { REGISTRY_DOMAINS } from "./types.ts";
import type { CommandEntry, RegistryEvent } from "./types.ts";

// trace:exempt reason=internal-detail
function command(name: string, description = ""): CommandEntry {
  return { id: name, name, description, source: "builtin", handler: () => undefined };
}

test("every mutation publishes exactly one event with an increasing revision", () => {
  const registry = new SeedRegistry();
  const seen: RegistryEvent[] = [];
  registry.on((event) => seen.push(event));

  assert.equal(registry.register("command", command("one")), "added");
  assert.equal(registry.register("command", command("two")), "added");
  registry.register("command", command("one", "changed"));
  registry.unregister("command", "two");

  assert.equal(seen.length, 4, "one event per successful mutation");
  assert.deepEqual(
    seen.map((e) => e.type),
    ["added", "added", "updated", "removed"],
  );
  for (let i = 1; i < seen.length; i += 1) {
    assert.ok(
      (seen[i] as RegistryEvent).revision > (seen[i - 1] as RegistryEvent).revision,
      "revision strictly increases",
    );
  }
  assert.equal(registry.revision, 4);
});

test("a mutation is visible to the next read with no restart", () => {
  const registry = seedRegistry();
  assert.equal(registry.get("skill", "traceability"), null);
  registry.register("skill", {
    id: "traceability",
    name: "traceability",
    description: "traced workflow",
    origin: ".omp/skills",
    enabled: true,
    source: "file",
  });
  assert.equal(registry.get("skill", "traceability")?.name, "traceability");
  assert.equal(registry.size("skill"), 1);
});

test("unregistering an unknown id publishes nothing", () => {
  const registry = new SeedRegistry();
  let events = 0;
  registry.on(() => {
    events += 1;
  });
  assert.equal(registry.unregister("model", "nope"), false);
  assert.equal(events, 0, "a no-op is not a mutation");
  assert.equal(registry.revision, 0);
});

test("replaceAll reports added, updated, and removed, then resets the domain", () => {
  const registry = new SeedRegistry();
  registry.register("model", modelEntry("a", "1.0"));
  registry.register("model", modelEntry("b", "1.0"));

  const seen: RegistryEvent[] = [];
  registry.on((event) => seen.push(event));

  const count = registry.replaceAll("model", [modelEntry("a", "2.0"), modelEntry("c", "1.0")]);

  assert.equal(count, 2);
  const types = seen.map((e) => `${e.type}:${e.id}`);
  assert.ok(types.includes("updated:a"), `expected updated:a in ${types.join(",")}`);
  assert.ok(types.includes("added:c"), `expected added:c in ${types.join(",")}`);
  assert.ok(types.includes("removed:b"), `expected removed:b in ${types.join(",")}`);
  assert.equal(seen.at(-1)?.type, "reset");
  assert.deepEqual(
    registry.list("model").map((m) => m.id),
    ["a", "c"],
  );
});

test("replaceAll with identical entries reports no changes", () => {
  const registry = new SeedRegistry();
  registry.replaceAll("model", [modelEntry("a", "1.0")]);
  const seen: RegistryEvent[] = [];
  registry.on((event) => seen.push(event));
  registry.replaceAll("model", [modelEntry("a", "1.0")]);
  assert.deepEqual(
    seen.map((e) => e.type),
    ["reset"],
    "an unchanged rediscovery must not churn the UI",
  );
});

test("list is sorted by id so every surface renders the same order", () => {
  const registry = new SeedRegistry();
  for (const id of ["zulu", "alpha", "mike"]) registry.register("command", command(id));
  assert.deepEqual(
    registry.list("command").map((c) => c.id),
    ["alpha", "mike", "zulu"],
  );
});

test("census covers every domain and snapshot exposes them all", () => {
  const registry = new SeedRegistry();
  registry.register("theme", { id: "seed", name: "seed", description: "", colors: {}, source: "builtin" });
  const census = registry.census();
  assert.equal(census.length, REGISTRY_DOMAINS.length);
  assert.equal(census.find((c) => c.domain === "theme")?.count, 1);
  assert.equal(census.find((c) => c.domain === "model")?.count, 0);
  assert.equal(registry.snapshot().theme.length, 1);
});

test("unsubscribing stops delivery", () => {
  const registry = new SeedRegistry();
  let events = 0;
  const off = registry.on(() => {
    events += 1;
  });
  registry.register("command", command("a"));
  off();
  registry.register("command", command("b"));
  assert.equal(events, 1);
});

// trace:exempt reason=internal-detail
function modelEntry(id: string, version: string): {
  id: string;
  model: string;
  provider: string;
  family: string;
  profileStatus: "unknown";
  capabilities: Record<string, number>;
  strengths: string[];
  weaknesses: string[];
  costPerTask: number;
  p50LatencyMs: number;
  tasksEvaluated: number;
  source: "profile";
} {
  return {
    id,
    model: id,
    provider: "test",
    family: version,
    profileStatus: "unknown",
    capabilities: {},
    strengths: [],
    weaknesses: [],
    costPerTask: 0,
    p50LatencyMs: 0,
    tasksEvaluated: 0,
    source: "profile",
  };
}
