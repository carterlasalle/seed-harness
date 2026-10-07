// seed-cli champion: guardian-backed champion reads plus local rollback record.
//
// Purpose: `seed champion show|history` read the single truth (guardian
// SQLite via champion.show/history); `rollback` records the local pointer
// move. Why it exists: TOTALSPEC forbids two champion systems — the
// guardian owns the pointer, the CLI cache only mirrors it.
// Responsibilities: async guardian reads with local fallback, local
// append-then-move rollback, history preservation.
// Invariants: show/history prefer the guardian ref when reachable and fall
// back to the local cache offline; rollback never deletes history.
// Public functions/types: showChampion, championHistory,
// rollbackChampion.

import { loadChampion, saveChampion } from "./state.ts";
import type { ChampionPointer } from "./state.ts";
// The socket path is resolved in one place so SEED_GUARDIAN_SOCKET can point
// tests at a socket that does not exist, exercising the offline fallbacks.
import { guardianSocketPath as socketPath, withGuardian } from "./guardian.ts";

// trace:v1 id=impl.cli-champion-show work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export async function showChampion(root?: string): Promise<ChampionPointer> {
  const local = loadChampion(root);
  try {
    const result = await withGuardian({ socketPath: socketPath(), connectTimeoutMs: 1500 }, (client) =>
      client.call("champion.show", {}) as Promise<{ ref?: unknown }>,
    );
    if (typeof result?.ref === "string" && result.ref.length > 0 && result.ref !== local.ref) {
      local.ref = result.ref;
      local.updatedAt = new Date().toISOString();
      saveChampion(local, root);
    }
  } catch {
    // offline: local cache is the best available truth
  }
  return local;
}

// trace:v1 id=impl.cli-champion-history work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export async function championHistory(root?: string): Promise<ChampionPointer["history"]> {
  const local = loadChampion(root);
  try {
    const result = await withGuardian({ socketPath: socketPath(), connectTimeoutMs: 1500 }, (client) =>
      client.call("champion.history", {}) as Promise<{ history?: Array<{ ref?: unknown; reason?: unknown; at?: unknown }> }>,
    );
    if (Array.isArray(result?.history) && result.history.length > 0) {
      return result.history.map((h) => ({
        ref: typeof h.ref === "string" ? h.ref : "",
        at: typeof h.at === "string" ? h.at : new Date(0).toISOString(),
        reason: typeof h.reason === "string" ? h.reason : "",
      }));
    }
  } catch {
    // offline fallback below
  }
  return local.history;
}

// trace:v1 id=impl.cli-champion-rollback work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export async function rollbackChampion(ref: string, reason: string, root?: string): Promise<ChampionPointer> {
  if (!ref) throw new Error("rollback needs a ref");
  try {
    const result = await withGuardian({ socketPath: socketPath(), connectTimeoutMs: 1500 }, (client) =>
      client.call("champion.rollback", {}) as Promise<{ ref?: unknown }>,
    );
    if (typeof result?.ref !== "string" || result.ref.length === 0) throw new Error("guardian rollback returned no ref");
    const pointer = loadChampion(root);
    const at = new Date().toISOString();
    pointer.history.push({ ref: pointer.ref, at, reason: `rollback to ${result.ref}: ${reason}` });
    pointer.ref = result.ref;
    pointer.updatedAt = at;
    // trace:exempt reason=internal-detail
    saveChampion(pointer, root);
    return pointer;
  } catch (error) {
    if (error instanceof Error && /rollback needs|previous champion|at least two/.test(error.message)) throw error;
    const pointer = loadChampion(root);
    const at = new Date().toISOString();
    if (!pointer.history.some((h) => h.ref === ref)) {
      throw new Error(
        `rollback target ${JSON.stringify(ref)} is not a previously valid champion (budget: rollback, limit: history refs, requested: ${ref})`,
      );
    }
    pointer.history.push({ ref: pointer.ref, at, reason: `rollback to ${ref}: ${reason}` });
    pointer.ref = ref;
    pointer.updatedAt = at;
    // trace:exempt reason=internal-detail
    saveChampion(pointer, root);
    return pointer;
  }
}
