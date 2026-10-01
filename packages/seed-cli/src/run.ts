// seed-cli run: single-task execution sequence (pin champion, pick caps, probe, record).
//
// Purpose: `seed run` executes one task through the organism sequence and
// records it. Why it exists: REQ-SEED-EZPD6B85 needs `seed run` to be a real
// end-to-end demo on a fresh checkout (echo fixture is the runnable path
// until task/lab runners land). Responsibilities: pin the champion ref for
// the session, rank capability manifests by prompt overlap (max 8), emit
// task.start, execute the echo probe, persist the run record + task.result.
// Invariants: never touches the network; never exceeds 8 capabilities;
// every run is recorded even when the probe fails (ok=false). Public
// functions/types: RunOptions, RunResult, runTask.

import { appendJsonl, loadChampion, recordRun, stateDir } from "./state.ts";
import type { RunRecord } from "./state.ts";
import { callEcho, discoverCapabilities } from "./capabilities.ts";

// trace:exempt reason=internal-detail
export interface RunOptions {
  capabilities?: string[];
  session?: string;
  root?: string;
}

// trace:exempt reason=internal-detail
export interface RankedCapability {
  name: string;
  score: number;
}

// trace:v1 id=impl.cli-run-task work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export async function runTask(prompt: string, options: RunOptions = {}): Promise<RunRecord> {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error("run needs a non-empty prompt");
  const root = options.root;
  const champion = loadChampion(root);
  const session = options.session ?? `sess-${Date.now().toString(36)}-${process.pid}`;
  // trace:exempt reason=unit-test
  const tokens = new Set(trimmed.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  // trace:exempt reason=internal-detail
  const ranked = discoverCapabilities(root)
    .map((manifest) => {
      // trace:exempt reason=internal-detail
      const haystack =
        `${manifest.name} ${manifest.description ?? ""} ${(manifest.tools ?? []).join(" ")}`.toLowerCase();
      // trace:exempt reason=internal-detail
      let score = 0;
      for (const token of tokens) {
        if (token.length > 2 && haystack.includes(token)) score += 1;
      }
      // trace:exempt reason=internal-detail
      const rankedCapability: RankedCapability = { name: manifest.name, score };
      return rankedCapability;
    })
    .sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : 1));
  // trace:exempt reason=internal-detail
  const wanted = options.capabilities?.length ? new Set(options.capabilities) : null;
  // trace:exempt reason=internal-detail
  const picked = ranked
    .filter((entry) => (wanted ? wanted.has(entry.name) : true))
    .slice(0, 8)
    .map((entry) => entry.name);
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
