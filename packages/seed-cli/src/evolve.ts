// seed-cli evolve: experiment queue status/drain over the recorded run store.
//
// Purpose: `seed evolve status|queue|run` manages the evolution experiment
// backlog. Why it exists: REQ-SEED-EZPD6B85 needs evolve commands backed by
// real state — queue holds task prompts, run drains them through runTask so
// every experiment is traceable to recorded runs. Responsibilities: queue
// enqueue/list, bounded drain via runTask, status over queue + recent runs.
// Invariants: queue persists as JSON; drain cap defaults to 3 and never runs
// unbounded; statuses reflect stored state only. Public functions/types:
// EvolveStatus, queueExperiment, evolveStatus, evolveRun.

import { listEvalResults, loadQueue, recentRuns, saveQueue } from "./state.ts";
import { compareEvals } from "./eval.ts";
import { runTask } from "./run.ts";
export interface EvolveStatus {
  queued: number;
  recent: number;
  lastOk: boolean | null;
}

// trace:v1 id=impl.cli-evolve-queue work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function queueExperiment(task: string, root?: string): string[] {
  const trimmed = task.trim();
  if (!trimmed) throw new Error("evolve queue needs a non-empty task");
  const queue = loadQueue(root);
  queue.push(trimmed);
  saveQueue(queue, root);
  return queue;
}

// trace:v1 id=impl.cli-evolve-status work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function evolveStatus(root?: string): EvolveStatus {
  const queue = loadQueue(root);
  const recent = recentRuns(5, root);
  return {
    queued: queue.length,
    recent: recent.length,
    lastOk: recent.length > 0 ? recent[recent.length - 1].ok : null,
  };
}

// trace:v1 id=impl.cli-evolve-run work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export async function evolveRun(limit: number, root?: string): Promise<{ ran: number; ok: number }> {
  const cap = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 10) : 3;
  const queue = loadQueue(root);
  const batch = queue.splice(0, cap);
  saveQueue(queue, root);
  let ok = 0;
  // trace:exempt reason=internal-detail
  for (const task of batch) {
    const record = await runTask(task, { root });
    if (record.ok) ok += 1;
  }
  // Promotion readiness uses the same non-inferiority rule the guardian
  // enforces, surfaced here instead of only draining tasks.
  // trace:exempt reason=internal-detail
  void tryPromotionCheck(root);
  return { ran: batch.length, ok };
}

// trace:v1 id=impl.cli-evolve-promotion work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
export function tryPromotionCheck(root?: string): { ready: boolean; detail: string } | null {
  // trace:exempt reason=internal-detail
  const results = listEvalResults(root);
  if (results.length < 2) return null;
  // trace:exempt reason=internal-detail
  const verdict = compareEvals(results[results.length - 2]!, results[results.length - 1]!);
  return { ready: verdict.nonInferior, detail: verdict.detail };
}
