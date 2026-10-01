// Seed-runtime guardian client: NDJSON JSON-RPC 2.0 over a Unix socket.
//
// Purpose: the organism's only wire into the guardian — hello handshake,
// task begin/end, telemetry, artifacts, candidates, experiments, capability
// proposals, and model observations. Untrusted large payloads route through
// artifact refs instead of inline JSON.
// Why it exists: REQ-SEED-YM8XJREE needs the organism to open sessions,
// pin champions, and stream telemetry without ever touching guardian-only
// RPC (promotion/rollback/evict/override/destroy/db.query all throw here
// before hitting the wire).
// Responsibilities: socket framing (one JSON object per line), request id
// matching, hello shape validation, agent-method allowlist, 1MiB response
// guard with sha artifact refs for oversize payloads.
// Invariants: only AGENT_METHODS may be sent (anything else throws
// client-side); a response with the wrong jsonrpc version or an id mismatch
// throws instead of returning; lines over MAX_MESSAGE_BYTES close the
// connection; oversize result payloads become artifact refs.
// Public types/functions: GuardianHello, GuardianClientOptions,
// GuardianClient, AGENT_METHODS, MAX_MESSAGE_BYTES, connectGuardian,
// helloShape.

import { createConnection, type Socket } from "node:net";
import { createHash } from "node:crypto";

// trace:exempt reason=internal-detail
export const MAX_MESSAGE_BYTES = 1024 * 1024;

export const AGENT_METHODS = [
  "guardian.hello",
  "task.begin",
  "task.end",
  "telemetry.append",
  "artifact.register",
  "candidate.submit",
  "experiment.request",
  "capability.propose",
  "model.observed",
] as const;

export type AgentMethod = (typeof AGENT_METHODS)[number];

export interface GuardianHello {
  protocol_version: number;
  champion_sha: string;
  telemetry_schema_version: number;
  capability_schema_version: number;
  session_id: string;
}

export interface GuardianClientOptions {
  socketPath: string;
  connectTimeoutMs?: number;
}

// trace:exempt reason=internal-detail
interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

// trace:exempt reason=internal-detail
function isAgentMethod(method: string): method is AgentMethod {
  return AGENT_METHODS.some((allowed) => allowed === method);
}

// trace:v1 id=impl.rt-guardian-hello work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export function helloShape(value: unknown): GuardianHello {
  if (typeof value !== "object" || value === null) {
    throw new Error("guardian.hello returned a non-object result (protocol mismatch)");
  }
  const candidate: {
    protocol_version?: unknown;
    champion_sha?: unknown;
    telemetry_schema_version?: unknown;
    capability_schema_version?: unknown;
    session_id?: unknown;
  } = value;
  // trace:exempt reason=internal-detail
  if (
    candidate.protocol_version !== 1 ||
    typeof candidate.champion_sha !== "string" ||
    typeof candidate.telemetry_schema_version !== "number" ||
    typeof candidate.capability_schema_version !== "number" ||
    typeof candidate.session_id !== "string" ||
    candidate.session_id.length === 0
  ) {
    throw new Error("guardian.hello result misses protocol_version/champion_sha/telemetry_schema_version/capability_schema_version/session_id (protocol mismatch)");
  }
  return {
    protocol_version: candidate.protocol_version,
    champion_sha: candidate.champion_sha,
    telemetry_schema_version: candidate.telemetry_schema_version,
    capability_schema_version: candidate.capability_schema_version,
    session_id: candidate.session_id,
  };
}

