/**
 * seed-core capability lifecycle: stages, rent, deprecation, consolidation.
 *
 * Purpose: track a capability's life from EPHEMERAL to MATURE, decide stage
 * exits from measured rent, flag deprecation, and detect consolidation pairs.
 * Why it exists: capabilities must earn their place in the prompt; unused,
 * dominated or unreliable ones cost context forever, so demotion/promotion is
 * a counted rule over rent data, not a judgment call.
 * Responsibilities: stage exit criteria (3 distinct successful tasks for
 * probation, 10 uses <= 20% errors for established, 50 uses <= 10% errors for
 * mature), rent accumulation, deprecation reasons (unused for >= 100 idle
 * turns, Pareto-dominated, or > 20% errors over >= 20 uses), consolidation
 * (>= 80% tag overlap AND >= 70% use overlap), and the Pareto dominance
 * predicate over score/cost used by promotion and archive eviction.
 * Invariants: pure; dominance is non-strict on every axis with strict gain on
 * at least one (ties never dominate); overlap measures are containment of the
 * smaller set and 0 when either side is empty; deprecation reason priority is
 * unused, dominated, error-rate.
 * Public: dominates, trackRent, errorRate, advanceStage, deprecationReason,
 * consolidationOutcome, emptyRent, LIFECYCLE_STAGES, thresholds.
 */

// trace:exempt reason=internal-detail
export const LIFECYCLE_STAGES = ["ephemeral", "probation", "established", "mature"] as const;

// trace:exempt reason=internal-detail
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

// trace:exempt reason=internal-detail
export interface RentRecord {
  uses: number;
  successes: number;
  errors: number;
  tasks: string[];
  idleTurns: number;
}

// trace:exempt reason=internal-detail
export interface CandidateMetrics {
  score: number;
  cost: number;
}

// trace:exempt reason=internal-detail
export type RentEvent = { kind: "use"; ok: boolean; task?: string } | { kind: "idle"; turns?: number };

// trace:exempt reason=internal-detail
export type DeprecationReason = "unused" | "dominated" | "error-rate";

// trace:exempt reason=internal-detail
export interface ConsolidationInput {
  tags: readonly string[];
  uses: readonly string[];
}

// trace:exempt reason=internal-detail
export interface ConsolidationOutcome {
  consolidate: boolean;
  tagOverlap: number;
  useOverlap: number;
}

// trace:exempt reason=internal-detail
export const EPHEMERAL_EXIT_SUCCESSES = 3;
// trace:exempt reason=internal-detail
export const PROBATION_EXIT_USES = 10;
// trace:exempt reason=internal-detail
export const PROBATION_MAX_ERROR_RATE = 0.2;
// trace:exempt reason=internal-detail
export const ESTABLISHED_EXIT_USES = 50;
// trace:exempt reason=internal-detail
export const ESTABLISHED_MAX_ERROR_RATE = 0.1;
// trace:exempt reason=internal-detail
export const IDLE_DEPRECATION_TURNS = 100;
// trace:exempt reason=internal-detail
export const ERROR_DEPRECATION_USES = 20;
// trace:exempt reason=internal-detail
export const ERROR_DEPRECATION_RATE = 0.2;
// trace:exempt reason=internal-detail
export const CONSOLIDATION_TAG_OVERLAP = 0.8;
// trace:exempt reason=internal-detail
export const CONSOLIDATION_USE_OVERLAP = 0.7;

// trace:v1 id=impl.sc-lifecycle-dominates work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
export function dominates(challenger: CandidateMetrics, incumbent: CandidateMetrics): boolean {
  const noWorse = challenger.score >= incumbent.score && challenger.cost <= incumbent.cost;
  const strictlyBetter = challenger.score > incumbent.score || challenger.cost < incumbent.cost;
  return noWorse && strictlyBetter;
}

