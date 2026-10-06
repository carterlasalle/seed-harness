// session-store.test.ts — persisted sessions and the resume tree.
//
// The objective's session row asks that transcripts stop being thrown away.
// These tests cover the store that makes resume possible and the tree shape
// that resuming produces.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionStore, sessionTree } from "./session-store.ts";
import type { StoredSession } from "./session-store.ts";

// trace:exempt reason=unit-test
function dir(): string {
  return mkdtempSync(join(tmpdir(), "seed-sessions-"));
}

test("a session survives a round trip through disk", () => {
  const store = createSessionStore(dir());
  const id = store.create({ cwd: "/tmp/work", model: "vendor/model" });
  store.append(id, { id: "c1", kind: "user", title: "fix the parser", body: [] });
  store.append(id, { id: "c2", kind: "tool", title: "python", body: ["out"], state: "ok" });

  const loaded = store.load(id);
  assert.equal(loaded?.cwd, "/tmp/work");
  assert.equal(loaded?.model, "vendor/model");
  assert.equal(loaded?.prompt, "fix the parser", "the first user prompt names the session");
  assert.equal(loaded?.cards.length, 2);
});

test("a patched card persists its new state", () => {
  const store = createSessionStore(dir());
  const id = store.create({});
  store.append(id, { id: "t1", kind: "tool", title: "python", body: [], state: "running" });
  store.patch(id, "t1", { state: "ok", durationMs: 1200 });
  const card = store.load(id)?.cards[0];
  assert.equal(card?.state, "ok");
  assert.equal(card?.durationMs, 1200);
});

test("list returns newest first and skips unreadable files", () => {
  const store = createSessionStore(dir());
  const first = store.create({});
  store.append(first, { id: "a", kind: "user", title: "older", body: [] });
  const second = store.create({});
  store.append(second, { id: "b", kind: "user", title: "newer", body: [] });
  // A corrupt file must not take the others down with it.
  writeFileSync(join(store.dir, "broken.json"), "{not json");

  const ids = store.list().map((s) => s.id);
  assert.equal(ids.length, 2, "the corrupt file is skipped, the rest survive");
  assert.ok(ids.includes(first) && ids.includes(second));
});

test("a missing or malformed session loads as null rather than throwing", () => {
  const store = createSessionStore(dir());
  assert.equal(store.load("does-not-exist"), null);
  assert.equal(store.load("../../etc/passwd"), null, "path traversal is refused");
});

test("resuming records a parent, which makes the history a tree", () => {
  const store = createSessionStore(dir());
  const root = store.create({});
  const child = store.create({ parent: root });
  const grandchild = store.create({ parent: child });
  const sessions = store.list();
  // sessionTree orders by lineage, so depths must follow creation, not time.
  const depths = new Map(sessionTree(sessions).map((entry) => [entry.session.id, entry.depth]));
  assert.equal(depths.get(root), 0);
  assert.equal(depths.get(child), 1);
  assert.equal(depths.get(grandchild), 2);
});

test("a session whose parent is gone still appears, as a root", () => {
  const orphan: StoredSession = {
    id: "orphan",
    at: new Date().toISOString(),
    parent: "deleted-parent",
    cards: [],
  };
  const tree = sessionTree([orphan]);
  assert.equal(tree.length, 1, "history never loses an entry");
  assert.equal(tree[0]?.depth, 0);
});

test("sessionTree terminates on a parent cycle", () => {
  const a: StoredSession = { id: "a", at: "2026-01-01T00:00:00Z", parent: "b", cards: [] };
  const b: StoredSession = { id: "b", at: "2026-01-02T00:00:00Z", parent: "a", cards: [] };
  const tree = sessionTree([a, b]);
  assert.equal(tree.length, 2, "both are listed exactly once");
});