// trace:v1 id=impl.rt-guardian-client work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export class GuardianClient {
  private readonly socket: Socket;
  private nextId = 1;
  private readonly pending = new Map<string | number, PendingCall>();
  private buffer = "";
  private closed: Error | null = null;

  // trace:exempt reason=internal-detail
  constructor(socket: Socket) {
    this.socket = socket;
    if (typeof socket.setEncoding === "function") socket.setEncoding("utf8");
    if (typeof socket.on === "function") {
      socket.on("data", (chunk: string) => this.onData(chunk));
      socket.on("error", (err: Error) => this.onClose(err));
      socket.on("close", () => this.onClose(new Error("guardian socket closed")));
    }
  }

  // trace:exempt reason=internal-detail
  call(method: AgentMethod, params?: unknown): Promise<unknown> {
    if (!isAgentMethod(method)) {
      return Promise.reject(new Error(`refusing guardian-only method: ${method}`));
    }
    if (this.closed) return Promise.reject(this.closed);
    const id = this.nextId++;
    // trace:exempt reason=internal-detail
    const line = JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? null });
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(`${line}\n`, (err) => {
        if (err) {
          this.pending.delete(id);
          // trace:exempt reason=internal-detail
          reject(err);
        }
      });
    });
  }

  // trace:v1 id=impl.rt-guardian-hello-call work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
  async hello(params?: { protocol_version?: number; organism_sha?: string; session_id?: string }): Promise<GuardianHello> {
    return helloShape(await this.call("guardian.hello", { protocol_version: 1, organism_sha: "", session_id: "", ...(params ?? {}) }));
  }

  // trace:exempt reason=internal-detail
  close(): void {
    this.onClose(new Error("client closed"));
    try {
      if (typeof this.socket.destroy === "function") this.socket.destroy();
    } catch { /* already closed */ }
  }

  // trace:exempt reason=internal-detail
  private failAll(err: Error): void {
    for (const [, pending] of this.pending) pending.reject(err);
    this.pending.clear();
  }

  // trace:exempt reason=internal-detail
  private onClose(err: Error): void {
    if (this.closed) return;
    this.closed = err;
    this.failAll(err);
  }

  // trace:exempt reason=internal-detail
  private onData(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.onLine(line);
      // trace:exempt reason=internal-detail
      if (this.closed) return;
      newline = this.buffer.indexOf("\n");
    }
  }

  // trace:exempt reason=internal-detail
  private onLine(line: string): void {
    if (line.length > MAX_MESSAGE_BYTES) {
      this.onClose(new Error(`guardian response exceeds 1MiB cap at ${line.length} bytes (register a sha artifact ref instead)`));
      try {
        this.socket.destroy();
      } catch { /* already closing */ }
      return;
    }
    // trace:exempt reason=internal-detail
    const trimmed = line.trim();
    if (trimmed === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      this.onClose(new Error("guardian sent non-JSON (protocol mismatch)"));
      return;
    }
    // trace:exempt reason=internal-detail
    if (typeof parsed !== "object" || parsed === null || !("jsonrpc" in parsed) || !("id" in parsed)) {
      this.onClose(new Error("guardian sent a non-object response (protocol mismatch)"));
      return;
    }
    const envelope: { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: unknown } = parsed;
    if (envelope.jsonrpc !== "2.0") {
      this.onClose(new Error(`guardian protocol mismatch: jsonrpc is ${JSON.stringify(envelope.jsonrpc)} (expected "2.0")`));
      return;
    }
    // trace:exempt reason=internal-detail
    const key = envelope.id;
    if ((typeof key !== "string" && typeof key !== "number") || !this.pending.has(key)) {
      this.onClose(new Error("guardian response id does not match any pending call (protocol mismatch)"));
      return;
    }
    const pending = this.pending.get(key);
    // trace:exempt reason=internal-detail
    if (!pending) return;
    this.pending.delete(key);
    if (envelope.error !== undefined && envelope.error !== null) {
      const failure: { message?: unknown } =
        typeof envelope.error === "object" && envelope.error !== null && "message" in envelope.error
          ? envelope.error
          : {};
      // trace:exempt reason=internal-detail
      const message = typeof failure.message === "string" ? failure.message : JSON.stringify(envelope.error);
      pending.reject(new Error(`guardian error: ${message}`));
      return;
    }
    let result = envelope.result;
    const serialized = JSON.stringify(result ?? null);
    // trace:exempt reason=internal-detail
    if (serialized.length > MAX_MESSAGE_BYTES) {
      const sha = createHash("sha256").update(serialized).digest("hex");
      result = { __artifact_ref: sha, bytes: serialized.length, hint: "payload exceeds 1MiB cap; fetch via artifact ref" };
    }
    pending.resolve(result);
  }
}

// trace:v1 id=impl.rt-guardian-connect work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export function connectGuardian(options: GuardianClientOptions): Promise<GuardianClient> {
  return new Promise<GuardianClient>((resolve, reject) => {
    const socket = createConnection(options.socketPath);
    const timer = setTimeout(() => {
      socket.destroy(new Error(`guardian connect timed out after ${options.connectTimeoutMs ?? 5000}ms`));
    }, options.connectTimeoutMs ?? 5000);
    socket.once("connect", () => {
      // trace:exempt reason=internal-detail
      clearTimeout(timer);
      resolve(new GuardianClient(socket));
    });
    socket.once("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