// trace:v1 id=impl.sc-lifecycle-empty-rent work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export function emptyRent(): RentRecord {
  return { uses: 0, successes: 0, errors: 0, tasks: [], idleTurns: 0 };
}

// trace:v1 id=impl.sc-lifecycle-track-rent work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export function trackRent(rent: RentRecord, event: RentEvent): RentRecord {
  if (event.kind === "idle") {
    const turns = event.turns ?? 1;
    if (!Number.isFinite(turns) || turns < 0) {
      throw new Error(`idle turns must be a non-negative number (got ${String(turns)})`);
    }
    return { ...rent, idleTurns: rent.idleTurns + turns };
  }
  // trace:exempt reason=internal-detail
  const tasks =
    event.task === undefined || rent.tasks.includes(event.task) ? rent.tasks : [...rent.tasks, event.task];
  return {
    uses: rent.uses + 1,
    successes: rent.successes + (event.ok ? 1 : 0),
    errors: rent.errors + (event.ok ? 0 : 1),
    tasks,
    idleTurns: 0,
  };
}

// trace:v1 id=impl.sc-lifecycle-error-rate work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export function errorRate(rent: RentRecord): number {
  return rent.uses === 0 ? 0 : rent.errors / rent.uses;
}

// trace:v1 id=impl.sc-lifecycle-advance work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export function advanceStage(stage: LifecycleStage, rent: RentRecord): LifecycleStage {
  const rate = errorRate(rent);
  if (stage === "ephemeral" && rent.successes >= EPHEMERAL_EXIT_SUCCESSES && rent.tasks.length >= EPHEMERAL_EXIT_SUCCESSES) {
    return "probation";
  }
  if (stage === "probation" && rent.uses >= PROBATION_EXIT_USES && rate <= PROBATION_MAX_ERROR_RATE) {
    return "established";
  }
  if (stage === "established" && rent.uses >= ESTABLISHED_EXIT_USES && rate <= ESTABLISHED_MAX_ERROR_RATE) {
    return "mature";
  }
  return stage;
}

// trace:v1 id=impl.sc-lifecycle-deprecation work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export function deprecationReason(input: {
  stage: LifecycleStage;
  rent: RentRecord;
  self?: CandidateMetrics;
  peers?: readonly CandidateMetrics[];
}): DeprecationReason | null {
  if (input.rent.idleTurns >= IDLE_DEPRECATION_TURNS) return "unused";
  // trace:exempt reason=internal-detail
  const self = input.self;
  if (self !== undefined && (input.peers ?? []).some((peer) => dominates(peer, self))) {
    return "dominated";
  }
  if (input.rent.uses >= ERROR_DEPRECATION_USES && errorRate(input.rent) > ERROR_DEPRECATION_RATE) {
    return "error-rate";
  }
  return null;
}

// trace:exempt reason=internal-detail
function containmentOverlap(leftTags: readonly string[], rightTags: readonly string[]): number {
  // trace:exempt reason=internal-detail
  const left = new Set(leftTags);
  // trace:exempt reason=internal-detail
  const right = new Set(rightTags);
  // trace:exempt reason=internal-detail
  const smaller = Math.min(left.size, right.size);
  if (smaller === 0) return 0;
  // trace:exempt reason=internal-detail
  let shared = 0;
  for (const value of left) {
    if (right.has(value)) shared += 1;
  }
  return shared / smaller;
}

// trace:v1 id=impl.sc-lifecycle-consolidation work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export function consolidationOutcome(a: ConsolidationInput, b: ConsolidationInput): ConsolidationOutcome {
  const tagOverlap = containmentOverlap(a.tags, b.tags);
  const useOverlap = containmentOverlap(a.uses, b.uses);
  return {
    consolidate: tagOverlap >= CONSOLIDATION_TAG_OVERLAP && useOverlap >= CONSOLIDATION_USE_OVERLAP,
    tagOverlap,
    useOverlap,
  };
}
