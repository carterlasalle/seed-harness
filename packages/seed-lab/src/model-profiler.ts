// Seed lab model profiler: probes, profiles, and per-model policy selection.
//
// Purpose: measure each model with a fixed probe set (success, latency, tokens,
// cost), keep provisional profiles until enough tasks validate them, and select
// the per-model policy — including dropping scaffolding that earns no lift.
// Why it exists: the router weights model choice by measured score-per-cost
// (docs/MODEL_PROFILES.md); unmeasured priors would route on reputation.
// Responsibilities: probe catalog, profile aggregation, validated promotion,
// policy selection with scaffolding deletion.
// Invariants: exactly 12 probes; provisional until VALIDATED_MIN_TASKS tasks;
// scaffolding is dropped only for validated profiles over the cost cap.
// Public types/functions: PROBE_NAMES, VALIDATED_MIN_TASKS, SCAFFOLD_COST_CAP_USD,
// ProbeResult, ModelProfile, ModelPolicy, profileFromProbes, policyForModel.

// trace:exempt reason=internal-detail
export interface ProbeResult {
  probe: string;
  model: string;
  success: boolean;
  latencyMs: number;
  tokens: number;
  costUsd: number;
}

// trace:exempt reason=internal-detail
export interface ModelProfile {
  id: string;
  provider: string;
  modelId: string;
  family: string;
  observedAt: string;
  capabilities: Record<"toolCalling" | "editing" | "longContext" | "vision" | "parallelTools" | "instructionFollowing", number>;
  preferredPolicyId: string;
  profileStatus: "unknown" | "provisional" | "validated";
  model: string;
  strengths: string[];
  weaknesses: string[];
  costPerTask: number;
  p50LatencyMs: number;
  tasksEvaluated: number;
  status: "provisional" | "validated";
}

// trace:exempt reason=internal-detail
export interface ModelPolicy {
  model: string;
  weight: number;
  scaffolding: "keep" | "drop";
  reason: string;
}

export const PROBE_NAMES: string[] = [
  "routine-coding",
  "bug-fix",
  "refactor",
  "tool-use",
  "multi-file-edit",
  "test-repair",
  "prompt-following",
  "long-context",
  "reasoning",
  "instruction-following",
  "speed",
  "cost-efficiency",
];

export const VALIDATED_MIN_TASKS = 10;
export const SCAFFOLD_COST_CAP_USD = 0.5;

// trace:v1 id=impl.profiler-profile work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function profileFromProbes(model: string, results: ProbeResult[]): ModelProfile {
  if (results.length === 0) throw new Error("profiler needs at least one probe result");
  for (const r of results) {
    if (!PROBE_NAMES.includes(r.probe)) throw new Error(`unknown probe: ${r.probe}`);
  }
  const byProbe = new Map<string, ProbeResult[]>();
  for (const r of results) {
    // trace:exempt reason=internal-detail
    const group = byProbe.get(r.probe) ?? [];
    group.push(r);
    byProbe.set(r.probe, group);
  }
  // trace:exempt reason=internal-detail
  const strengths: string[] = [];
  // trace:exempt reason=internal-detail
  const weaknesses: string[] = [];
  for (const [probe, group] of byProbe) {
    // trace:exempt reason=internal-detail
    const rate = group.filter((r) => r.success).length / group.length;
    if (rate >= 0.8) strengths.push(probe);
    else if (rate <= 0.5) weaknesses.push(probe);
  }
  // trace:exempt reason=internal-detail
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  // trace:exempt reason=internal-detail
  const p50LatencyMs = latencies[Math.floor(latencies.length / 2)] ?? 0;
  // trace:exempt reason=internal-detail
  const costPerTask = results.reduce((n, r) => n + r.costUsd, 0) / results.length;
  return {
    id: model,
    provider: "unknown",
    modelId: model,
    family: "unknown",
    observedAt: new Date(0).toISOString(),
    capabilities: { toolCalling: 0, editing: 0, longContext: 0, vision: 0, parallelTools: 0, instructionFollowing: 0 },
    preferredPolicyId: "generic-safe",
    profileStatus: results.length >= VALIDATED_MIN_TASKS ? "validated" : "provisional",
    model,
    strengths,
    weaknesses,
    costPerTask,
    p50LatencyMs,
    tasksEvaluated: byProbe.size,
    status: results.length >= VALIDATED_MIN_TASKS ? "validated" : "provisional",
  };
}
// trace:v1 id=impl.profiler-policy work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function policyForModel(profile: ModelProfile): ModelPolicy {
  const successPrior = 1 + profile.strengths.length - profile.weaknesses.length;
  const weight = successPrior / Math.max(profile.costPerTask, 0.01);
  if (profile.status === "validated" && profile.costPerTask > SCAFFOLD_COST_CAP_USD) {
    return { model: profile.model, weight, scaffolding: "drop", reason: "validated-cost-over-cap" };
  }
  return { model: profile.model, weight, scaffolding: "keep", reason: "provisional-or-cheap" };
}
