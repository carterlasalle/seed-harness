// Seed lab tests: budgets, crystallization triggers, operators, probes, triggers.
//
// Purpose: pin the counted rules the evolution loop depends on — governor lane
// budgets, crystallizer A-D triggers, deterministic challenge operators,
// profiler probe shape/status, and scientist/challenge cadences.
// Why it exists: these are pure counted rules; a regression here silently
// burns budget or promotes on vibes. Tests co-located, node:test compatible.
// Invariants: no I/O, no clocks, fully deterministic.
// Public functions/types: none — test-only module.

import test from "node:test";
import assert from "node:assert/strict";
import {
  admitChallenge,
  applyOperator,
  buildCrystallizationProposal,
  challengesDue,
  cheapDue,
  findCrystallizationCandidates,
  freshBudgets,
  incubatorVerdict,
  inlineVerdict,
  MUTATION_OPERATORS,
  normalDue,
  policyForModel,
  postTaskVerdict,
  profileFromProbes,
  PROBE_NAMES,
  scientistDue,
  stripConstants,
  runEvolutionCycle,
} from "./index.ts";
import type { GuardianClient } from "@carterlasalle/seed-runtime/dist/guardian-client.js";
import type { BehaviorTrace } from "./index.ts";

function trace(taskId: string, pattern: string, over: Partial<BehaviorTrace> = {}): BehaviorTrace {
  return {
    taskId,
    pattern,
    invocations: 1,
    successes: 1,
    sequencesEliminated: 0,
    utility: 0.1,
    ...over,
  };
}

test("inline lane: blocked or 4x savings, 30s budget, queue overflow", () => {
  const base = freshBudgets();
  assert.equal(inlineVerdict(base, { blocked: true, expectedSavings: 0, expectedCost: 100 }).allow, true);
  assert.equal(inlineVerdict(base, { blocked: false, expectedSavings: 400, expectedCost: 100 }).allow, true);
  assert.equal(inlineVerdict(base, { blocked: false, expectedSavings: 399, expectedCost: 100 }).allow, false);
  assert.equal(
    inlineVerdict({ ...base, inlineCpuMsUsed: 30_000 }, { blocked: true, expectedSavings: 0, expectedCost: 0 }).reason,
    "inline-cpu-budget-exhausted",
  );
  assert.equal(
    inlineVerdict({ ...base, inlineQueueDepth: 8, maxInlineQueue: 8 }, { blocked: true, expectedSavings: 0, expectedCost: 0 }).reason,
    "queue-overflow",
  );
});

test("post-task lane: one reflection call within 5s CPU", () => {
  assert.equal(postTaskVerdict(freshBudgets()).allow, true);
  assert.equal(postTaskVerdict({ ...freshBudgets(), postTaskCallsMade: 1 }).allow, false);
  assert.equal(postTaskVerdict({ ...freshBudgets(), postTaskCpuMs: 5_001 }).allow, false);
});

test("incubator lane: idle-only, spend/token/cpu caps", () => {
  assert.equal(incubatorVerdict(freshBudgets()).allow, true);
  assert.equal(incubatorVerdict({ ...freshBudgets(), idle: false }).reason, "foreground-requires-evolve-run");
  const fg = { ...freshBudgets(), idle: false, explicitEvolveRun: true, foregroundCpuShare: 0.25 };
  assert.equal(incubatorVerdict(fg).allow, true);
  assert.equal(incubatorVerdict({ ...fg, foregroundCpuShare: 0.26 }).allow, false);
  assert.equal(incubatorVerdict({ ...freshBudgets(), daySpendUsd: 10 }).allow, false);
  assert.equal(
    incubatorVerdict({ ...freshBudgets(), incubatorSpendUsd: 2, totalSpendUsd: 10 }).reason,
    "spend-over-10pct",
  );
  assert.equal(
    incubatorVerdict({ ...freshBudgets(), incubatorTokens: 200, totalTokens: 1000 }).reason,
    "tokens-over-10pct",
  );
});

test("trigger cadences: cheap every task, normal 10/5, scientist 50, challenges 20", () => {
  assert.equal(cheapDue(0), false);
  assert.equal(cheapDue(1), true);
  assert.equal(normalDue(10, 0), true);
  assert.equal(normalDue(0, 5), true);
  assert.equal(normalDue(9, 4), false);
  assert.equal(scientistDue(49, []), false);
  assert.equal(scientistDue(50, []), true);
  assert.equal(scientistDue(0, ["router"]), true);
  assert.equal(scientistDue(0, ["context", "editing", "router", "loop", "arch"]), true);
  assert.equal(challengesDue(19, []), false);
  assert.equal(challengesDue(20, []), true);
  assert.equal(challengesDue(0, ["arch"]), true);
});

