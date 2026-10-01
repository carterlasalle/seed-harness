/**
 * seed-core friction rules: deterministic signals over task telemetry.
 *
 * Purpose: turn a task's observation stream into friction signals by pure
 * rule evaluation (spec section 45 rules, section 46 signal schema).
 * Why it exists: the lab loop needs ungameable, unit-testable evidence of
 * where the organism struggles; a model's self-report cannot be trusted for
 * this, so the rules are counted thresholds, not judgments.
 * Responsibilities: nine rules — repeat (same call >= 3), error (same call
 * failing >= 2), search (same query >= 3), compile-loop (same compile error
 * >= 2), context-recovery (3 consecutive context turns), ephemeral (>= 3
 * throwaway artifacts), user-correction (>= 1), context-waste (> 64 KiB
 * produced and < 25% consumed), latency-outlier (> 2x median and > 1s).
 * Invariants: pure and deterministic — same observations in, same signals out
 * (sorted by turn then rule); severity is derived from count vs threshold
 * (`min(1, count / (2 * threshold))`), never from wall-clock or randomness.
 * Public: detectFriction, FrictionObservation, FrictionSignal,
 * FrictionRule, FRICTION_THRESHOLDS.
 */

// trace:exempt reason=internal-detail
export type FrictionRule =
  | "repeat"
  | "error"
  | "search"
  | "compile-loop"
  | "context-recovery"
  | "ephemeral"
  | "user-correction"
  | "context-waste"
  | "latency-outlier";

// trace:exempt reason=internal-detail
export type FrictionObservationKind =
  | "tool"
  | "search"
  | "compile"
  | "user"
  | "context"
  | "artifact";

// trace:exempt reason=internal-detail
export interface FrictionObservation {
  turn: number;
  kind: FrictionObservationKind;
  tool?: string;
  key?: string;
  status?: "ok" | "error";
  latencyMs?: number;
  bytes?: number;
  consumedBytes?: number;
  ephemeral?: boolean;
  correction?: boolean;
  task?: string;
  subsystem?: string;
  session?: string;
}

// trace:exempt reason=internal-detail
export interface FrictionSignal {
  rule: FrictionRule;
  severity: number;
  count: number;
  turn: number;
  detail: string;
  tool: string | null;
  task: string | null;
  subsystem: string | null;
  session: string | null;
}

// trace:exempt reason=internal-detail
export const FRICTION_THRESHOLDS = {
  repeat: 3,
  error: 2,
  search: 3,
  compileLoop: 2,
  contextRecoveryTurns: 3,
  ephemeral: 3,
  userCorrection: 1,
  contextWasteBytes: 65536,
  contextConsumedRatio: 0.25,
  latencyFactor: 2,
  latencyFloorMs: 1000,
} as const;

// trace:exempt reason=internal-detail
function severityFor(count: number, threshold: number): number {
  return Math.min(1, count / (2 * threshold));
}

// trace:exempt reason=internal-detail
function makeSignal(
  rule: FrictionRule,
  count: number,
  threshold: number,
  first: FrictionObservation,
  detail: string,
): FrictionSignal {
  return {
    rule,
    severity: severityFor(count, threshold),
    count,
    turn: first.turn,
    detail,
    tool: first.tool ?? null,
    task: first.task ?? null,
    subsystem: first.subsystem ?? null,
    session: first.session ?? null,
  };
}

// trace:exempt reason=internal-detail
function identityOf(observation: FrictionObservation): string | null {
  if (observation.key !== undefined) {
    return `${observation.tool ?? observation.kind}:${observation.key}`;
  }
  return observation.tool === undefined ? null : `${observation.kind}:${observation.tool}`;
}

// trace:exempt reason=internal-detail
function groupSignals(
  observations: readonly FrictionObservation[],
  rule: FrictionRule,
  threshold: number,
  matches: (observation: FrictionObservation) => boolean,
  detailFor: (identity: string, count: number) => string,
): FrictionSignal[] {
  // trace:exempt reason=internal-detail
  const groups = new Map<string, FrictionObservation[]>();
  for (const observation of observations) {
    if (!matches(observation)) continue;
    // trace:exempt reason=internal-detail
    const identity = identityOf(observation);
    if (identity === null) continue;
    // trace:exempt reason=internal-detail
    const bucket = groups.get(identity);
    if (bucket === undefined) groups.set(identity, [observation]);
    else bucket.push(observation);
  }
  // trace:exempt reason=internal-detail
  const signals: FrictionSignal[] = [];
  for (const [identity, group] of groups) {
    if (group.length < threshold) continue;
    // trace:exempt reason=internal-detail
    const first = group[0];
    if (first === undefined) continue;
    signals.push(makeSignal(rule, group.length, threshold, first, detailFor(identity, group.length)));
  }
  return signals;
}

// trace:exempt reason=internal-detail
function contextRecoverySignals(observations: readonly FrictionObservation[]): FrictionSignal[] {
  // trace:exempt reason=internal-detail
  const threshold = FRICTION_THRESHOLDS.contextRecoveryTurns;
  // trace:exempt reason=internal-detail
  const signals: FrictionSignal[] = [];
  // trace:exempt reason=internal-detail
  let run: FrictionObservation[] = [];
  // trace:exempt reason=internal-detail
  const flush = (): void => {
    if (run.length >= threshold) {
      // trace:exempt reason=internal-detail
      const first = run[0];
      if (first !== undefined) {
        signals.push(makeSignal("context-recovery", run.length, threshold, first, `${run.length} consecutive context-recovery turns`));
      }
    }
    run = [];
  };
  for (const observation of observations) {
    if (observation.kind === "context") run.push(observation);
    else flush();
  }
  // trace:exempt reason=internal-detail
  flush();
  return signals;
}

