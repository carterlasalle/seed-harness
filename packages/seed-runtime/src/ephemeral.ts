// Seed-runtime ephemeral tools: tracked throwaway scripts under scratch.
//
// Purpose: give the task agent a place to graduate repeated snippets into
// named, tracked, re-runnable tools without touching the repo tree.
// Why it exists: REQ-SEED-YM8XJREE needs ephemeral tracking — creation,
// modification, execution counts, args hashes, status, and elapsed time —
// so the crystallizer can see what the agent actually reuses.
// Responsibilities: create/list/read tool dirs at
// $SEED_SCRATCH/ephemeral/<id>/{metadata.json,tool.py}, append execution
// records, keep modification stamps fresh.
// Invariants: every tool dir always has both files; metadata always carries
// creation/modification/executions/args-hash/status/elapsed; ids are
// filesystem-safe; executions append, never rewrite history.
// Public types/functions: EphemeralStatus, EphemeralExecution,
// EphemeralMetadata, EphemeralTool, EphemeralStore, hashArgs,
// createEphemeralStore.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type EphemeralStatus = "created" | "running" | "succeeded" | "failed";

export interface EphemeralExecution {
  at: string;
  argsHash: string;
  status: EphemeralStatus;
  elapsedMs: number;
  detail?: string;
}

export interface EphemeralMetadata {
  id: string;
  createdAt: string;
  modifiedAt: string;
  executions: EphemeralExecution[];
  lastArgsHash: string | null;
  status: EphemeralStatus;
  totalElapsedMs: number;
  description?: string;
}

export interface EphemeralTool {
  metadata: EphemeralMetadata;
  code: string;
}

// trace:exempt reason=internal-detail
function safeId(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) {
    throw new Error(`bad ephemeral id: ${JSON.stringify(id)} (alphanumeric, dash/underscore, max 64)`);
  }
  return id;
}

// trace:v1 id=impl.rt-ephemeral-store work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export class EphemeralStore {
  readonly root: string;

  // trace:exempt reason=internal-detail
  constructor(scratchDir: string) {
    this.root = join(scratchDir, "ephemeral");
    mkdirSync(this.root, { recursive: true });
  }

  // trace:exempt reason=internal-detail
  private dir(id: string): string {
    return join(this.root, safeId(id));
  }

  // trace:exempt reason=internal-detail
  private readMetadata(id: string): EphemeralMetadata {
    const raw = readFileSync(join(this.dir(id), "metadata.json"), "utf8");
    const metadata = JSON.parse(raw) as EphemeralMetadata;
    if (typeof metadata.id !== "string" || !Array.isArray(metadata.executions)) {
      throw new Error(`bad metadata for ephemeral tool ${JSON.stringify(id)}`);
    }
    return metadata;
  }

  // trace:exempt reason=internal-detail
  private writeMetadata(metadata: EphemeralMetadata): void {
    writeFileSync(join(this.dir(metadata.id), "metadata.json"), JSON.stringify(metadata, null, 2));
  }

  // trace:exempt reason=internal-detail
  create(id: string, code: string, description?: string): EphemeralTool {
    const clean = safeId(id);
    mkdirSync(this.dir(clean), { recursive: true });
    const now = new Date().toISOString();
    const metadata: EphemeralMetadata = {
      id: clean,
      createdAt: now,
      modifiedAt: now,
      executions: [],
      lastArgsHash: null,
      status: "created",
      totalElapsedMs: 0,
      ...(description === undefined ? {} : { description }),
    };
    // trace:exempt reason=internal-detail
    writeFileSync(join(this.dir(clean), "tool.py"), code);
    this.writeMetadata(metadata);
    return { metadata, code };
  }

  // trace:exempt reason=internal-detail
  update(id: string, code: string): EphemeralTool {
    const metadata = this.readMetadata(id);
    writeFileSync(join(this.dir(id), "tool.py"), code);
    metadata.modifiedAt = new Date().toISOString();
    this.writeMetadata(metadata);
    return { metadata, code };
  }

  // trace:exempt reason=internal-detail
  recordExecution(id: string, execution: Omit<EphemeralExecution, "at"> & { at?: string }): EphemeralMetadata {
    const metadata = this.readMetadata(id);
    const entry: EphemeralExecution = { at: new Date().toISOString(), ...execution };
    metadata.executions.push(entry);
    metadata.lastArgsHash = entry.argsHash;
    metadata.status = entry.status;
    metadata.totalElapsedMs += entry.elapsedMs;
    metadata.modifiedAt = entry.at;
    this.writeMetadata(metadata);
    return metadata;
  }

  // trace:exempt reason=internal-detail
  read(id: string): EphemeralTool {
    const metadata = this.readMetadata(id);
    const code = readFileSync(join(this.dir(id), "tool.py"), "utf8");
    return { metadata, code };
  }

  // trace:exempt reason=internal-detail
  list(): EphemeralMetadata[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .flatMap((name) => {
        try {
          return [this.readMetadata(name)];
        } catch {
          return [];
        }
      });
  }
}

// trace:v1 id=impl.rt-ephemeral-hash work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export function hashArgs(args: unknown): string {
  return createHash("sha256").update(JSON.stringify(args ?? null)).digest("hex").slice(0, 16);
}

// trace:v1 id=impl.rt-ephemeral-factory work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export function createEphemeralStore(scratchDir?: string): EphemeralStore {
  const root = scratchDir ?? process.env.SEED_SCRATCH;
  if (!root) throw new Error("createEphemeralStore needs a scratch dir (pass one or set SEED_SCRATCH)");
  return new EphemeralStore(root);
}
