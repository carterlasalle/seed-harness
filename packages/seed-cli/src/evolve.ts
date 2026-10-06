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
import { connectGuardian } from "@carterlasalle/seed-runtime/dist/guardian-client.js";
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

/** One candidate as the guardian reports it (metadata only). */
// trace:exempt reason=internal-detail
export interface CandidateSummary {
  id: string;
  ref: string;
  parent: string;
  status: string;
}

/** One Pareto archive member the guardian retained. */
// trace:exempt reason=internal-detail
export interface ArchiveMemberSummary {
  ref: string;
  novelty: number;
  tags: string[];
}

// trace:exempt reason=internal-detail
function socketPath(): string {
  return `${process.env.HOME ?? ""}/.seed/run/guardian.sock`;
}

/**
 * Candidates recorded by the guardian.
 *
 * Read-only and metadata-only: this is display provenance, never a promotion
 * input, and an unreachable guardian yields an empty list so a dialog can
 * still open offline.
 */
// trace:v1 id=impl.cli-evolve-candidates work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export async function listCandidates(): Promise<CandidateSummary[]> {
  try {
    const client = await connectGuardian({ socketPath: socketPath(), connectTimeoutMs: 1500 });
    const result = (await client.call("candidate.list", {})) as { candidates?: unknown };
    client.close();
    if (!Array.isArray(result?.candidates)) return [];
    return result.candidates.map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      return {
        id: typeof row.id === "string" ? row.id : "",
        ref: typeof row.ref === "string" ? row.ref : "",
        parent: typeof row.parent === "string" ? row.parent : "",
        status: typeof row.status === "string" ? row.status : "unknown",
      };
    });
  } catch {
    return [];
  }
}

/** Pareto archive members the guardian retained; empty when unreachable. */
// trace:v1 id=impl.cli-evolve-archive work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export async function listArchive(): Promise<ArchiveMemberSummary[]> {
  try {
    const client = await connectGuardian({ socketPath: socketPath(), connectTimeoutMs: 1500 });
    const result = (await client.call("archive.list", {})) as { members?: unknown };
    client.close();
    if (!Array.isArray(result?.members)) return [];
    return result.members.map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      return {
        ref: typeof row.ref === "string" ? row.ref : "",
        novelty: typeof row.novelty === "number" ? row.novelty : 0,
        tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === "string") : [],
      };
    });
  } catch {
    return [];
  }
}
