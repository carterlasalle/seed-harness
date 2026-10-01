/**
 * seed-core friction backlog: prioritized work items from clusters.
 *
 * Purpose: turn actionable clusters into backlog items with a single
 * deterministic priority, and gate status moves through a fixed workflow.
 * Why it exists: the lab must spend budget in order of expected payoff, and
 * item state must be auditable (queued -> researching -> experimenting ->
 * resolved/dismissed) rather than edited ad hoc.
 * Responsibilities: item creation from a cluster (priority =
 * severity * frequency * cost), deterministic ordering, and legal status
 * transitions.
 * Invariants: pure; ordering is priority desc with id asc tie-break; illegal
 * transitions throw instead of silently mutating; resolved and dismissed are
 * terminal states.
 * Public: createBacklogItem, orderBacklog, transitionBacklog, BacklogItem,
 * BacklogStatus, BACKLOG_TRANSITIONS.
 */

import type { FrictionCluster } from "./cluster.ts";

// trace:exempt reason=internal-detail
export type BacklogStatus = "queued" | "researching" | "experimenting" | "resolved" | "dismissed";

// trace:exempt reason=internal-detail
export interface BacklogItem {
  id: string;
  clusterId: string;
  title: string;
  severity: number;
  frequency: number;
  cost: number;
  priority: number;
  status: BacklogStatus;
}

// trace:exempt reason=internal-detail
export const BACKLOG_TRANSITIONS: Record<BacklogStatus, readonly BacklogStatus[]> = {
  queued: ["researching", "dismissed"],
  researching: ["experimenting", "dismissed"],
  experimenting: ["resolved", "dismissed"],
  resolved: [],
  dismissed: [],
};

// trace:exempt reason=internal-detail
export const DEFAULT_BACKLOG_COST = 1;

// trace:v1 id=impl.sc-backlog-create work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function createBacklogItem(
  cluster: FrictionCluster,
  options: { cost?: number; title?: string } = {},
): BacklogItem {
  const cost = options.cost ?? DEFAULT_BACKLOG_COST;
  if (!Number.isFinite(cost) || cost <= 0) {
    throw new Error(`backlog cost must be a positive number (got ${String(cost)})`);
  }
  // trace:exempt reason=internal-detail
  const severity = cluster.severity;
  // trace:exempt reason=internal-detail
  const frequency = cluster.occurrences;
  return {
    id: `backlog-${cluster.id}`,
    clusterId: cluster.id,
    title: options.title ?? `friction ${cluster.id}`,
    severity,
    frequency,
    cost,
    priority: severity * frequency * cost,
    status: "queued",
  };
}

// trace:v1 id=impl.sc-backlog-order work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function orderBacklog(items: readonly BacklogItem[]): BacklogItem[] {
  return [...items].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority > b.priority ? -1 : 1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });
}

// trace:v1 id=impl.sc-backlog-transition work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function transitionBacklog(item: BacklogItem, status: BacklogStatus): BacklogItem {
  if (!BACKLOG_TRANSITIONS[item.status].includes(status)) {
    throw new Error(`illegal backlog transition ${item.status} -> ${status} for ${item.id}`);
  }
  return { ...item, status };
}
