/**
 * friction.test.ts — one test per deterministic rule (section 45 thresholds).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { detectFriction, type FrictionObservation, type FrictionRule } from "./friction.ts";

function find(observations: readonly FrictionObservation[], rule: FrictionRule) {
  return detectFriction(observations).find((signal) => signal.rule === rule);
}

test("repeat: the same call three times", () => {
  const calls: FrictionObservation[] = [1, 2, 3].map((turn) => ({
    turn,
    kind: "tool",
    tool: "python",
    key: "ls -la",
    status: "ok",
  }));
  const signal = find(calls, "repeat");
  assert.ok(signal);
  assert.equal(signal.count, 3);
  assert.equal(signal.severity, 0.5);
  assert.equal(signal.turn, 1);
  assert.equal(detectFriction(calls.slice(0, 2)).length, 0, "two repeats are not friction");
});

test("error: the same call failing twice", () => {
  const failures: FrictionObservation[] = [1, 2].map((turn) => ({
    turn,
    kind: "tool",
    tool: "python",
    key: "import app",
    status: "error",
  }));
  const signal = find(failures, "error");
  assert.ok(signal);
  assert.equal(signal.count, 2);
  assert.equal(signal.severity, 0.5);
});

test("search: the same query three times", () => {
  const searches: FrictionObservation[] = [1, 2, 3].map((turn) => ({
    turn,
    kind: "search",
    key: "flaky fixture",
  }));
  const signal = find(searches, "search");
  assert.ok(signal);
  assert.equal(signal.count, 3);
});

test("compile-loop: the same compile error twice", () => {
  const compiles: FrictionObservation[] = [1, 2].map((turn) => ({
    turn,
    kind: "compile",
    status: "error",
    key: "TS2322: type mismatch",
  }));
  const signal = find(compiles, "compile-loop");
  assert.ok(signal);
  assert.equal(signal.count, 2);
  assert.equal(signal.severity, 0.5);
});

test("context-recovery: three consecutive context turns", () => {
  const context: FrictionObservation[] = [1, 2, 3].map((turn) => ({ turn, kind: "context" }));
  const signal = find(context, "context-recovery");
  assert.ok(signal);
  assert.equal(signal.count, 3);
  assert.equal(find(context.slice(0, 2), "context-recovery"), undefined);
});

test("ephemeral: three throwaway artifacts", () => {
  const artifacts: FrictionObservation[] = [1, 2, 3].map((turn) => ({
    turn,
    kind: "artifact",
    ephemeral: true,
  }));
  const signal = find(artifacts, "ephemeral");
  assert.ok(signal);
  assert.equal(signal.count, 3);
});

test("user-correction: a single correction is friction", () => {
  const correction: FrictionObservation[] = [{ turn: 4, kind: "user", correction: true }];
  const signal = find(correction, "user-correction");
  assert.ok(signal);
  assert.equal(signal.count, 1);
  assert.equal(signal.severity, 0.5);
});

test("context-waste: over 64KiB with under 25% consumed", () => {
  const waste: FrictionObservation[] = [
    { turn: 2, kind: "artifact", bytes: 65536, consumedBytes: 1000 },
    { turn: 3, kind: "artifact", bytes: 70000, consumedBytes: 1000 },
  ];
  const signal = find(waste, "context-waste");
  assert.ok(signal);
  assert.equal(signal.count, 1, "exactly-64KiB is not over the threshold");
});

test("latency-outlier: over 2x median and over 1s", () => {
  const calls: FrictionObservation[] = [
    { turn: 1, kind: "tool", tool: "a", latencyMs: 100 },
    { turn: 2, kind: "tool", tool: "b", latencyMs: 110 },
    { turn: 3, kind: "tool", tool: "c", latencyMs: 5000 },
  ];
  const signal = find(calls, "latency-outlier");
  assert.ok(signal);
  assert.equal(signal.count, 1);
  assert.equal(find([{ turn: 1, kind: "tool", latencyMs: 100 }, { turn: 2, kind: "tool", latencyMs: 1500 }], "latency-outlier"), undefined, "1.5s is not >2x median");
});
