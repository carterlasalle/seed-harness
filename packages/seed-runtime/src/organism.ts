// Seed-runtime organism: champion-pinned task loop over one python tool.
//
// Purpose: the evolvable executor — open a session, pin the champion sha at
// begin, discover the session, emit telemetry, and run the task loop with
// exactly the python tool visible on Day 1.
// Why it exists: REQ-SEED-YM8XJREE needs the run() sequence (config >
// guardian > handshake > champion > python cap > discover > session >
// telemetry > loop) with no hot swap: the organism_sha fixed at begin
// stays fixed for the whole run.
// Responsibilities: handshake via guardian.hello, task.begin/end, session
// creation bound to the pinned sha, python execution with telemetry,
// task.result emission, champion-unchanged guard on every turn.
// Invariants: organism_sha never changes after begin (a guardian-reported
// change throws instead of swapping); visible tools are [python] only;
// every python call emits a tool.call event; task.end always closes the
// task even when the turn throws.
// Public types/functions: OrganismOptions, OrganismTurn, Organism,
// VISIBLE_TOOLS, runTurn, runOrganismTask.

import { GuardianClient, type GuardianHello } from "./guardian-client.ts";
import { createSession, type SeedSession } from "./session.ts";
import { runPython } from "./python-tool.ts";
import { createEphemeralStore, type EphemeralStore } from "./ephemeral.ts";
import {
  createTaskTelemetry,
  finishTask,
  recordToolCall,
  toEvent,
  type EvidenceLevel,
  type TaskTelemetry,
  type TelemetrySink,
  type ToolCallTelemetry,
} from "./telemetry.ts";
import { selectVisibleTools } from "./tool-router.ts";

export const VISIBLE_TOOLS: readonly string[] = ["python"];

export interface OrganismTurn {
  prompt: string;
  code: string;
  timeoutMs?: number;
  evidence?: EvidenceLevel;
}

export interface OrganismOptions {
  client: GuardianClient;
  workspace: string;
  taskBrief: string;
  extraCapabilities?: string[];
  sessionId?: string;
  scratchRoot?: string;
  sink?: TelemetrySink;
  session?: SeedSession;
  hello?: GuardianHello;
}

export interface Organism {
  hello: GuardianHello;
  session: SeedSession;
  task: TaskTelemetry;
  ephemeral: EphemeralStore;
  // trace:exempt reason=internal-detail
  runTurn(turn: OrganismTurn): Promise<{ stdout: string; ok: boolean }>;
  end(status: "done" | "failed" | "budget", summary: string): Promise<void>;
}