// trace:exempt reason=internal-detail
function ephemeralSignals(observations: readonly FrictionObservation[]): FrictionSignal[] {
  // trace:exempt reason=internal-detail
  const threshold = FRICTION_THRESHOLDS.ephemeral;
  // trace:exempt reason=internal-detail
  const ephemeral = observations.filter((observation) => observation.ephemeral === true);
  // trace:exempt reason=internal-detail
  const first = ephemeral[0];
  if (first === undefined || ephemeral.length < threshold) return [];
  return [makeSignal("ephemeral", ephemeral.length, threshold, first, `${ephemeral.length} ephemeral artifacts never reused`)];
}

// trace:exempt reason=internal-detail
function correctionSignals(observations: readonly FrictionObservation[]): FrictionSignal[] {
  // trace:exempt reason=internal-detail
  const threshold = FRICTION_THRESHOLDS.userCorrection;
  // trace:exempt reason=internal-detail
  const corrections = observations.filter((observation) => observation.correction === true);
  // trace:exempt reason=internal-detail
  const first = corrections[0];
  if (first === undefined || corrections.length < threshold) return [];
  return [makeSignal("user-correction", corrections.length, threshold, first, `${corrections.length} user correction(s)`)];
}

// trace:exempt reason=internal-detail
function contextWasteSignals(observations: readonly FrictionObservation[]): FrictionSignal[] {
  // trace:exempt reason=internal-detail
  const threshold = FRICTION_THRESHOLDS.contextWasteBytes;
  // trace:exempt reason=internal-detail
  const wasted = observations.filter(
    (observation) =>
      observation.bytes !== undefined &&
      observation.consumedBytes !== undefined &&
      observation.bytes > threshold &&
      observation.consumedBytes < observation.bytes * FRICTION_THRESHOLDS.contextConsumedRatio,
  );
  // trace:exempt reason=internal-detail
  const first = wasted[0];
  if (first === undefined) return [];
  return [
    // trace:exempt reason=internal-detail
    makeSignal(
      "context-waste",
      wasted.length,
      1,
      first,
      `${wasted.length} artifact(s) over 64KiB with under 25% consumed`,
    ),
  ];
}

// trace:exempt reason=internal-detail
function latencySignals(observations: readonly FrictionObservation[]): FrictionSignal[] {
  // trace:exempt reason=internal-detail
  const latencies = observations
    .map((observation) => observation.latencyMs)
    .filter((latency): latency is number => latency !== undefined);
  if (latencies.length === 0) return [];
  // trace:exempt reason=internal-detail
  const sorted = [...latencies].sort((a, b) => a - b);
  // trace:exempt reason=internal-detail
  const middle = Math.floor(sorted.length / 2);
  // trace:exempt reason=internal-detail
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
      : (sorted[middle] ?? 0);
  // trace:exempt reason=internal-detail
  const outliers = observations.filter(
    (observation) =>
      observation.latencyMs !== undefined &&
      observation.latencyMs > FRICTION_THRESHOLDS.latencyFactor * median &&
      observation.latencyMs > FRICTION_THRESHOLDS.latencyFloorMs,
  );
  // trace:exempt reason=internal-detail
  const first = outliers[0];
  if (first === undefined) return [];
  return [
    // trace:exempt reason=internal-detail
    makeSignal(
      "latency-outlier",
      outliers.length,
      1,
      first,
      `${outliers.length} call(s) over 2x median (${median}ms) and 1000ms`,
    ),
  ];
}

// trace:exempt reason=internal-detail
function compareSignals(a: FrictionSignal, b: FrictionSignal): number {
  if (a.turn !== b.turn) return a.turn - b.turn;
  if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
  if (a.detail === b.detail) return 0;
  return a.detail < b.detail ? -1 : 1;
}

// trace:v1 id=impl.sc-friction-detect work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function detectFriction(observations: readonly FrictionObservation[]): FrictionSignal[] {
  const signals: FrictionSignal[] = [
    ...groupSignals(
      observations,
      "repeat",
      FRICTION_THRESHOLDS.repeat,
      (observation) => observation.kind === "tool",
      (identity, count) => `same call repeated ${count} times (${identity})`,
    ),
    ...groupSignals(
      observations,
      "error",
      FRICTION_THRESHOLDS.error,
      (observation) => observation.status === "error",
      (identity, count) => `same call failed ${count} times (${identity})`,
    ),
    ...groupSignals(
      observations,
      "search",
      FRICTION_THRESHOLDS.search,
      (observation) => observation.kind === "search",
      (identity, count) => `same search repeated ${count} times (${identity})`,
    ),
    ...groupSignals(
      observations,
      "compile-loop",
      FRICTION_THRESHOLDS.compileLoop,
      (observation) => observation.kind === "compile" && observation.status === "error",
      (identity, count) => `same compile error repeated ${count} times (${identity})`,
    ),
    ...contextRecoverySignals(observations),
    ...ephemeralSignals(observations),
    ...correctionSignals(observations),
    ...contextWasteSignals(observations),
    ...latencySignals(observations),
  ];
  return signals.sort(compareSignals);
}
