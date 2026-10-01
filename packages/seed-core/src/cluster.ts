/**
 * seed-core friction clustering: deterministic grouping + actionability.
 *
 * Purpose: group friction signals that share categorical features into
 * clusters the backlog and scientist can act on.
 * Why it exists: individual signals are noisy; recurring patterns across
 * tasks/tools/subsystems are the evidence worth spending budget on, and the
 * grouping must be reproducible for the same signal stream.
 * Responsibilities: greedy deterministic grouping (a signal joins the first
 * cluster sharing >= 3 of the 5 categorical features: rule, tool, subsystem,
 * task, session), cluster summaries (agreed features, distinct tasks,
 * occurrences, max severity) and the actionability rule (>= 3 tasks OR
 * >= 5 occurrences OR severity >= 0.90).
 * Invariants: pure; cluster ids are assigned in signal order (`cluster-1`,
 * `cluster-2`, ...); a feature is only recorded on a cluster when every member
 * that carries a value agrees; output sorted by severity desc, occurrences
 * desc, id asc.
 * Public: clusterFriction, FrictionCluster, CLUSTER_FEATURES,
 * CLUSTER_ACTIONABLE_* thresholds.
 */

import type { FrictionSignal } from "./friction.ts";

// trace:exempt reason=internal-detail
export const CLUSTER_FEATURES = ["rule", "tool", "subsystem", "task", "session"] as const;

// trace:exempt reason=internal-detail
export type ClusterFeature = (typeof CLUSTER_FEATURES)[number];

// trace:exempt reason=internal-detail
export const CLUSTER_MATCH_FEATURES = 3;
// trace:exempt reason=internal-detail
export const CLUSTER_ACTIONABLE_TASKS = 3;
// trace:exempt reason=internal-detail
export const CLUSTER_ACTIONABLE_OCCURRENCES = 5;
// trace:exempt reason=internal-detail
export const CLUSTER_ACTIONABLE_SEVERITY = 0.9;

// trace:exempt reason=internal-detail
export interface FrictionCluster {
  id: string;
  signals: FrictionSignal[];
  features: Partial<Record<ClusterFeature, string>>;
  taskCount: number;
  occurrences: number;
  severity: number;
  actionable: boolean;
}

// trace:exempt reason=internal-detail
function featureValue(signal: FrictionSignal, feature: ClusterFeature): string | null {
  // trace:exempt reason=internal-detail
  const value = signal[feature];
  return typeof value === "string" && value !== "" ? value : null;
}

// trace:exempt reason=internal-detail
function agreement(clusterSignals: readonly FrictionSignal[]): Partial<Record<ClusterFeature, string>> {
  // trace:exempt reason=internal-detail
  const agreed: Partial<Record<ClusterFeature, string>> = {};
  for (const feature of CLUSTER_FEATURES) {
    // trace:exempt reason=internal-detail
    let value: string | null = null;
    // trace:exempt reason=internal-detail
    let consistent = true;
    for (const signal of clusterSignals) {
      // trace:exempt reason=internal-detail
      const candidate = featureValue(signal, feature);
      if (candidate === null) continue;
      if (value === null) value = candidate;
      else if (value !== candidate) consistent = false;
    }
    if (value !== null && consistent) agreed[feature] = value;
  }
  return agreed;
}

// trace:exempt reason=internal-detail
function matchingFeatures(a: FrictionSignal, b: FrictionSignal): number {
  // trace:exempt reason=internal-detail
  let matches = 0;
  for (const feature of CLUSTER_FEATURES) {
    // trace:exempt reason=internal-detail
    const left = featureValue(a, feature);
    // trace:exempt reason=internal-detail
    const right = featureValue(b, feature);
    if (left !== null && right !== null && left === right) matches += 1;
  }
  return matches;
}

// trace:exempt reason=internal-detail
function summarize(id: string, signals: FrictionSignal[]): FrictionCluster {
  // trace:exempt reason=internal-detail
  const tasks: Record<string, true> = {};
  // trace:exempt reason=internal-detail
  let occurrences = 0;
  // trace:exempt reason=internal-detail
  let severity = 0;
  for (const signal of signals) {
    if (signal.task !== null) tasks[signal.task] = true;
    occurrences += signal.count;
    if (signal.severity > severity) severity = signal.severity;
  }
  // trace:exempt reason=internal-detail
  const taskCount = Object.keys(tasks).length;
  // trace:exempt reason=internal-detail
  const actionable =
    taskCount >= CLUSTER_ACTIONABLE_TASKS ||
    occurrences >= CLUSTER_ACTIONABLE_OCCURRENCES ||
    severity >= CLUSTER_ACTIONABLE_SEVERITY;
  return { id, signals, features: agreement(signals), taskCount, occurrences, severity, actionable };
}

// trace:exempt reason=internal-detail
function compareClusters(a: FrictionCluster, b: FrictionCluster): number {
  if (a.severity !== b.severity) return a.severity > b.severity ? -1 : 1;
  if (a.occurrences !== b.occurrences) return a.occurrences > b.occurrences ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

// trace:exempt reason=internal-detail
function compareSignals(a: FrictionSignal, b: FrictionSignal): number {
  if (a.turn !== b.turn) return a.turn - b.turn;
  if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
  if (a.detail === b.detail) return 0;
  return a.detail < b.detail ? -1 : 1;
}

// trace:v1 id=impl.sc-cluster-friction work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function clusterFriction(signals: readonly FrictionSignal[]): FrictionCluster[] {
  const ordered = [...signals].sort(compareSignals);
  const groups: FrictionSignal[][] = [];
  for (const signal of ordered) {
    let target: FrictionSignal[] | null = null;
    for (const group of groups) {
      // trace:exempt reason=internal-detail
      const member = group[0];
      if (member === undefined) continue;
      if (matchingFeatures(signal, member) >= CLUSTER_MATCH_FEATURES) {
        target = group;
        break;
      }
    }
    if (target === null) groups.push([signal]);
    else target.push(signal);
  }
  return groups.map((group, index) => summarize(`cluster-${index + 1}`, group)).sort(compareClusters);
}