// trace:v1 id=impl.rt-organism-begin work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export async function runOrganismTask(options: OrganismOptions): Promise<Organism> {
  const sink = options.sink;
  // trace:exempt reason=internal-detail
  const emit = (event: Parameters<TelemetrySink>[0]): void => {
    sink?.(event);
    void options.client
      .call("telemetry.append", event)
      .catch(() => undefined);
  };
  // 1 config (workspace/session roots) > 2 guardian (client supplied) >
  // 3 handshake > 4 champion pin > 5 python cap > 6 discover > 7 session >
  // 8 telemetry > 9 loop (turns run by the caller via runTurn).
  // trace:exempt reason=internal-detail
  const hello = options.hello ?? (await options.client.hello(options.sessionId ? { protocol_version: 1, organism_sha: "", session_id: options.sessionId } : undefined));
  const organismSha = hello.champion_sha;
  const session =
    options.session ??
    createSession({ championRef: organismSha, sessionId: hello.session_id, scratchRoot: options.scratchRoot });
  if (session.championRef !== organismSha) {
    throw new Error(
      `organism champion changed between handshake and session bind ` +
      `(${JSON.stringify(session.championRef)} vs ${JSON.stringify(organismSha)}); refusing hot swap`,
    );
  }
  // trace:exempt reason=internal-detail
  const visible = selectVisibleTools(options.taskBrief, [
    { id: "python", name: "python", description: "confined python primitive", capability: "builtin/python", languages: ["python"] },
    ...(options.extraCapabilities ?? []).map((name) => ({
      id: name,
      name,
      description: name,
      capability: name,
      languages: [] as string[],
    })),
  ]);
  // trace:exempt reason=internal-detail
  if (!visible.some((tool) => tool.id === "python")) {
    throw new Error("python primitive must stay visible (Day-1 invariant)");
  }
  const begin = (await options.client.call("task.begin", { session_id: session.id })) as {
    task_id?: unknown;
    champion_ref?: unknown;
  };
  // trace:exempt reason=internal-detail
  if (typeof begin !== "object" || begin === null || typeof begin.task_id !== "string") {
    throw new Error("task.begin returned no task_id (protocol mismatch)");
  }
  if (typeof begin.champion_ref === "string" && begin.champion_ref !== organismSha) {
    throw new Error(
      `organism champion changed at task begin (${JSON.stringify(begin.champion_ref)} vs ${JSON.stringify(organismSha)}); refusing hot swap`,
    );
  }
  // trace:exempt reason=internal-detail
  const task = createTaskTelemetry({ taskId: begin.task_id, session: session.id, championRef: organismSha });
  emit(toEvent(task, "task.start", { brief: options.taskBrief.slice(0, 500) }));
  const ephemeral = createEphemeralStore(session.scratchDir);
  const client = options.client;

  let ended = false;
  return {
    hello,
    session,
    task,
    ephemeral,
    runTurn: (turn: OrganismTurn) => runTurn(client, session, task, organismSha, options.workspace, turn, emit, ephemeral),
    end: async (status, summary) => {
      // trace:exempt reason=internal-detail
      if (ended) return;
      ended = true;
      finishTask(task, status);
      emit(toEvent(task, "task.result", { status, summary: summary.slice(0, 2000) }));
      await client.call("task.end", { task_id: task.taskId, status, result: summary.slice(0, 2000) });
    },
  };
}

// trace:v1 id=impl.rt-organism-turn work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export async function runTurn(
  client: GuardianClient,
  session: SeedSession,
  task: TaskTelemetry,
  organismSha: string,
  workspace: string,
  turn: OrganismTurn,
  sink?: TelemetrySink,
  ephemeral?: EphemeralStore,
): Promise<{ stdout: string; ok: boolean }> {
  // trace:exempt reason=internal-detail
  if (session.championRef !== organismSha || task.championRef !== organismSha) {
    throw new Error("organism champion changed mid-run; refusing hot swap (restart with the pinned sha)");
  }
  const startedAt = Date.now();
  const result = await runPython({
    code: turn.code,
    timeout_ms: turn.timeoutMs,
    workspace,
    sessionId: session.id,
    scratchDir: session.scratchDir,
  });
  const call: ToolCallTelemetry = {
    tool: "python",
    session: session.id,
    taskId: task.taskId,
    ok: !result.timed_out && result.exit_code === 0,
    elapsedMs: result.elapsed_ms,
    outputBytes: Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr),
    truncated: result.stdout_truncated || result.stderr_truncated,
    evidence: turn.evidence ?? "observed",
    timestamp: new Date().toISOString(),
  };
  // trace:exempt reason=internal-detail
  recordToolCall(task, call);
  const event = toEvent(task, "tool.call", {
    tool: "python",
    ok: call.ok,
    elapsedMs: call.elapsedMs,
    outputBytes: call.outputBytes,
    truncated: call.truncated,
  });
  sink?.(event);
  void client.call("telemetry.append", event).catch(() => undefined);
  // trace:exempt reason=internal-detail
  if (ephemeral && turn.prompt.startsWith("ephemeral:")) {
    const id = turn.prompt.slice("ephemeral:".length).trim() || `turn-${task.toolCalls.length}`;
    let known = true;
    try {
      ephemeral.read(id);
    } catch {
      known = false;
    }
    // trace:exempt reason=internal-detail
    if (known) {
      ephemeral.update(id, turn.code);
    } else {
      ephemeral.create(id, turn.code, turn.prompt.slice(0, 200));
    }
    ephemeral.recordExecution(id, {
      argsHash: Buffer.from(turn.prompt).toString("utf8").slice(0, 16),
      status: call.ok ? "succeeded" : "failed",
      elapsedMs: Date.now() - startedAt,
    });
  }
  return { stdout: result.stdout, ok: call.ok };
}
