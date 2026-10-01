/**
 * seed-core capability registry: discovery, activation, process lifecycle.
 *
 * Purpose: find capability packages on disk, decide which are active for a
 * task context, and run process-backed capabilities over the JSONL stdio ABI
 * (spec section 25).
 * Why it exists: capability packages are executable, so their lifecycle is a
 * trust boundary: manifests are validated (manifest.ts), permissions are
 * allowlist-checked, entrypoints are confined to the package directory, and
 * process starts are gated on a JSONL hello.
 * Responsibilities: recursive `capability.json` discovery with stable
 * id+version ordering; activation filtering by default/tags/languages/repos/
 * models; permission enforcement and process spawn/stop; session-safe reloads.
 * Invariants: discovery never follows symlinked directories and records every
 * invalid manifest instead of failing the whole scan; spawned capabilities
 * inherit only PATH/HOME/LANG/TMPDIR and run with cwd at the package root;
 * process starts are gated on a JSONL hello (an unknown-method answer still
 * proves the ABI is live; a timeout or dead channel fails the start);
 * reload refuses while any session is active; every public function returns
 * deterministically ordered results.
 * Public: discoverCapabilities, resolveCapabilitySet, startCapability,
 * stopCapability, reloadCapabilitySet, CapabilityDiscovery, StartedCapability,
 * CapabilityPermissionError, CapabilityStartError, CapabilityReloadError.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { join, resolve, sep } from "node:path";
import {
  CAPABILITY_ABI,
  parseCapabilityManifest,
  // trace:exempt reason=internal-detail
  type CapabilityManifest,
  // trace:exempt reason=internal-detail
  type CapabilityPermission,
} from "./manifest.ts";

// trace:exempt reason=internal-detail
export interface SkippedCapability {
  path: string;
  error: string;
}

// trace:exempt reason=internal-detail
export interface DiscoveredCapability {
  id: string;
  version: string;
  dir: string;
  manifest: CapabilityManifest;
}

// trace:exempt reason=internal-detail
export interface CapabilityDiscovery {
  capabilities: DiscoveredCapability[];
  skipped: SkippedCapability[];
}

// trace:exempt reason=internal-detail
export interface ActivationContext {
  tags?: readonly string[];
  language?: string;
  repo?: string;
  model?: string;
}

// trace:exempt reason=internal-detail
export interface CapabilityStartOptions {
  dir: string;
  grantedPermissions?: readonly CapabilityPermission[];
}

// trace:exempt reason=internal-detail
export interface StartedCapability {
  readonly manifest: CapabilityManifest;
  readonly dir: string;
  readonly pid: number | null;
  readonly hello: string | null;
  // trace:exempt reason=internal-detail
  request(method: string, params?: unknown): Promise<unknown>;
  // trace:exempt reason=internal-detail
  stop(): Promise<void>;
}

// trace:exempt reason=internal-detail
export interface ReloadOptions {
  activeSessions: number;
  grantedPermissions?: readonly CapabilityPermission[];
}

// trace:exempt reason=internal-detail
export interface ReloadResult {
  started: string[];
  stopped: string[];
  kept: string[];
  handles: StartedCapability[];
}

// trace:v1 id=impl.sc-capabilities-permission-error work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export class CapabilityPermissionError extends Error {
  readonly capability: string;
  readonly missing: readonly CapabilityPermission[];

  // trace:exempt reason=internal-detail
  constructor(capability: string, missing: readonly CapabilityPermission[]) {
    super(`capability "${capability}" requires ungranted permissions: ${missing.join(", ")}`);
    this.name = "CapabilityPermissionError";
    this.capability = capability;
    this.missing = missing;
  }
}

// trace:v1 id=impl.sc-capabilities-start-error work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export class CapabilityStartError extends Error {
  // trace:exempt reason=internal-detail
  constructor(message: string) {
    super(message);
    this.name = "CapabilityStartError";
  }
}

// trace:v1 id=impl.sc-capabilities-reload-error work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export class CapabilityReloadError extends Error {
  // trace:exempt reason=internal-detail
  constructor(message: string) {
    super(message);
    this.name = "CapabilityReloadError";
  }
}

// trace:exempt reason=internal-detail
const STDERR_TAIL_LIMIT = 4096;
// trace:exempt reason=internal-detail
const STOP_GRACE_MS = 2000;
// trace:exempt reason=internal-detail
const ENV_PASSTHROUGH = ["PATH", "HOME", "LANG", "TMPDIR"];

// trace:exempt reason=internal-detail
function capabilityKey(id: string, version: string): string {
  return `${id}@${version}`;
}

// trace:exempt reason=internal-detail
function compareVersions(a: string, b: string): number {
  // trace:exempt reason=unit-test
  const left = a.split(".").map((part) => Number(part));
  // trace:exempt reason=unit-test
  const right = b.split(".").map((part) => Number(part));
  for (let index = 0; index < 3; index += 1) {
    // trace:exempt reason=internal-detail
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

// trace:exempt reason=internal-detail
function compareDiscovered(a: DiscoveredCapability, b: DiscoveredCapability): number {
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  // trace:exempt reason=internal-detail
  const version = compareVersions(a.version, b.version);
  if (version !== 0) return version;
  if (a.dir === b.dir) return 0;
  return a.dir < b.dir ? -1 : 1;
}

// trace:v1 id=impl.sc-capabilities-discover work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export function discoverCapabilities(rootDir: string): CapabilityDiscovery {
  const capabilities: DiscoveredCapability[] = [];
  const skipped: SkippedCapability[] = [];

  // trace:exempt reason=internal-detail
  const visit = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      skipped.push({ path: dir, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    // trace:exempt reason=internal-detail
    for (const entry of entries) {
      // trace:exempt reason=internal-detail
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        // trace:exempt reason=unit-test
        visit(full);
        continue;
      }
      if (!entry.isFile() || entry.name !== "capability.json") continue;
      try {
        // trace:exempt reason=internal-detail
        const raw = JSON.parse(readFileSync(full, "utf8")) as unknown;
        // trace:exempt reason=internal-detail
        const manifest = parseCapabilityManifest(raw);
        capabilities.push({ id: manifest.id, version: manifest.version, dir, manifest });
      } catch (error) {
        skipped.push({ path: full, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };

  // trace:exempt reason=unit-test
  visit(resolve(rootDir));
  capabilities.sort(compareDiscovered);
  skipped.sort((a, b) => (a.path === b.path ? 0 : a.path < b.path ? -1 : 1));
  return { capabilities, skipped };
}

// trace:v1 id=impl.sc-capabilities-resolve work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export function resolveCapabilitySet(
  capabilities: readonly DiscoveredCapability[],
  context: ActivationContext,
): DiscoveredCapability[] {
  const tags = context.tags ?? [];
  const active = capabilities.filter((capability) => {
    // trace:exempt reason=internal-detail
    const activation = capability.manifest.activation;
    if (activation.default) return true;
    if (tags.some((tag) => activation.tags.includes(tag))) return true;
    if (context.language !== undefined && activation.languages.includes(context.language)) return true;
    if (context.repo !== undefined && activation.repos.includes(context.repo)) return true;
    if (context.model !== undefined && activation.models.includes(context.model)) return true;
    return false;
  });
  return active.sort(compareDiscovered);
}

// trace:exempt reason=internal-detail
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Line-delimited JSON request/response channel over a child process. One
 * request line `{"id","method","params"}` out, matching `{"id","result"|}`
 * `{"id","error"}` line back; unmatched lines are treated as diagnostics.
 */
