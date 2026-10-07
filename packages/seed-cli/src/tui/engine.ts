// tui/engine.ts — run a real task turn for the interactive frontend.
//
// Purpose: connect the TUI composer to the same agent loop the headless
// `seed run` uses, streaming each turn into the transcript as it happens.
// Why it exists: without this the frontend is a browser, not a product — the
// objective's whole point is that the UI projects the harness while it works.
// Responsibilities: open a guardian session, run the organism loop, translate
// turns into transcript events, and report the outcome.
// Invariants: the guardian is mandatory (no silent fallback); a connection or
// model failure is surfaced as an error event rather than swallowed; the
// session always closes, even when the loop throws.
// Public functions: runInteractiveTask.

import { connectGuardian } from "@carterlasalle/seed-runtime/dist/guardian-client.js";
import { guardianSocketPath } from "../guardian.ts";
import { runOrganismTask } from "@carterlasalle/seed-runtime/dist/organism.js";
import type { AgentLoopTurn } from "@carterlasalle/seed-runtime/dist/organism.js";
import type { TurnEvent } from "@carterlasalle/seed-tui/src/app.ts";

// trace:exempt reason=internal-detail
export interface InteractiveTaskOptions {
  cwd?: string;
  model?: string;
  maxTurns?: number;
  sessionId?: string;
  /** Reasoning effort forwarded to the model call. */
  thinking?: string;
}

/** First line of a code block, trimmed — the tool card's one-line summary. */
// trace:v1 id=impl.cli-tui-tool-summary work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function toolSummary(code: string): string {
  // trace:exempt reason=internal-detail
  const first = code.split("\n").find((line) => line.trim().length > 0) ?? "";
  return first.trim().slice(0, 72);
}

/**
 * Translate one completed loop turn into transcript events.
 *
 * `elapsedMs` is the wall time since the previous turn was reported, which is
 * the model round trip plus tool execution — the duration the user watched.
 */
// trace:v1 id=impl.cli-tui-turn-events work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function turnEvents(turn: AgentLoopTurn, elapsedMs: number): TurnEvent[] {
  const events: TurnEvent[] = [];
  const prose = turn.modelText.trim();
  if (prose.length > 0) events.push({ kind: "text", text: prose });
  // trace:exempt reason=internal-detail
  if (turn.code !== null) {
    events.push({ kind: "tool", name: "python", detail: toolSummary(turn.code) });
    events.push({ kind: "tool-done", name: "python", ok: turn.ok, durationMs: elapsedMs });
  }
  return events;
}

// trace:v1 id=impl.cli-tui-run-task work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export async function runInteractiveTask(
  prompt: string,
  emit: (event: TurnEvent) => void,
  options: InteractiveTaskOptions = {},
): Promise<{ ok: boolean; summary: string }> {
  const socketPath = guardianSocketPath();
  const client = await connectGuardian({ socketPath, connectTimeoutMs: 5000 });
  const sessionId =
    options.sessionId ?? `tui-${Date.now().toString(36)}-${process.pid.toString(36)}`;
  try {
    const organism = await runOrganismTask({
      client,
      workspace: options.cwd ?? process.cwd(),
      taskBrief: prompt,
      sessionId,
    });
    let lastAt = Date.now();
    const loop = await organism.runAgentLoop({
      ...(options.model ? { model: options.model } : {}),
      ...(options.thinking ? { thinking: options.thinking } : {}),
      maxTurns: options.maxTurns ?? 12,
      onTurn: (turn) => {
        const now = Date.now();
        for (const event of turnEvents(turn, now - lastAt)) emit(event);
        lastAt = now;
      },
    });
    const ok = loop.turns.length > 0 && loop.done;
    await organism.end(ok ? "done" : "failed", loop.summary.slice(0, 500) || prompt.slice(0, 500));
    return { ok, summary: loop.summary.slice(0, 200) || "(no summary)" };
  } finally {
    client.close();
  }
}
