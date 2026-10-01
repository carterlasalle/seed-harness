/**
 * seed-core model policy: per-model execution policy + unknown-model flow.
 *
 * Purpose: resolve the execution policy for a model (spec section 35:
 * modelPattern/toolVisibilityLimit/editProtocol/contextCodec/
 * compactionPolicy/planningPolicy/parallelToolPolicy/skillPolicy/
 * maxToolResultChars/preferredThinkingLevel) and define what happens for a
 * model the profiler has never measured (spec section 86).
 * Why it exists: prompts stay model-agnostic; behavior varies only through
 * this policy, which must be safe by default for unmeasured models instead of
 * inheriting a champion's settings.
 * Responsibilities: look up a measured profile (schemas/model-profile.schema
 * .json shape), fall back to generic-safe defaults (toolVisibilityLimit 8,
 * conservative output budget), and mark models ineligible for promotion
 * decisions until enough tasks have been evaluated.
 * Invariants: pure; generic-safe is the only fallback and always reports
 * source "generic-safe" with honest guidance; promotionEligible requires
 * MIN_PROFILED_TASKS evaluated tasks.
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
  modelPattern: string;
  toolVisibilityLimit: number;
  editProtocol: string | null;
  contextCodec: string | null;
  compactionPolicy: string;
  planningPolicy: string;
  parallelToolPolicy: string;
  skillPolicy: string;
  maxToolResultChars: number;
  preferredThinkingLevel?: string;
  source: "profile" | "generic-safe";
  tasksEvaluated: number;
  promotionEligible: boolean;
  guidance: string;
}

// trace:exempt reason=internal-detail
export const GENERIC_SAFE_DEFAULTS = { toolVisibilityLimit: 8, editProtocol: null as string | null, contextCodec: null as string | null, compactionPolicy: "baseline", planningPolicy: "single-pass", parallelToolPolicy: "sequential", skillPolicy: "metadata-only", maxToolResultChars: 4000 } as const;
// trace:exempt reason=internal-detail
export const MIN_PROFILED_TASKS = 10;
// trace:v1 id=impl.sc-model-policy-resolve work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function resolveModelPolicy(model: string, profiles: readonly ModelProfile[]): ModelPolicy {
  const base = {
    modelPattern: model,
    toolVisibilityLimit: GENERIC_SAFE_DEFAULTS.toolVisibilityLimit,
    editProtocol: GENERIC_SAFE_DEFAULTS.editProtocol,
    contextCodec: GENERIC_SAFE_DEFAULTS.contextCodec,
    compactionPolicy: GENERIC_SAFE_DEFAULTS.compactionPolicy,
    planningPolicy: GENERIC_SAFE_DEFAULTS.planningPolicy,
    parallelToolPolicy: GENERIC_SAFE_DEFAULTS.parallelToolPolicy,
    skillPolicy: GENERIC_SAFE_DEFAULTS.skillPolicy,
    maxToolResultChars: GENERIC_SAFE_DEFAULTS.maxToolResultChars,
  };
  const profile = profiles.find((candidate) => candidate.model === model);
  if (profile === undefined) {
    return {
      ...base,
      source: "generic-safe",
      tasksEvaluated: 0,
      promotionEligible: false,
      guidance:
        `unprofiled model: using generic-safe defaults (toolVisibilityLimit ${GENERIC_SAFE_DEFAULTS.toolVisibilityLimit}, ` +
        `${GENERIC_SAFE_DEFAULTS.maxToolResultChars} max tool-result chars); collect task outcomes before routing or promotion ` +
        `decisions, and never promote from an unprofiled model (needs >= ${MIN_PROFILED_TASKS} evaluated tasks)`,
    };
  }
  const tasksEvaluated = profile.tasksEvaluated ?? 0;
  const profiled = tasksEvaluated >= MIN_PROFILED_TASKS;
  return {
    ...base,
    source: "profile",
    tasksEvaluated,
    promotionEligible: profiled,
    guidance: profiled
      ? `profile from ${tasksEvaluated} evaluated tasks`
      : `profile has only ${tasksEvaluated} evaluated tasks; needs >= ${MIN_PROFILED_TASKS} before promotion decisions`,
  };
}
