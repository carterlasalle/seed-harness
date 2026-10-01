// Seed-runtime capability host: JSONL-stdio process ABI over child processes.
//
// Purpose: run process-kind capabilities (e.g. the echo fixture) as
// isolated child processes speaking one-JSON-object-per-line each way.
// Why it exists: REQ-SEED-AJZXZFBN moves execution here on Day 1 while the
// registry contract stays in seed-core; the host owns the stdio framing,
// per-call timeouts, output caps, and kill-on-violation behavior.
// Responsibilities: spawn entrypoint, frame invoke/result/error lines per
// spec section 25, enforce timeout/output-limit/malformed/unexpected-exit
// kills, match ids to pending calls.
// Invariants: ids are unique per host; a timeout kills the child and fails
// every pending call; malformed or unexpected-exit output kills the child;
// output over maxOutputBytes kills the child instead of buffering forever.
// Public types/functions: CapabilityInvokeOptions, CapabilityHostOptions,
// CapabilityHost, CapabilityTimer, startCapabilityHost.

import { spawn, type ChildProcess } from "node:child_process";

export interface CapabilityInvokeOptions {
  method: string;
  params?: unknown;
  timeoutMs?: number;
}

export interface CapabilityHostOptions {
  command: string;
  args?: string[];
  cwd?: string;
  maxOutputBytes?: number;
  defaultTimeoutMs?: number;
  env?: Record<string, string>;
}

export type CapabilityTimer = ReturnType<typeof setTimeout>;

// trace:exempt reason=internal-detail
interface PendingInvoke {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: CapabilityTimer;
}

// trace:exempt reason=internal-detail
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

// trace:v1 id=impl.rt-capability-host work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export class CapabilityHost {
  private readonly child: ChildProcess;
  private readonly options: CapabilityHostOptions;
  private nextId = 1;
  private readonly pending = new Map<number, PendingInvoke>();
  private buffer = "";
  private outputBytes = 0;
  private dead: Error | null = null;

  // trace:exempt reason=internal-detail
  constructor(child: ChildProcess, options: CapabilityHostOptions) {
    this.child = child;
    this.options = options;
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.onData(chunk));
    child.on("error", (err: Error) => this.kill(new Error(`capability process error: ${err.message}`)));
    child.on("exit", (code, signal) => {
      this.kill(new Error(`capability exited unexpectedly (code=${String(code)} signal=${String(signal)})`));
    });
  }

  // trace:exempt reason=internal-detail
  get pid(): number | undefined {
    return this.child.pid;
  }

  // trace:exempt reason=internal-detail
  invoke(options: CapabilityInvokeOptions): Promise<unknown> {
    if (this.dead) return Promise.reject(this.dead);
    const id = this.nextId++;
    const timeoutMs = options.timeoutMs ?? this.options.defaultTimeoutMs ?? 5000;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.kill(new Error(`capability call "${options.method}" timed out after ${timeoutMs}ms`));
        // trace:exempt reason=internal-detail
        reject(new Error(`capability call "${options.method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child.stdin?.write(`${JSON.stringify({ id, method: options.method, params: options.params ?? null })}\n`);
      } catch (err) {
        // trace:exempt reason=internal-detail
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // trace:exempt reason=internal-detail
  stop(): void {
    this.kill(new Error("capability host stopped"));
    try {
      this.child.kill("SIGKILL");
    } catch { /* already dead */ }
  }

  // trace:exempt reason=internal-detail
  private kill(err: Error): void {
    if (this.dead) return;
    this.dead = err;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  // trace:exempt reason=internal-detail
  private onData(chunk: string): void {
    if (this.dead) return;
    this.outputBytes += Buffer.byteLength(chunk);
    const cap = this.options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (this.outputBytes > cap) {
      try {
        this.child.kill("SIGKILL");
      } catch { /* already dead */ }
      this.kill(new Error(`capability exceeded output limit of ${cap} bytes`));
      return;
    }
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    // trace:exempt reason=internal-detail
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line !== "") this.onLine(line);
      if (this.dead) return;
      newline = this.buffer.indexOf("\n");
    }
  }

  // trace:exempt reason=internal-detail
  private onLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      try {
        this.child.kill("SIGKILL");
      } catch { /* already dead */ }
      this.kill(new Error(`capability sent malformed JSON: ${line.slice(0, 120)}`));
      return;
    }
    // trace:exempt reason=internal-detail
    if (typeof parsed !== "object" || parsed === null || !("id" in parsed)) {
      try {
        this.child.kill("SIGKILL");
      } catch { /* already dead */ }
      this.kill(new Error("capability sent a response without an id"));
      return;
    }
    const response: { id?: unknown; result?: unknown; error?: unknown } = parsed;
    // trace:exempt reason=internal-detail
    const key = typeof response.id === "number" || typeof response.id === "string" ? response.id : null;
    const pending = key === null ? undefined : this.pending.get(Number(key));
    if (key === null || !pending) {
      try {
        this.child.kill("SIGKILL");
      } catch { /* already dead */ }
      this.kill(new Error("capability sent a response for an unknown id"));
      return;
    }
    this.pending.delete(Number(key));
    // trace:exempt reason=internal-detail
    clearTimeout(pending.timer);
    if (response.error !== undefined && response.error !== null) {
      pending.reject(new Error(typeof response.error === "string" ? response.error : JSON.stringify(response.error)));
      return;
    }
    pending.resolve(response.result);
  }
}

// trace:v1 id=impl.rt-capability-start work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export function startCapabilityHost(options: CapabilityHostOptions): CapabilityHost {
  const child = spawn(options.command, options.args ?? [], {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "inherit"],
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });
  return new CapabilityHost(child, options);
}
