// Seed-runtime python tool: the single confined organism primitive.
//
// Purpose: run task-agent Python snippets with cwd confinement, wall-clock
// timeouts, bounded output, and telemetry — the only code execution the
// task agent gets on Day 1 (builtin/python capability).
// Why it exists: REQ-SEED-YM8XJREE — one python primitive with cwd
// confinement, timeouts, truncation, and telemetry; everything else is a
// capability. Cwd escapes fail loudly; timeouts SIGKILL the tree.
// Responsibilities: resolve cwd inside the workspace, spawn
// `uv run python -` with stdin=code, seed SEED_* env, capture bounded
// stdout/stderr with middle truncation, time out via process-group SIGKILL,
// report a typed result.
// Invariants: cwd always resolves inside the workspace (a `..` escape is
// rejected with the budget+limit+requested message); timeout_ms defaults
// to 30000 and caps at 300000; stdout/stderr cap at 256KiB each with
// head+tail kept and truncated flags; exit_code is null on timeout;
// elapsed_ms always measures the real run.
// Public types/functions: PythonToolOptions, PythonToolResult,
// DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MAX_OUTPUT_BYTES, runPython.

import { spawn } from "node:child_process";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import type { TelemetrySink } from "./telemetry.ts";

// trace:exempt reason=internal-detail
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 300_000;
export const MAX_OUTPUT_BYTES = 256 * 1024;

export interface PythonToolOptions {
  code: string;
  timeout_ms?: number;
  cwd?: string;
  workspace?: string;
  sessionId?: string;
  scratchDir?: string;
  onTelemetry?: TelemetrySink;
  /**
   * Execution trust level. `restricted` (default) passes only the SEED_*
   * contract plus non-secret runtime lookups (PATH, HOME, XDG cache dirs,
   * tmp); `workspace` additionally inherits the caller's environment for
   * trusted local work. Model-driven turns always use `restricted` — harness
   * credentials must never reach model-generated code implicitly.
   */
  trust?: "restricted" | "workspace";
}

export interface PythonToolResult {
  stdout: string;
  stderr: string;
  stdout_truncated: boolean;
  stderr_truncated: boolean;
  exit_code: number | null;
  timed_out: boolean;
  elapsed_ms: number;
}

// trace:exempt reason=internal-detail
interface BoundedBuffer {
  head: Buffer[];
  tail: Buffer[];
  headBytes: number;
  tailBytes: number;
  totalBytes: number;
  truncated: boolean;
}

// trace:exempt reason=internal-detail
function newBoundedBuffer(): BoundedBuffer {
  return { head: [], tail: [], headBytes: 0, tailBytes: 0, totalBytes: 0, truncated: false };
}

// trace:exempt reason=internal-detail
function pushBounded(buf: BoundedBuffer, chunk: Buffer): void {
  buf.totalBytes += chunk.length;
  if (buf.headBytes < MAX_OUTPUT_BYTES / 2) {
    const room = MAX_OUTPUT_BYTES / 2 - buf.headBytes;
    buf.head.push(chunk.subarray(0, room));
    buf.headBytes += Math.min(room, chunk.length);
    // trace:exempt reason=internal-detail
    if (chunk.length > room) pushTail(buf, chunk.subarray(room));
  } else {
    pushTail(buf, chunk);
  }
}

// trace:exempt reason=internal-detail
function pushTail(buf: BoundedBuffer, chunk: Buffer): void {
  buf.tail.push(chunk);
  buf.tailBytes += chunk.length;
  let keepFrom = 0;
  let kept = 0;
  for (let i = buf.tail.length - 1; i >= 0; i -= 1) {
    kept += (buf.tail[i] as Buffer).length;
    // trace:exempt reason=internal-detail
    if (kept >= MAX_OUTPUT_BYTES / 2) break;
    keepFrom = i;
  }
  if (keepFrom > 0) {
    buf.tail.splice(0, keepFrom);
    buf.tailBytes = buf.tail.reduce((n, part) => n + (part as Buffer).length, 0);
    buf.truncated = true;
  } else if (buf.headBytes + buf.tailBytes > MAX_OUTPUT_BYTES) {
    buf.truncated = true;
  }
}

// trace:exempt reason=internal-detail
function renderBounded(buf: BoundedBuffer): { text: string; truncated: boolean } {
  const truncated = buf.truncated || buf.totalBytes > MAX_OUTPUT_BYTES;
  if (!truncated) return { text: Buffer.concat([...buf.head, ...buf.tail]).toString("utf8"), truncated: false };
  const headText = Buffer.concat(buf.head).toString("utf8");
  const tailText = Buffer.concat(buf.tail).toString("utf8");
  return {
    text: `${headText}\n…[truncated ${buf.totalBytes} bytes > ${MAX_OUTPUT_BYTES} byte limit]…\n${tailText}`,
    truncated: true,
  };
}

