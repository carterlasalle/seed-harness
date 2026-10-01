/**
 * seed-core model policy: per-model execution policy + unknown-model flow.
 *
 * Purpose: resolve the execution policy for a model (spec section 35) and
 * define what happens for a model the profiler has never measured (spec
 * section 86).
 * Why it exists: prompts stay model-agnostic; behavior varies only through
 * this policy, which must be safe by default for unmeasured models instead of
 * inheriting a champion's settings.
 * Responsibilities: look up a measured profile (schemas/model-profile.schema
 * .json shape), fall back to generic-safe defaults (temperature 0, conservative
 * output budget), and mark models ineligible for promotion decisions until
 * enough tasks have been evaluated.
 * Invariants: pure; generic-safe is the only fallback and always reports
 * source "generic-safe", zero measured cost/latency, and honest guidance;
 * promotionEligible requires MIN_PROFILED_TASKS evaluated tasks.
 * Public: resolveModelPolicy, ModelProfile, ModelPolicy,
 * GENERIC_SAFE_DEFAULTS, MIN_PROFILED_TASKS.
 */

// trace:exempt reason=internal-detail
export interface ModelProfile {
  model: string;
  strengths: string[];
  weaknesses: string[];
  costPerTask?: number;
  p50LatencyMs?: number;
  tasksEvaluated?: number;
}

// trace:exempt reason=internal-detail
export interface ModelPolicy {
  model: string;
  source: "profile" | "generic-safe";
  temperature: number;
  maxTokens: number;
  strengths: string[];
  weaknesses: string[];
  costPerTask: number;
  p50LatencyMs: number;
  tasksEvaluated: number;
  promotionEligible: boolean;
  guidance: string;
}

// trace:exempt reason=internal-detail
export const GENERIC_SAFE_DEFAULTS = { temperature: 0, maxTokens: 4096 } as const;
// trace:exempt reason=internal-detail
export const MIN_PROFILED_TASKS = 10;

// trace:v1 id=impl.sc-model-policy-resolve work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function resolveModelPolicy(model: string, profiles: readonly ModelProfile[]): ModelPolicy {
  const profile = profiles.find((candidate) => candidate.model === model);
  if (profile === undefined) {
    return {
      model,
      source: "generic-safe",
      temperature: GENERIC_SAFE_DEFAULTS.temperature,
      maxTokens: GENERIC_SAFE_DEFAULTS.maxTokens,
      strengths: [],
      weaknesses: [],
      costPerTask: 0,
      p50LatencyMs: 0,
      tasksEvaluated: 0,
      promotionEligible: false,
      guidance:
        `unprofiled model: using generic-safe defaults (temperature ${GENERIC_SAFE_DEFAULTS.temperature}, ` +
        `${GENERIC_SAFE_DEFAULTS.maxTokens} max tokens); collect task outcomes before routing or promotion ` +
        `decisions, and never promote from an unprofiled model (needs >= ${MIN_PROFILED_TASKS} evaluated tasks)`,
    };
  }
  // trace:exempt reason=internal-detail
  const tasksEvaluated = profile.tasksEvaluated ?? 0;
  // trace:exempt reason=internal-detail
  const profiled = tasksEvaluated >= MIN_PROFILED_TASKS;
  return {
    model,
    source: "profile",
    temperature: GENERIC_SAFE_DEFAULTS.temperature,
    maxTokens: GENERIC_SAFE_DEFAULTS.maxTokens,
    strengths: [...profile.strengths],
    weaknesses: [...profile.weaknesses],
    costPerTask: profile.costPerTask ?? 0,
    p50LatencyMs: profile.p50LatencyMs ?? 0,
    tasksEvaluated,
    promotionEligible: profiled,
    guidance: profiled
      ? `profile from ${tasksEvaluated} evaluated tasks`
      : `profile has only ${tasksEvaluated} evaluated tasks; needs >= ${MIN_PROFILED_TASKS} before promotion decisions`,
  };
}
