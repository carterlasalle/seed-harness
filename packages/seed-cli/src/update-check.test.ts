// update-check.test.ts — the update reminder actually fires.
//
// Purpose: pin the behaviour that was silently absent. Why it exists: the
// function declared `string | undefined`, ended on a `const` helper and never
// returned, so it always produced undefined and the reminder could never
// print — no matter how stale the install. TypeScript permits that, so only a
// test catches it.
// Invariants under test: a newer cached release produces a notice naming both
// versions; an up-to-date install stays quiet; SEED_NO_UPDATE_CHECK=1 disables
// the check; a missing cache is quiet.
//
// No network: every case seeds the cache with a fresh `checkedAt`, which keeps
// the detached refresh from firing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCachedUpdate } from "./update-check.ts";

/** Point the checker at a private cache seeded with `latest`, and return cleanup. */
function withCache(latest: string): () => void {
  const dir = mkdtempSync(join(tmpdir(), "seed-update-"));
  const file = join(dir, "update.json");
  writeFileSync(file, JSON.stringify({ latest, checkedAt: Date.now() }));
  process.env.SEED_UPDATE_CACHE = file;
  delete process.env.SEED_NO_UPDATE_CHECK;
  return () => {
    delete process.env.SEED_UPDATE_CACHE;
  };
}

test("a newer cached release reports a notice naming both versions", () => {
  const done = withCache("v9.9.9");
  try {
    const notice = checkCachedUpdate("0.2.0");
    assert.equal(notice, "0.2.0 -> 9.9.9", "the reminder names installed and latest");
  } finally {
    done();
  }
});

test("an up-to-date install stays quiet", () => {
  const done = withCache("v0.2.0");
  try {
    assert.equal(checkCachedUpdate("0.2.0"), undefined);
  } finally {
    done();
  }
});

test("SEED_NO_UPDATE_CHECK=1 disables the reminder", () => {
  const done = withCache("v9.9.9");
  try {
    process.env.SEED_NO_UPDATE_CHECK = "1";
    assert.equal(checkCachedUpdate("0.2.0"), undefined);
  } finally {
    delete process.env.SEED_NO_UPDATE_CHECK;
    done();
  }
});

test("notifying writes a throttle stamp so the next run is quiet", () => {
  const dir = mkdtempSync(join(tmpdir(), "seed-update-"));
  const file = join(dir, "update.json");
  writeFileSync(file, JSON.stringify({ latest: "v9.9.9", checkedAt: Date.now() }));
  process.env.SEED_UPDATE_CACHE = file;
  try {
    assert.ok(checkCachedUpdate("0.2.0"), "first call notifies");
    assert.equal(checkCachedUpdate("0.2.0"), undefined, "and is throttled for 24h");
    const cache = JSON.parse(readFileSync(file, "utf8")) as { lastNotifiedVersion?: string };
    assert.equal(cache.lastNotifiedVersion, "v9.9.9", "the stamp records what was announced");
  } finally {
    delete process.env.SEED_UPDATE_CACHE;
  }
});