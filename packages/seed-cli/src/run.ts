// seed-cli run: single-task execution sequence (pin champion, pick caps, probe, record).
//
// Purpose: `seed run` executes one task through the organism sequence and
// records it. Why it exists: REQ-SEED-EZPD6B85 needs `seed run` to be a real
// end-to-end demo on a fresh checkout (echo fixture is the runnable path
// until task/lab runners land). Responsibilities: pin the champion ref for
// the session, rank capability manifests through the core BM25 router
// (max 8, python pinned), emit task.start, execute the echo probe, persist
// the run record + task.result.
// Invariants: never touches the network; never exceeds 8 capabilities
// (single choke point: selectTools in seed-core); every run is recorded
// even when the probe fails (ok=false). Public functions/types: RunOptions,
// RunResult, runTask.

import { appendJsonl, loadChampion, recordRun, stateDir } from "./state.ts";
import type { RunRecord } from "./state.ts";
import { callEcho, discoverCapabilities } from "./capabilities.ts";
import { selectTools } from "@seed/seed-core/src/router.ts";
// trace:exempt reason=internal-detail
export interface RunOptions {
  capabilities?: string[];
  session?: string;
  root?: string;
}


// trace:v1 id=impl.cli-run-task work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export async function runTask(prompt: string, options: RunOptions = {}): Promise<RunRecord> {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error("run needs a non-empty prompt");
  const root = options.root;
  const champion = loadChampion(root);
  const session = options.session ?? `sess-${Date.now().toString(36)}-${process.pid}`;
  // trace:exempt reason=internal-detail
  const cards = discoverCapabilities(root).map((manifest) => ({
    id: manifest.name,
    name: manifest.name,
    description: `${manifest.description ?? ""} ${(manifest.tools ?? []).join(" ")}`,
    capability: manifest.name,
    languages: [] as readonly string[],
  }));
  // trace:exempt reason=internal-detail
  const selected = selectTools({ task: trimmed, cards });
  // trace:exempt reason=internal-detail
  const wanted = options.capabilities?.length ? new Set(options.capabilities) : null;
  // trace:exempt reason=internal-detail
  const picked = selected
    .filter((entry) => (wanted ? wanted.has(entry.id) : true))
    .map((entry) => entry.id);
  // trace:exempt reason=internal-detail
  const id = `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
  // trace:exempt reason=internal-detail
  const at = new Date().toISOString();
  // trace:exempt reason=internal-detail
  appendJsonl(`${stateDir(root)}/events.jsonl`, {
    type: "task.start",
    timestamp: at,
    session,
    payload: { runId: id, prompt: trimmed.slice(0, 200), champion: champion.ref },
  });
  try {
    // trace:exempt reason=internal-detail
    const echoed = callEcho({ prompt: trimmed, session, champion: champion.ref }, root);
    // trace:exempt reason=internal-detail
    const record: RunRecord = {
      id,
      at,
      session,
      prompt: trimmed,
      capabilities: picked,
      ok: true,
      detail: `champion=${champion.ref} caps=[${picked.join(",")}] echo=${JSON.stringify(echoed).slice(0, 120)}`,
    };
    // trace:exempt reason=internal-detail
    recordRun(record, root);
    return record;
  } catch (error) {
    // trace:exempt reason=internal-detail
    const record: RunRecord = {
      id,
      at,
      session,
      prompt: trimmed,
      capabilities: picked,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
    // trace:exempt reason=internal-detail
    recordRun(record, root);
    return record;
  }
}