// trace:exempt reason=internal-detail
class JsonlChannel {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private buffer = "";
  private stderrTail = "";
  private closed: Error | null = null;

  // trace:exempt reason=internal-detail
  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => this.consume(chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_LIMIT);
    });
    child.on("exit", (code, signal) => {
      this.close(new CapabilityStartError(this.exitMessage(code, signal)));
    });
    child.on("error", (error) => {
      this.close(new CapabilityStartError(`capability process error: ${error.message}`));
    });
  }

  // trace:exempt reason=internal-detail
  private exitMessage(code: number | null, signal: NodeJS.Signals | null): string {
    // trace:exempt reason=internal-detail
    const tail = this.stderrTail.trim() === "" ? "" : `: ${this.stderrTail.trim()}`;
    return `capability process exited (code=${code ?? "null"}, signal=${signal ?? "null"})${tail}`;
  }

  // trace:exempt reason=internal-detail
  private close(error: Error): void {
    this.closed = error;
    for (const [id, request] of this.pending) {
      // trace:exempt reason=internal-detail
      clearTimeout(request.timer);
      request.reject(error);
      this.pending.delete(id);
    }
  }

  // trace:exempt reason=internal-detail
  private consume(chunk: string): void {
    this.buffer += chunk;
    // trace:exempt reason=internal-detail
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      // trace:exempt reason=internal-detail
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line !== "") this.dispatch(line);
      index = this.buffer.indexOf("\n");
    }
  }

  // trace:exempt reason=internal-detail
  private dispatch(line: string): void {
    // trace:exempt reason=internal-detail
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    // trace:exempt reason=internal-detail
    if (typeof message !== "object" || message === null || Array.isArray(message)) return;
    // trace:exempt reason=internal-detail
    const record = message as Record<string, unknown>;
    // trace:exempt reason=internal-detail
    const id = record["id"];
    if (typeof id !== "number") return;
    // trace:exempt reason=internal-detail
    const request = this.pending.get(id);
    if (request === undefined) return;
    this.pending.delete(id);
    // trace:exempt reason=internal-detail
    clearTimeout(request.timer);
    if (record["error"] !== undefined) {
      request.reject(new CapabilityStartError(`capability request failed: ${JSON.stringify(record["error"])}`));
      return;
    }
    request.resolve(record["result"]);
  }

  // trace:exempt reason=internal-detail
  request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.closed !== null) return Promise.reject(this.closed);
    // trace:exempt reason=internal-detail
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<unknown>((resolvePromise, rejectPromise) => {
      // trace:exempt reason=internal-detail
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // trace:exempt reason=internal-detail
        rejectPromise(new CapabilityStartError(`capability request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  // trace:exempt reason=internal-detail
  async hello(timeoutMs: number): Promise<string> {
    try {
      await this.request("hello", { abi: CAPABILITY_ABI }, timeoutMs);
      return "hello acknowledged";
    } catch (error) {
      // trace:exempt reason=internal-detail
      const message = error instanceof Error ? error.message : String(error);
      if (/unknown method|method not found|unsupported/i.test(message)) {
        return `hello not implemented (${message})`;
      }
      throw error;
    }
  }
}

// trace:exempt reason=internal-detail
function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise<void>((resolvePromise) => {
    // trace:exempt reason=internal-detail
    const finish = (): void => {
      // trace:exempt reason=internal-detail
      clearTimeout(timer);
      // trace:exempt reason=internal-detail
      resolvePromise();
    };
    // trace:exempt reason=internal-detail
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      // trace:exempt reason=internal-detail
      setTimeout(finish, STOP_GRACE_MS);
    }, STOP_GRACE_MS);
    child.once("close", finish);
    child.once("error", finish);
    child.kill("SIGTERM");
  });
}

// trace:exempt reason=internal-detail
function spawnCapability(manifest: CapabilityManifest, dir: string): ChildProcessWithoutNullStreams {
  // trace:exempt reason=internal-detail
  const base = manifest.path === "" ? dir : resolve(dir, manifest.path);
  // trace:exempt reason=internal-detail
  const entrypoint = resolve(base, manifest.entrypoint);
  // trace:exempt reason=internal-detail
  const contained = entrypoint === base || entrypoint.startsWith(`${base}${sep}`);
  if (!contained) {
    throw new CapabilityStartError(`entrypoint escapes the capability directory: ${manifest.entrypoint}`);
  }
  try {
    if (!statSync(entrypoint).isFile()) {
      throw new CapabilityStartError(`entrypoint is not a file: ${entrypoint}`);
    }
  } catch (error) {
    // trace:exempt reason=internal-detail
    if (error instanceof CapabilityStartError) throw error;
    throw new CapabilityStartError(`entrypoint not found: ${entrypoint}`);
  }
  // trace:exempt reason=internal-detail
  const env: Record<string, string> = {};
  for (const key of ENV_PASSTHROUGH) {
    // trace:exempt reason=internal-detail
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  // trace:exempt reason=internal-detail
  const options = { cwd: base, env };
  if (entrypoint.endsWith(".py")) return spawn("python3", [entrypoint], options);
  if (/\.(c|m)?js$/.test(entrypoint)) return spawn(process.execPath, [entrypoint], options);
  return spawn(entrypoint, [], options);
}

// trace:v1 id=impl.sc-capabilities-start work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export async function startCapability(
  manifest: CapabilityManifest,
  options: CapabilityStartOptions,
): Promise<StartedCapability> {
  const granted = options.grantedPermissions ?? [];
  const missing = manifest.permissions.filter((permission) => !granted.includes(permission));
  // trace:exempt reason=internal-detail
  if (missing.length > 0) throw new CapabilityPermissionError(manifest.id, missing);

  if (manifest.runtime === "python") {
    return {
      manifest,
      dir: options.dir,
      pid: null,
      hello: null,
      request: () =>
        Promise.reject(
          new CapabilityStartError(
            `"${manifest.id}" is a python capability: execute it through the python primitive`,
          ),
        ),
      stop: () => Promise.resolve(),
    };
  }

  // ponytail: mcp runtime reuses the jsonl-stdio envelope for now; swap to an
  // MCP initialize handshake when an actual mcp capability package lands.
  // trace:exempt reason=internal-detail
  const child = spawnCapability(manifest, options.dir);
  // trace:exempt reason=internal-detail
  const channel = new JsonlChannel(child);
  // trace:exempt reason=internal-detail
  let hello: string;
  try {
    hello = await channel.hello(manifest.limits.timeoutMs);
  } catch (error) {
    await stopChild(child);
    if (error instanceof CapabilityStartError) throw error;
    throw new CapabilityStartError(String(error));
  }
  return {
    manifest,
    dir: options.dir,
    pid: child.pid ?? null,
    hello,
    request: (method, params) => channel.request(method, params, manifest.limits.timeoutMs),
    stop: () => stopChild(child),
  };
}

// trace:v1 id=impl.sc-capabilities-stop work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export async function stopCapability(handle: StartedCapability): Promise<void> {
  await handle.stop();
}

// trace:v1 id=impl.sc-capabilities-reload work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export async function reloadCapabilitySet(
  current: readonly StartedCapability[],
  next: readonly DiscoveredCapability[],
  options: ReloadOptions,
): Promise<ReloadResult> {
  if (options.activeSessions > 0) {
    throw new CapabilityReloadError(
      `refusing to reload capabilities while ${options.activeSessions} session(s) are active`,
    );
  }
  // trace:exempt reason=internal-detail
  const nextKeys = new Map<string, DiscoveredCapability>(
    next.map((capability): [string, DiscoveredCapability] => [
      // trace:exempt reason=internal-detail
      capabilityKey(capability.id, capability.version),
      capability,
    ]),
  );
  // trace:exempt reason=internal-detail
  const currentKeys = new Set(
    current.map((handle) => capabilityKey(handle.manifest.id, handle.manifest.version)),
  );
  // trace:exempt reason=internal-detail
  const started: string[] = [];
  // trace:exempt reason=internal-detail
  const stopped: string[] = [];
  // trace:exempt reason=internal-detail
  const kept: string[] = [];
  // trace:exempt reason=internal-detail
  const handles: StartedCapability[] = [];
  for (const handle of current) {
    // trace:exempt reason=internal-detail
    const key = capabilityKey(handle.manifest.id, handle.manifest.version);
    if (nextKeys.has(key)) {
      kept.push(key);
      handles.push(handle);
      continue;
    }
    await stopCapability(handle);
    stopped.push(key);
  }
  // trace:exempt reason=internal-detail
  for (const capability of next) {
    // trace:exempt reason=internal-detail
    const key = capabilityKey(capability.id, capability.version);
    if (currentKeys.has(key)) continue;
    handles.push(
      await startCapability(capability.manifest, {
        dir: capability.dir,
        grantedPermissions: options.grantedPermissions,
      }),
    );
    started.push(key);
  }
  return {
    started: started.sort(),
    stopped: stopped.sort(),
    kept: kept.sort(),
    handles,
  };
}
