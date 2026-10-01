// seed-cli champion: champion pointer reads, history, and one-write rollback.
//
// Purpose: `seed champion show|history|rollback` over the atomic champion
// pointer. Why it exists: champion/challenger with rollback is the safety
// core of promotion — sessions pin the ref, promotion moves it atomically,
// rollback is one pointer write. Responsibilities: read pointer, list
// history, append-then-move rollback. Invariants: rollback always preserves
// the previous ref as the newest history entry before moving; never deletes
// history. Public functions/types: showChampion, championHistory,
// rollbackChampion.

import { loadChampion, saveChampion } from "./state.ts";
import type { ChampionPointer } from "./state.ts";

// trace:v1 id=impl.cli-champion-show work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function showChampion(root?: string): ChampionPointer {
  return loadChampion(root);
}

// trace:v1 id=impl.cli-champion-history work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function championHistory(root?: string): ChampionPointer["history"] {
  return loadChampion(root).history;
}

// trace:v1 id=impl.cli-champion-rollback work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function rollbackChampion(ref: string, reason: string, root?: string): ChampionPointer {
  if (!ref) throw new Error("rollback needs a ref");
  const pointer = loadChampion(root);
  const at = new Date().toISOString();
  pointer.history.push({ ref: pointer.ref, at, reason: `rollback to ${ref}: ${reason}` });
  pointer.ref = ref;
  pointer.updatedAt = at;
  // trace:exempt reason=internal-detail
  saveChampion(pointer, root);
  return pointer;
}
