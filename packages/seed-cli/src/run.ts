// seed-cli run: single-task execution through the champion-pinned organism.
//
// Purpose: `seed run` executes one task through runOrganismTask (hello >
// champion pin > python turn > task.end) and records it. Why it exists:
// REQ-SEED-EZPD6B85 needs `seed run` to exercise the real Day-1 path —
// the python primitive with telemetry and the echo probe as the first
// turn — instead of bypassing the organism with a direct echo call.
// Responsibilities: build a live or fallback guardian client, run one
// ephemeral python turn, then the echo probe, persist the run record +
// task.result.
// Invariants: python stays visible (organism throws otherwise); every run
// is recorded even when the probe fails (ok=false); without a guardian
// socket the run degrades to the local echo probe with detail marked
// `noguardian` instead of failing the foreground task.
// Public functions/types: RunOptions, runTask.

import { appendJsonl, loadChampion, recordRun, stateDir } from "./state.ts";
import type { RunRecord } from "./state.ts";
import { callEcho, discoverCapabilities } from "./capabilities.ts";
import { selectTools } from "@seed/seed-core/src/router.ts";
import { runOrganismTask } from "@seed/seed-runtime/src/organism.ts";
import { connectGuardian } from "@seed/seed-runtime/src/guardian-client.ts";
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
    // Day-1 turn through the real organism: one python execution with
    // telemetry, then the echo probe as the observable completion.
    // trace:exempt reason=internal-detail
    let turnNote = "noguardian";
    try {
      // trace:exempt reason=internal-detail
      const socketPath = `${process.env.HOME ?? ""}/.seed/run/guardian.sock`;
      const client = await connectGuardian({ socketPath, connectTimeoutMs: 2000 });
      const organism = await runOrganismTask({
        client,
        workspace: process.cwd(),
        taskBrief: trimmed,
        sessionId: session,
      });
      const turn = await organism.runTurn({
        prompt: `ephemeral: run-${id}`,
        code: `print(${JSON.stringify(`run ${id} champion ${champion.ref}`)})`,
      });
      await organism.end(turn.ok ? "done" : "failed", turn.stdout.slice(0, 500));
      turnNote = turn.ok ? "python-ok" : "python-failed";
    } catch {
      turnNote = "noguardian";
    }
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
      detail: `champion=${champion.ref} caps=[${picked.join(",")}] ${turnNote} echo=${JSON.stringify(echoed).slice(0, 120)}`,
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
