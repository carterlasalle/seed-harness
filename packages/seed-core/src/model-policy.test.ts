/**
 * model-policy.test.ts — measured profile lookup + unknown-model flow.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { GENERIC_SAFE_DEFAULTS, MIN_PROFILED_TASKS, resolveModelPolicy } from "./model-policy.ts";

const profiles = [
  {
    model: "measured/model",
    strengths: ["edits"],
    weaknesses: ["long contexts"],
    costPerTask: 0.4,
    p50LatencyMs: 1200,
    tasksEvaluated: 12,
  },
  {
    model: "fresh/model",
    strengths: [],
    weaknesses: [],
    tasksEvaluated: 3,
  },
];

test("unknown models get the generic-safe policy and are not promotion-eligible", () => {
  const policy = resolveModelPolicy("mystery/model", profiles);
  assert.equal(policy.source, "generic-safe");
  assert.equal(policy.temperature, GENERIC_SAFE_DEFAULTS.temperature);
  assert.equal(policy.maxTokens, GENERIC_SAFE_DEFAULTS.maxTokens);
  assert.equal(policy.promotionEligible, false);
  assert.deepEqual(policy.strengths, []);
  assert.ok(policy.guidance.includes("unprofiled"));
});

test("measured profiles are adopted with their stats and become promotion-eligible", () => {
  const policy = resolveModelPolicy("measured/model", profiles);
  assert.equal(policy.source, "profile");
  assert.equal(policy.costPerTask, 0.4);
  assert.equal(policy.p50LatencyMs, 1200);
  assert.equal(policy.tasksEvaluated, 12);
  assert.equal(policy.promotionEligible, true);
  assert.deepEqual(policy.strengths, ["edits"]);
});

test("under-profiled models stay ineligible until MIN_PROFILED_TASKS", () => {
  const policy = resolveModelPolicy("fresh/model", profiles);
  assert.equal(policy.source, "profile");
  assert.equal(policy.promotionEligible, false);
  assert.ok(policy.guidance.includes(String(MIN_PROFILED_TASKS)));
});
