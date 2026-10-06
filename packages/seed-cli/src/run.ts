// seed-cli run: single-task execution through the champion-pinned organism.
//
// Purpose: `seed run` executes one task through runOrganismTask (hello >
// champion pin > model-driven python turns > task.end) and records it.
// Why it exists: TOTALSPEC needs `seed run` to run a real model agent loop
// against the guardian — no probe, no echo, no noguardian fallback.
// Responsibilities: mandatory guardian client, champion from hello (single
// truth), model turn loop, friction over the real trajectory, run record.
// Invariants: guardian failure fails the run (never a successful echo);
// champion in the record is the hello-pinned sha; every python turn emits
// telemetry via the organism.
// Public functions/types: RunOptions, runTask.

import { randomUUID } from "node:crypto";
import { appendJsonl, loadChampion, recentRuns, recordRun, stateDir } from "./state.ts";
import type { RunRecord } from "./state.ts";
import { discoverCapabilities } from "./capabilities.ts";
import { selectTools } from "@carterlasalle/seed-core/dist/router.js";
import { runOrganismTask } from "@carterlasalle/seed-runtime/dist/organism.js";
import { connectGuardian } from "@carterlasalle/seed-runtime/dist/guardian-client.js";
import { detectFriction } from "@carterlasalle/seed-core/dist/friction.js";
import type { FrictionObservation } from "@carterlasalle/seed-core/dist/friction.js";
import { runEvolutionCycle } from "@carterlasalle/seed-lab/dist/evolution.js";
export interface RunOptions {
  capabilities?: string[];
  session?: string;
  root?: string;
  model?: string;
  maxTurns?: number;
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
  // Run ids are written into state files, so they come from the CSPRNG rather
  // than Math.random: predictable identifiers in a persisted record are a
  // weakness, and a UUID also cannot collide.
  const id = `run-${randomUUID()}`;
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
    // Real agent loop: guardian is mandatory (no noguardian fallback),
    // champion comes from hello (single truth), the model drives python
    // turns, friction runs over the real trajectory.
    // trace:exempt reason=internal-detail
    const socketPath = `${process.env.HOME ?? ""}/.seed/run/guardian.sock`;
    const client = await connectGuardian({ socketPath, connectTimeoutMs: 5000 });
    const organism = await runOrganismTask({
      client,
      workspace: process.cwd(),
      taskBrief: trimmed,
      sessionId: session,
    });
    // trace:exempt reason=internal-detail
    const pinned = organism.hello.champion_sha || champion.ref;
    // trace:exempt reason=internal-detail
    const loop = await organism.runAgentLoop({ maxTurns: options.maxTurns ?? 12, model: options.model, skills: cards.map((c) => ({ id: c.id, description: c.description })), hooks: [{ event: "before_model", payload: ({ index }: { index: number; text: string; ok: boolean }) => `turn-${index}-before` }, { event: "after_model", payload: ({ index, text }: { index: number; text: string; ok: boolean }) => `turn-${index}:${text.slice(0, 40)}` }] });
    await organism.end(loop.turns.length > 0 && loop.done ? "done" : "failed", loop.summary.slice(0, 500) || trimmed.slice(0, 500));
    // trace:exempt reason=internal-detail
    const turnNote = `agent-turns=${loop.turns.length}`;
    // trace:exempt reason=internal-detail
    const observations: FrictionObservation[] = loop.turns.map((t, index) => ({
      turn: index + 1, kind: "tool", tool: "python", status: t.ok ? "ok" : "error",
    }));
    // trace:exempt reason=internal-detail
    const signals = detectFriction(observations);
    // trace:exempt reason=internal-detail
    const frictionNote = signals.length === 0 ? "friction=none" : `friction=${signals.map((s) => s.rule).join("+")}`;
    // trace:exempt reason=internal-detail
    const cycle = await runEvolutionCycle({
      client,
      taskId: id,
      observations,
      signals,
      tasksSinceCycle: recentRuns(5, root).length,
      clustersSinceCycle: 0,
      model: options.model,
    }).catch(() => null);
    // trace:exempt reason=internal-detail
    const cycleNote = cycle ? ` cycle=[${cycle.stages.join(" ")}]` : "";
    // trace:exempt reason=internal-detail
    const record: RunRecord = {
      id,
      at,
      session,
      prompt: trimmed,
      capabilities: picked,
      ok: loop.done && loop.turns.length > 0,
      detail: `champion=${pinned} caps=[${picked.join(",")}] ${turnNote} ${frictionNote}${cycleNote} summary=${loop.summary.slice(0, 120)}`,
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
      detail: `champion=${champion.ref} agent-turns=0 friction=none error=${error instanceof Error ? error.message : String(error)}`,
    };
    // trace:exempt reason=internal-detail
    recordRun(record, root);
    return record;
  }
}
