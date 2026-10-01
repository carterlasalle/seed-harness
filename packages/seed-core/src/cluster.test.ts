/**
 * cluster.test.ts — deterministic grouping and the actionability rule.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { clusterFriction } from "./cluster.ts";
import type { FrictionSignal } from "./friction.ts";

function signal(overrides: Partial<FrictionSignal> = {}): FrictionSignal {
  return {
    rule: "repeat",
    severity: 0.5,
    count: 2,
    turn: 1,
    detail: "same call repeated",
    tool: "python",
    task: "task-1",
    subsystem: "runner",
    session: "s1",
    ...overrides,
  };
}

test("signals sharing three or more categorical features group together", () => {
  const clusters = clusterFriction([
    signal({ turn: 1, task: "t1" }),
    signal({ turn: 2, task: "t2" }),
    signal({ rule: "error", turn: 3, task: "t3" }),
    signal({ turn: 4, task: "other", tool: "node", subsystem: "web", session: "s2" }),
  ]);
  assert.equal(clusters.length, 2);
  const main = clusters.find((cluster) => cluster.signals.length === 3);
  assert.ok(main, "three related signals must share a cluster");
  assert.equal(main.taskCount, 3);
  assert.equal(main.features.tool, "python");
  assert.equal(main.features.rule, undefined, "disagreeing features are not recorded");
});

test("actionable: at least 3 distinct tasks", () => {
  const clusters = clusterFriction([
    signal({ task: "t1" }),
    signal({ task: "t2" }),
    signal({ task: "t3" }),
  ]);
  assert.equal(clusters[0]?.taskCount, 3);
  assert.equal(clusters[0]?.actionable, true);
});

test("actionable: at least 5 occurrences", () => {
  const clusters = clusterFriction([signal({ count: 5, task: "t1" })]);
  assert.equal(clusters[0]?.occurrences, 5);
  assert.equal(clusters[0]?.actionable, true);
});

test("actionable: severity at or above 0.90", () => {
  const clusters = clusterFriction([signal({ severity: 0.9, count: 1, task: "t1" })]);
  assert.equal(clusters[0]?.severity, 0.9);
  assert.equal(clusters[0]?.actionable, true);
});

test("a weak single signal is not actionable", () => {
  const clusters = clusterFriction([signal({ severity: 0.25, count: 1, task: "t1" })]);
  assert.equal(clusters[0]?.actionable, false);
  assert.equal(clusters[0]?.taskCount, 1);
  assert.equal(clusters[0]?.occurrences, 1);
});
