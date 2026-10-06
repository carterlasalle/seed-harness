// registry/watch.test.ts — filesystem-backed domains stay live.
//
// The objective's requirement is concrete: "I add it and it shows up." These
// tests add a file and assert the registry — and therefore every surface
// projecting it — shows the new entry without a restart.
//
// Determinism: the synchronous path is driven by `flush()`. The one test that
// exercises the real fs.watch path awaits the refresh signal itself rather
// than sleeping, so it cannot flake under load.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SeedRegistry } from "./registry.ts";
import { watchRegistry } from "./watch.ts";
import type { RegistryWatcher } from "./watch.ts";
import type { SkillEntry } from "./types.ts";

// trace:exempt reason=internal-detail
function skillDir(): string {
  return mkdtempSync(join(tmpdir(), "seed-watch-"));
}

/** Discovery that reads real files, so the watcher has something to observe. */
// trace:exempt reason=internal-detail
function discoverFrom(dir: string): SkillEntry[] {
  const entries: SkillEntry[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return entries;
  }
  for (const name of names) {
    entries.push({
      id: `test::${name}`,
      name,
      description: "",
      origin: "test",
      enabled: true,
      source: "file",
    });
  }
  return entries;
}

test("flush() rediscovers a domain synchronously", () => {
  const dir = skillDir();
  const registry = new SeedRegistry();
  const watcher = watchRegistry(registry, [
    { domain: "skill", dirs: [dir], discover: () => discoverFrom(dir) },
  ]);

  watcher.flush();
  assert.equal(registry.size("skill"), 0, "empty directory registers nothing");

  mkdirSync(join(dir, "traceability"));
  watcher.flush();
  assert.equal(registry.size("skill"), 1);
  assert.equal(registry.get("skill", "test::traceability")?.name, "traceability");

  watcher.stop();
});

test("a newly added entry appears with no restart and no reload command", () => {
  const dir = skillDir();
  const registry = new SeedRegistry();
  const watcher = watchRegistry(registry, [
    { domain: "skill", dirs: [dir], discover: () => discoverFrom(dir) },
  ]);
  watcher.flush();

  mkdirSync(join(dir, "alpha"));
  watcher.flush();
  assert.deepEqual(registry.list("skill").map((s) => s.name), ["alpha"]);

  // The whole point: drop in another one and it is simply there.
  mkdirSync(join(dir, "beta"));
  watcher.flush();
  assert.deepEqual(registry.list("skill").map((s) => s.name), ["alpha", "beta"]);

  watcher.stop();
});

test("a removed entry disappears from the registry", () => {
  const dir = skillDir();
  mkdirSync(join(dir, "gone"));
  const registry = new SeedRegistry();
  const watcher = watchRegistry(registry, [
    { domain: "skill", dirs: [dir], discover: () => discoverFrom(dir) },
  ]);
  watcher.flush();
  assert.equal(registry.size("skill"), 1);

  rmdirSync(join(dir, "gone"));
  watcher.flush();
  assert.equal(registry.size("skill"), 0);

  watcher.stop();
});

test("a refresh publishes registry events so the UI repaints", () => {
  const dir = skillDir();
  const registry = new SeedRegistry();
  const watcher = watchRegistry(registry, [
    { domain: "skill", dirs: [dir], discover: () => discoverFrom(dir) },
  ]);
  const seen: string[] = [];
  registry.on((event) => seen.push(`${event.type}:${event.id}`));

  mkdirSync(join(dir, "fresh"));
  watcher.flush();

  assert.ok(seen.includes("added:test::fresh"), `expected an added event, saw ${seen.join(",")}`);
  assert.equal(seen.at(-1), "reset:*", "a bulk rediscovery ends with a domain reset");
  watcher.stop();
});

test("a missing directory is not an error", () => {
  const registry = new SeedRegistry();
  const watcher = watchRegistry(registry, [
    {
      domain: "capability",
      dirs: [join(tmpdir(), "seed-watch-does-not-exist")],
      discover: () => [],
    },
  ]);
  watcher.flush();
  assert.equal(registry.size("capability"), 0);
  watcher.stop();
});

test("stop() releases watchers and a stopped watcher stops refreshing", () => {
  const dir = skillDir();
  const registry = new SeedRegistry();
  const watcher = watchRegistry(registry, [
    { domain: "skill", dirs: [dir], discover: () => discoverFrom(dir) },
  ]);
  watcher.flush();
  watcher.stop();

  mkdirSync(join(dir, "after-stop"));
  watcher.flush();
  assert.equal(registry.size("skill"), 0, "a stopped watcher must not keep mutating the registry");
});

test("a real filesystem change eventually refreshes through fs.watch", async () => {
  const dir = skillDir();
  const registry = new SeedRegistry();
  let watcher: RegistryWatcher | null = null;
  try {
    let resolveRefresh = (): void => undefined;
    const refreshed = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    watcher = watchRegistry(
      registry,
      [{ domain: "skill", dirs: [dir], discover: () => discoverFrom(dir) }],
      // Resolve only on a refresh that actually observed the new entry: the
      // watch service can fire once for the directory's own creation first.
      { onRefresh: (summary) => {
        if (summary.count > 0) resolveRefresh();
      } },
    );

    // FSEvents has a startup window in which changes made right after
    // watch() are missed, so keep mutating until the watcher reports one.
    // The assertion is "delivery happens", not "delivery is instantaneous".
    let attempt = 0;
    const mutate = setInterval(() => {
      attempt += 1;
      try {
        mkdirSync(join(dir, `live-${attempt}`));
      } catch {
        /* a racing directory is still a change */
      }
    }, 200);
    mutate.unref();

    const outcome = await Promise.race([
      refreshed.then(() => "refreshed" as const),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 8000).unref()),
    ]);
    clearInterval(mutate);

    assert.equal(
      outcome,
      "refreshed",
      "fs.watch delivered no change event within 8s of repeated directory creation",
    );
    assert.ok(registry.size("skill") >= 1, "the refresh populated the registry from disk");
  } finally {
    watcher?.stop();
  }
});