test("crystallizer triggers A-D", () => {
  const a = findCrystallizationCandidates([trace("t1", "retry-loop", { invocations: 5 })]);
  assert.ok(a.some((c) => c.trigger === "A" && c.taskIds[0] === "t1"));
  const noA = findCrystallizationCandidates([trace("t1", "retry-loop", { invocations: 4 })]);
  assert.equal(noA.length, 0);
  const b = findCrystallizationCandidates([
    trace("t1", "wrap-json", { successes: 2 }),
    trace("t2", "wrap-json", { successes: 1 }),
    trace("t3", "wrap-json", { successes: 3 }),
  ]);
  const bHit = b.find((c) => c.trigger === "B");
  assert.ok(bHit && bHit.taskIds.length === 3);
  const noB = findCrystallizationCandidates([trace("t1", "wrap-json"), trace("t2", "wrap-json")]);
  assert.ok(!noB.some((c) => c.trigger === "B"));
  const c = findCrystallizationCandidates([
    trace("t1", "dedup", { sequencesEliminated: 2 }),
    trace("t2", "dedup", { sequencesEliminated: 1 }),
  ]);
  assert.ok(c.some((x) => x.trigger === "C"));
  const d = findCrystallizationCandidates([
    trace("t1", "fast-path", { utility: 0.85 }),
    trace("t2", "fast-path", { utility: 0.6 }),
  ]);
  assert.ok(d.some((x) => x.trigger === "D"));
  const noD = findCrystallizationCandidates([
    trace("t1", "fast-path", { utility: 0.79 }),
    trace("t2", "fast-path", { utility: 0.7 }),
  ]);
  assert.ok(!noD.some((x) => x.trigger === "D"));
});

test("crystallizer proposal carries schema, validation, tests, failure modes, scope", () => {
  const [cand] = findCrystallizationCandidates([trace("t1", "Retry Loop!", { invocations: 6 })]);
  assert.ok(cand);
  const proposal = buildCrystallizationProposal(cand, ['fetch("https://x", 3)']);
  assert.equal(proposal.name, "retry-loop");
  assert.ok(proposal.inputSchema.params.length > 0);
  assert.ok(proposal.validation.length > 0 && proposal.tests.length > 0);
  assert.ok(proposal.failureModes.length > 0);
  assert.ok(proposal.reuseScope.length > 0);
  assert.ok(proposal.promptText.includes("trigger A"));
  assert.throws(() => buildCrystallizationProposal(cand, []));
  const stripped = stripConstants('fetch("https://x", 3)');
  assert.ok(stripped.template.includes("{{p1}}") && stripped.params.length === 2);
});

test("challenge operators: 10 deterministic mutations plus triple-check admission", () => {
  assert.equal(MUTATION_OPERATORS.length, 10);
  assert.equal(new Set(MUTATION_OPERATORS.map((o) => o.id)).size, 10);
  const src = 'if (a < b) { return true + 1; } for (let i = 0; i < arr.length; i++) { if (x === y) { return !flag; } }';
  for (const op of MUTATION_OPERATORS) {
    const first = applyOperator(src, op.id, 7);
    assert.equal(first, applyOperator(src, op.id, 7));
    assert.ok(first !== src, op.id);
  }
  assert.throws(() => applyOperator(src, "nope", 1));
  assert.deepEqual(admitChallenge({ baselinePass: true, mutationPass: false, repairPass: true }), {
    decision: "admit",
    reason: "baseline-pass-mutation-fail-repair-pass",
  });
  assert.equal(admitChallenge({ baselinePass: false, mutationPass: false, repairPass: true }).decision, "discard");
  assert.equal(admitChallenge({ baselinePass: true, mutationPass: true, repairPass: true }).decision, "discard");
  assert.equal(admitChallenge({ baselinePass: true, mutationPass: false, repairPass: false }).decision, "discard");
});

test("profiler: 12 probes, provisional vs validated, scaffolding policy", () => {
  assert.equal(PROBE_NAMES.length, 12);
  assert.equal(new Set(PROBE_NAMES).size, 12);
  assert.throws(() => profileFromProbes("m", []));
  assert.throws(() => profileFromProbes("m", [{ probe: "nope", model: "m", success: true, latencyMs: 1, tokens: 1, costUsd: 0.01 }]));
  const few = PROBE_NAMES.slice(0, 3).map((probe) => ({ probe, model: "m", success: true, latencyMs: 100, tokens: 10, costUsd: 0.01 }));
  const provisional = profileFromProbes("m", few);
  assert.equal(provisional.status, "provisional");
  assert.equal(provisional.profileStatus, "provisional");
  assert.equal(provisional.modelId, "m");
  assert.deepEqual(provisional.strengths, PROBE_NAMES.slice(0, 3));
  const many = PROBE_NAMES.map((probe) => ({ probe, model: "m", success: true, latencyMs: 100, tokens: 10, costUsd: 0.01 }));
  const validated = profileFromProbes("m", many);
  assert.equal(validated.status, "validated");
  assert.ok(Math.abs(validated.costPerTask - 0.01) < 1e-9);
  assert.equal(validated.p50LatencyMs, 100);
  assert.equal(policyForModel(provisional).scaffolding, "keep");
  assert.equal(policyForModel({ ...validated, costPerTask: 0.9 }).scaffolding, "drop");
  assert.equal(policyForModel({ ...validated, costPerTask: 0.1 }).scaffolding, "keep");
});

test("evolution without executors records a skip, never synthetic success", async () => {
  const client = { call: async () => undefined } as unknown as GuardianClient;
  const cycle = await runEvolutionCycle({
    client,
    taskId: "task-1",
    observations: [{ turn: 1, kind: "tool", tool: "python", status: "ok" }],
    tasksSinceCycle: 10,
    clustersSinceCycle: 0,
  });
  assert.equal(cycle.mutation, null);
  assert.equal(cycle.candidateRef, null);
  assert.equal(cycle.challengesAdmitted, 0);
  assert.ok(cycle.stages.includes("mutation:skipped:no-executor"), `stages: ${cycle.stages.join(" ")}`);
  assert.ok(!cycle.stages.some((s) => /^mutation:(low|medium|high):4\/4$/.test(s)), `no synthetic 4/4: ${cycle.stages.join(" ")}`);
});
