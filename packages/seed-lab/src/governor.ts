// Seed lab governor: budget enforcement and evolution-loop scheduling.
//
// Purpose: cap what the organism may spend (INLINE/POST_TASK/INCUBATOR lanes)
// and decide when each evolution trigger fires (cheap/normal/scientist/challenges).
// Why it exists: without guardian-side budgets the loop burns money polishing;
// without counted triggers the scientist runs on vibes.
// Responsibilities: lane verdicts, budget constants, trigger predicates.
// Invariants: all decisions are pure functions of explicit counters; no I/O,
// no clocks, no hidden state. Thresholds are exported constants, never literals.
// Public types/functions: Lane, PromotionKind, LaneBudgets, InlineAsk, Verdict,
// freshBudgets, budgets (INLINE_CPU_BUDGET_MS, POST_TASK_*, INCUBATOR_*), inlineVerdict,
// postTaskVerdict, incubatorVerdict, cheapDue, normalDue, scientistDue, challengesDue.

// trace:exempt reason=internal-detail
export type Lane = "INLINE" | "POST_TASK" | "INCUBATOR";

// Promotion kinds the scientist reacts to immediately (any one fires the trigger).
// trace:exempt reason=internal-detail
export type PromotionKind = "context" | "editing" | "router" | "loop" | "arch";

// Inline lane: allowed when blocked OR expected savings cover >=4x cost,
// inside a 30s cumulative CPU budget, while the queue is not overflowing.
export const INLINE_CPU_BUDGET_MS = 30_000;
export const INLINE_SAVINGS_MULTIPLE = 4;

// Post-task lane: exactly 1 reflection call, at most 5s CPU.
export const POST_TASK_MAX_CALLS = 1;
export const POST_TASK_CPU_BUDGET_MS = 5_000;

// Incubator lane: at most 10% of spend and 10% of tokens, $10/day cap,
// at most 25% CPU while in the foreground, idle-only unless `evolve run`.
export const INCUBATOR_SPEND_SHARE = 0.1;
export const INCUBATOR_DAY_SPEND_CAP_USD = 10;
export const INCUBATOR_TOKEN_SHARE = 0.1;
export const INCUBATOR_FOREGROUND_CPU_SHARE = 0.25;

// Trigger cadences: cheap every task; normal 10 tasks OR 5 clusters;
// scientist 50 tasks or any promotion; challenges 20 tasks or any promotion.
export const NORMAL_TASK_INTERVAL = 10;
export const NORMAL_CLUSTER_COUNT = 5;
export const SCIENTIST_TASK_INTERVAL = 50;
export const CHALLENGE_TASK_INTERVAL = 20;

export interface InlineAsk {
  blocked: boolean;
  expectedSavings: number;
  expectedCost: number;
}

// trace:exempt reason=internal-detail
export interface LaneBudgets {
  inlineCpuMsUsed: number;
  inlineQueueDepth: number;
  maxInlineQueue: number;
  postTaskCallsMade: number;
  postTaskCpuMs: number;
  incubatorSpendUsd: number;
  totalSpendUsd: number;
  daySpendUsd: number;
  incubatorTokens: number;
  totalTokens: number;
  foregroundCpuShare: number;
  idle: boolean;
  explicitEvolveRun: boolean;
}

// trace:exempt reason=internal-detail
export interface Verdict {
  allow: boolean;
  reason: string;
}

// trace:v1 id=impl.governor-fresh work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function freshBudgets(): LaneBudgets {
  return {
    inlineCpuMsUsed: 0,
    inlineQueueDepth: 0,
    maxInlineQueue: 8,
    postTaskCallsMade: 0,
    postTaskCpuMs: 0,
    incubatorSpendUsd: 0,
    totalSpendUsd: 0,
    daySpendUsd: 0,
    incubatorTokens: 0,
    totalTokens: 0,
    foregroundCpuShare: 0,
    idle: true,
    explicitEvolveRun: false,
  };
}

// trace:v1 id=impl.governor-inline work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function inlineVerdict(b: LaneBudgets, ask: InlineAsk): Verdict {
  if (b.inlineQueueDepth >= b.maxInlineQueue) return { allow: false, reason: "queue-overflow" };
  if (b.inlineCpuMsUsed >= INLINE_CPU_BUDGET_MS)
    return { allow: false, reason: "inline-cpu-budget-exhausted" };
  if (!(ask.blocked || ask.expectedSavings >= INLINE_SAVINGS_MULTIPLE * ask.expectedCost))
    return { allow: false, reason: "savings-below-4x-cost" };
  return { allow: true, reason: "blocked-or-savings-cover-cost" };
}

// trace:v1 id=impl.governor-posttask-verdict work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function postTaskVerdict(b: LaneBudgets): Verdict {
  if (b.postTaskCallsMade >= POST_TASK_MAX_CALLS)
    return { allow: false, reason: "post-task-call-already-used" };
  if (b.postTaskCpuMs > POST_TASK_CPU_BUDGET_MS)
    return { allow: false, reason: "post-task-cpu-over-5s" };
  return { allow: true, reason: "one-reflection-call-within-5s" };
}

// trace:v1 id=impl.governor-incubator-verdict work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function incubatorVerdict(b: LaneBudgets): Verdict {
  if (!b.idle && !b.explicitEvolveRun)
    return { allow: false, reason: "foreground-requires-evolve-run" };
  if (!b.idle && b.foregroundCpuShare > INCUBATOR_FOREGROUND_CPU_SHARE)
    return { allow: false, reason: "foreground-cpu-over-25pct" };
  if (b.daySpendUsd >= INCUBATOR_DAY_SPEND_CAP_USD)
    return { allow: false, reason: "day-spend-over-10usd" };
  if (b.totalSpendUsd > 0 && b.incubatorSpendUsd / b.totalSpendUsd > INCUBATOR_SPEND_SHARE)
    return { allow: false, reason: "spend-over-10pct" };
  if (b.totalTokens > 0 && b.incubatorTokens / b.totalTokens > INCUBATOR_TOKEN_SHARE)
    return { allow: false, reason: "tokens-over-10pct" };
  return { allow: true, reason: "within-incubator-budgets" };
}

// trace:v1 id=impl.governor-cheap work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function cheapDue(tasksSinceLastRun: number): boolean {
  return tasksSinceLastRun >= 1;
}

// trace:v1 id=impl.governor-normal work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function normalDue(tasksSince: number, clustersSince: number): boolean {
  return tasksSince >= NORMAL_TASK_INTERVAL || clustersSince >= NORMAL_CLUSTER_COUNT;
}

// trace:v1 id=impl.governor-scientist work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function scientistDue(tasksSince: number, promotions: PromotionKind[]): boolean {
  return tasksSince >= SCIENTIST_TASK_INTERVAL || promotions.length > 0;
}

// trace:v1 id=impl.governor-challenges work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function challengesDue(tasksSince: number, promotions: PromotionKind[]): boolean {
  return tasksSince >= CHALLENGE_TASK_INTERVAL || promotions.length > 0;
}
