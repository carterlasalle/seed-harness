/**
 * model-policy.test.ts — measured profile lookup + unknown-model flow.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { GENERIC_SAFE_DEFAULTS, MIN_PROFILED_TASKS, resolveModelPolicy } from "./model-policy.ts";

const profiles = [
  {
    id: "measured/model",
    provider: "test",
    modelId: "measured/model",
    family: "test",
    observedAt: "2026-10-01T00:00:00.000Z",
    capabilities: { toolCalling: 0.9, editing: 0.9, longContext: 0.5, vision: 0, parallelTools: 0.5, instructionFollowing: 0.9 },
    preferredPolicyId: "default",
    profileStatus: "validated" as const,
    model: "measured/model",
    strengths: ["edits"],
    weaknesses: ["long contexts"],
    costPerTask: 0.4,
    p50LatencyMs: 1200,
    tasksEvaluated: 12,
  },
  {
    id: "fresh/model",
    provider: "test",
    modelId: "fresh/model",
    family: "test",
    observedAt: "2026-10-01T00:00:00.000Z",
    capabilities: { toolCalling: 0.5, editing: 0.5, longContext: 0.5, vision: 0, parallelTools: 0.5, instructionFollowing: 0.5 },
    preferredPolicyId: "default",
    profileStatus: "provisional" as const,
    model: "fresh/model",
    strengths: [],
    weaknesses: [],
    tasksEvaluated: 3,
  },
];

test("unknown models get the generic-safe policy and are not promotion-eligible", () => {
  const policy = resolveModelPolicy("mystery/model", profiles);
  assert.equal(policy.source, "generic-safe");
  assert.equal(policy.modelPattern, "mystery/model");
  assert.equal(policy.toolVisibilityLimit, GENERIC_SAFE_DEFAULTS.toolVisibilityLimit);
  assert.equal(policy.maxToolResultChars, GENERIC_SAFE_DEFAULTS.maxToolResultChars);
  assert.equal(policy.promotionEligible, false);
  assert.ok(policy.guidance.includes("unprofiled"));
});

test("measured profiles become promotion-eligible at the task threshold", () => {
  const policy = resolveModelPolicy("measured/model", profiles);
  assert.equal(policy.source, "profile");
  assert.equal(policy.modelPattern, "measured/model");
  assert.equal(policy.tasksEvaluated, 12);
  assert.equal(policy.promotionEligible, true);
});

test("under-profiled models stay ineligible until MIN_PROFILED_TASKS", () => {
  const policy = resolveModelPolicy("fresh/model", profiles);
  assert.equal(policy.source, "profile");
  assert.equal(policy.promotionEligible, false);
  assert.ok(policy.guidance.includes(String(MIN_PROFILED_TASKS)));
});