// trace:v1 id=impl.rt-python-cwd work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export function resolveToolCwd(requested: string | undefined, workspace: string): string {
  const base = resolve(workspace);
  const target = requested === undefined ? base : resolve(base, requested);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(
      `cwd escapes the workspace (budget: confined to workspace, limit: ${base}, requested: ${requested ?? "<default>"} resolves to ${target})`,
    );
  }
  return target;
}

// trace:v1 id=impl.rt-python-run work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export function runPython(options: PythonToolOptions): Promise<PythonToolResult> {
  const { code } = options;
  if (typeof code !== "string" || code.length === 0) {
    return Promise.reject(new Error("runPython needs a non-empty code string"));
  }
  const timeoutMs = options.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  // trace:exempt reason=internal-detail
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error(`timeout_ms must be a positive number (budget: timeout, limit: ${MAX_TIMEOUT_MS}, requested: ${String(options.timeout_ms)})`));
  }
  if (timeoutMs > MAX_TIMEOUT_MS) {
    return Promise.reject(
      new Error(`timeout_ms exceeds the cap (budget: timeout, limit: ${MAX_TIMEOUT_MS}, requested: ${timeoutMs})`),
    );
  }
  // trace:exempt reason=internal-detail
  const workspace = resolve(options.workspace ?? process.cwd());
  let cwd: string;
  try {
    cwd = resolveToolCwd(options.cwd, workspace);
  } catch (err) {
    return Promise.reject(err);
  }
  // trace:exempt reason=internal-detail
  const startedAt = Date.now();
  const sessionId = options.sessionId ?? process.env.SEED_SESSION_ID ?? "";
  const scratchDir = options.scratchDir ?? process.env.SEED_SCRATCH ?? "";

  return new Promise<PythonToolResult>((runResolve) => {
    // trace:v1 id=impl.rt-python-env work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
    const trust = options.trust ?? "restricted";
    // --no-project --no-sync keeps an ambient repo checkout with a
    // half-landed pyproject from hijacking the interpreter.
    // Restricted is the model-facing default: the SEED_* contract plus the
    // non-secret runtime lookups an interpreter needs (PATH, HOME, XDG cache
    // dirs, TMPDIR) copied only when present. Everything else — notably
    // OPENROUTER_API_KEY and other harness secrets — stays out.
    const PASSTHROUGH_ENV = ["PATH", "HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "TMPDIR", "TEMP", "TMP"];
    const restrictedEnv = (): Record<string, string | undefined> => {
      const env: Record<string, string | undefined> = {
        SEED_SCRATCH: scratchDir,
        SEED_SESSION_ID: sessionId,
        SEED_WORKSPACE: workspace,
      };
      for (const key of PASSTHROUGH_ENV) {
        const value = process.env[key];
        if (value !== undefined) env[key] = value;
      }
      return env;
    };
    const childEnv: Record<string, string | undefined> =
      trust === "workspace"
        ? { ...process.env, SEED_SCRATCH: scratchDir, SEED_SESSION_ID: sessionId, SEED_WORKSPACE: workspace }
        : restrictedEnv();
    const child = spawn("uv", ["run", "--no-project", "--no-sync", "python", "-"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv,
      detached: true,
    });
    // trace:exempt reason=internal-detail
    const stdoutBuf = newBoundedBuffer();
    const stderrBuf = newBoundedBuffer();
    let settled = false;
    let timedOut = false;

    // trace:exempt reason=internal-detail
    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdout = renderBounded(stdoutBuf);
      const stderr = renderBounded(stderrBuf);
      const result: PythonToolResult = {
        stdout: stdout.text,
        stderr: stderr.text,
        stdout_truncated: stdout.truncated,
        stderr_truncated: stderr.truncated,
        exit_code: timedOut ? null : exitCode,
        timed_out: timedOut,
        elapsed_ms: Date.now() - startedAt,
      };
      // trace:exempt reason=internal-detail
      const sink = options.onTelemetry;
      if (sink) {
        sink({
          type: "tool.call",
          timestamp: new Date().toISOString(),
          session: sessionId,
          payload: {
            tool: "python",
            ok: !timedOut && exitCode === 0,
            elapsedMs: result.elapsed_ms,
            outputBytes: Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr),
            truncated: result.stdout_truncated || result.stderr_truncated,
            argsHash: createHash("sha256").update(code).digest("hex").slice(0, 16),
          },
        });
      }
      // trace:exempt reason=internal-detail
      runResolve(result);
    };

    // trace:exempt reason=internal-detail
    const killTree = (): void => {
      timedOut = true;
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch { /* group kill may fail after exit; fall through to direct kill */ }
      try {
        child.kill("SIGKILL");
      } catch { /* already exited */ }
    };
    // trace:exempt reason=internal-detail
    const timer = setTimeout(killTree, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => pushBounded(stdoutBuf, chunk));
    child.stderr?.on("data", (chunk: Buffer) => pushBounded(stderrBuf, chunk));
    child.on("error", () => finish(null));
    child.on("exit", (code) => finish(code));
    child.on("close", (code) => finish(code));
    try {
      child.stdin?.write(code);
      child.stdin?.end();
    } catch {
      // trace:exempt reason=internal-detail
      killTree();
    }
  });
}
