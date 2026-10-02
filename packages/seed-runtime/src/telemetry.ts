// Seed-runtime telemetry: organism-side event and task record shapes.
//
// Purpose: the organism's view of telemetry (tool calls, task lifecycle)
// that it streams to the guardian via telemetry.append and task events.
// Why it exists: REQ-SEED-YM8XJREE needs typed telemetry out of the python
// primitive and the organism loop, matching schemas/event.schema.json.
// Responsibilities: ToolCallTelemetry + TaskTelemetry shapes, evidence
// levels, task lifecycle helpers, JSON-RPC-ready event envelopes.
// Invariants: TaskTelemetry.oracleAccuracy defaults to null (unknown until
// an oracle scores it); every envelope carries type/timestamp/session;
// timestamps are ISO-8601. No I/O here — transport lives in guardian-client.
// Public types/functions: EvidenceLevel, SeedEvent, ToolCallTelemetry,
// TaskTelemetry, TaskStatus, TelemetrySink, createTaskTelemetry,
// recordToolCall, finishTask, toEvent, toolCallEvent.

// trace:v1 id=impl.rt-evidence-levels work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export type EvidenceLevel = "guardian" | "external-oracle" | "provider" | "organism" | "model-judged";

// trace:exempt reason=internal-detail
export interface SeedEvent {
  type: string;
  timestamp: string;
  session: string;
  task_id?: string;
  payload?: Record<string, unknown>;
  candidate?: string;
}

// trace:exempt reason=internal-detail
export interface ToolCallTelemetry {
  tool: string;
  session: string;
  taskId: string;
  ok: boolean;
  elapsedMs: number;
  outputBytes: number;
  truncated: boolean;
  evidence: EvidenceLevel;
  timestamp: string;
}

// trace:exempt reason=internal-detail
export type TaskStatus = "running" | "done" | "failed" | "budget";

// trace:exempt reason=internal-detail
export interface TaskTelemetry {
  taskId: string;
  session: string;
  championRef: string;
  status: TaskStatus;
  startedAt: string;
  endedAt: string | null;
  toolCalls: ToolCallTelemetry[];
  oracleAccuracy: number | null;
}

// trace:exempt reason=internal-detail
export type TelemetrySink = (event: SeedEvent) => void;

// trace:v1 id=impl.rt-telemetry-task work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export function createTaskTelemetry(init: {
  taskId: string;
  session: string;
  championRef?: string;
  startedAt?: string;
}): TaskTelemetry {
  return {
    taskId: init.taskId,
    session: init.session,
    championRef: init.championRef ?? "",
    status: "running",
    startedAt: init.startedAt ?? new Date().toISOString(),
    endedAt: null,
    toolCalls: [],
    oracleAccuracy: null,
  };
}

// trace:v1 id=impl.rt-telemetry-record work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export function recordToolCall(task: TaskTelemetry, call: ToolCallTelemetry): void {
  task.toolCalls.push(call);
}

// trace:v1 id=impl.rt-telemetry-finish work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export function finishTask(
  task: TaskTelemetry,
  status: Exclude<TaskStatus, "running">,
  endedAt?: string,
): void {
  task.status = status;
  task.endedAt = endedAt ?? new Date().toISOString();
}

// trace:v1 id=impl.rt-telemetry-event work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export function toEvent(
  task: TaskTelemetry,
  type: string,
  payload?: Record<string, unknown>,
): SeedEvent {
  return {
    type,
    timestamp: new Date().toISOString(),
    session: task.session,
    task_id: task.taskId,
    payload: payload ?? {
      status: task.status,
      toolCalls: task.toolCalls.length,
      oracleAccuracy: task.oracleAccuracy,
    },
  };
}

// trace:v1 id=impl.rt-telemetry-tool-event work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export function toolCallEvent(call: ToolCallTelemetry): SeedEvent {
  return {
    type: "tool.call",
    timestamp: call.timestamp,
    session: call.session,
    task_id: call.taskId,
    payload: {
      tool: call.tool,
      ok: call.ok,
      elapsedMs: call.elapsedMs,
      outputBytes: call.outputBytes,
      truncated: call.truncated,
      evidence: call.evidence,
    },
  };
}
