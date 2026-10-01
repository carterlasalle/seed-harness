// seed-cli tests: isolate state via SEED_STATE_DIR and prove CLI behavior.
//
// Purpose: co-located node:test suite for REQ-SEED-EZPD6B85 — help lists all
// commands, capabilities/echo roundtrip works, run records, evolve drains,
// champion rollback preserves history, doctor returns the required shape.
// Why it exists: acceptance requires `node --test packages/seed-cli`
// passes, and every behavior below is consumer-visible CLI surface.
// Invariants: every test sets SEED_STATE_DIR to a fresh temp dir and
// SEED_ROOT to the enclosing checkout (derived from import.meta.url, never
// a hardcoded user path); never touches the real user state or network.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { main, COMMANDS } from "./cli.ts";
import { callEcho, discoverCapabilities } from "./capabilities.ts";
import { runTask } from "./run.ts";
import { evolveRun, evolveStatus, queueExperiment } from "./evolve.ts";
import { compareEvals, smokeEval } from "./eval.ts";
import { rollbackChampion, showChampion } from "./champion.ts";
import { runDoctor } from "./doctor.ts";
import { loadQueue, recentRuns } from "./state.ts";
import type { EvalResultSummary } from "./state.ts";

// trace:exempt reason=unit-test
function isolate(): string {
  const dir = mkdtempSync(join(tmpdir(), "seed-cli-test-"));
  process.env.SEED_STATE_DIR = join(dir, "state");
  process.env.SEED_ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
  return dir;
}

test("help lists all commands", async () => {
  isolate();
  const lines = [...COMMANDS];
  for (const expected of [
    "run <prompt>",
    "status",
    "doctor",
    "capabilities list",
    "capabilities show <name>",
    "evolve status",
    "evolve queue <task>",
    "evolve run [--limit N]",
    "eval run [--limit N]",
    "eval compare <baseline-id> <challenger-id>",
    "eval smoke",
    "model list",
    "model profile <name>",
    "champion show",
    "champion history",
    "champion rollback <ref> [--reason TEXT]",
    "research refresh",
    "schema validate",
    "help",
  ]) {
    assert.ok(lines.includes(expected as (typeof COMMANDS)[number]), `missing command: ${expected}`);
  }
  assert.equal(await main(["help"]), 0);
});

test("capabilities list includes echo fixture and echo roundtrip works", () => {
  isolate();
  const root = process.env.SEED_ROOT as string;
  const names = discoverCapabilities(root).map((c) => c.name);
  assert.ok(names.includes("fixtures/echo"));
  assert.ok(names.includes("builtin/python"));
  assert.deepEqual(callEcho({ hello: "world" }, root), { hello: "world" });
});

test("run pins champion and records the run", async () => {
  isolate();
  const record = await runTask("echo hello", { session: "test-session" });
  assert.equal(record.ok, true);
  assert.equal(record.session, "test-session");
  assert.ok(record.detail.includes("champion="));
  assert.ok(record.detail.includes("noguardian") || record.detail.includes("python-"));
  assert.equal(recentRuns(5).length, 1);
});

test("run caps capabilities at 8", async () => {
  isolate();
  const record = await runTask("echo hello world test prompt capabilities", {
    capabilities: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"],
    session: "cap-session",
  });
  assert.ok(record.capabilities.length <= 8);
});

test("evolve queue/status/run drains through runTask", async () => {
  isolate();
  queueExperiment("first task");
  queueExperiment("second task");
  assert.equal(loadQueue().length, 2);
  assert.equal(evolveStatus().queued, 2);
  const result = await evolveRun(1);
  assert.deepEqual(result, { ran: 1, ok: 1 });
  assert.equal(loadQueue().length, 1);
  assert.equal(evolveStatus().recent, 1);
});

test("champion rollback preserves history", () => {
  isolate();
  const before = showChampion().ref;
  const moved = rollbackChampion("challenger@v2", "test rollback");
  assert.equal(moved.ref, "challenger@v2");
  assert.equal(moved.history[moved.history.length - 1].ref, before);
  const back = rollbackChampion(before, "restore");
  assert.equal(back.ref, before);
  assert.ok(back.history.length >= 3);
});

test("doctor returns the required check shape", async () => {
  isolate();
  const report = await runDoctor(process.env.SEED_ROOT as string);
  const names = report.checks.map((c) => c.name);
  for (const expected of [
    "node",
    "yarn",
    "uv",
    "python",
    "rust",
    "docker-cli",
    "docker-socket",
    "sqlite",
    "champion",
    "schemas",
    "capability-manifests",
    "credentials",
  ]) {
    assert.ok(names.includes(expected), `missing doctor check: ${expected}`);
  }
  assert.equal(typeof report.ok, "boolean");
  for (const check of report.checks) {
    assert.equal(typeof check.ok, "boolean");
    assert.equal(typeof check.detail, "string");
  }
});

test("eval compare enforces non-inferiority", () => {
  const base: EvalResultSummary = {
    id: "base",
    at: new Date().toISOString(),
    suite: "core",
    total: 4,
    passed: 3,
    failed: 1,
    failures: ["task-a: oracle failed (exit 1)"],
  };
  const better: EvalResultSummary = {
    id: "better",
    at: new Date().toISOString(),
    suite: "core",
    total: 4,
    passed: 4,
    failed: 0,
    failures: [],
  };
  const worse: EvalResultSummary = {
    id: "worse",
    at: new Date().toISOString(),
    suite: "core",
    total: 4,
    passed: 3,
    failed: 1,
    failures: ["task-b: oracle failed (exit 1)"],
  };
  assert.equal(compareEvals(base, better).nonInferior, true);
  assert.equal(compareEvals(base, worse).nonInferior, false);
  assert.equal(compareEvals(base, { ...base, id: "same" }).nonInferior, true);
});

test("eval smoke proves fail-then-pass on scratch copies", () => {
  isolate();
  const summary = smokeEval(process.env.SEED_ROOT as string);
  assert.equal(summary.suite, "smoke");
  assert.equal(summary.total, 2);
  assert.equal(summary.failed, 0);
  assert.equal(summary.passed, 2);
  assert.deepEqual(summary.failures, []);
});

test("schema validate passes on shipped schemas and manifests", async () => {
  isolate();
  assert.equal(await main(["schema", "validate"]), 0);
});
