// Seed lab candidate: metadata shape plus worktree lifecycle for evaluation.
//
// Purpose: describe one challenger candidate (lineage + task scope) and create
// its isolated git worktree for committed-only evaluation.
// Why it exists: challengers train in worktrees and promote only through gates;
// evaluating uncommitted state would make results unreproducible.
// Responsibilities: metadata construction, committed-ref guard, `git worktree add`.
// Invariants: every candidate records its parent ref; worktrees are created only
// for committed refs (no empty, whitespace, or dirty markers); the worktree
// command is pure data until createWorktree spawns it.
// Public types/functions: CandidateMetadata, createCandidate, assertCommittedRef,
// worktreeAddArgs, createWorktree.

import { spawnSync } from "node:child_process";

// trace:exempt reason=internal-detail
export interface CandidateMetadata {
  ref: string;
  parent: string | null;
  createdAt: string;
  taskIds: string[];
}

// trace:v1 id=impl.candidate-create work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function createCandidate(ref: string, parent: string | null, taskIds: string[]): CandidateMetadata {
  assertCommittedRef(ref);
  return { ref, parent, createdAt: new Date().toISOString(), taskIds: [...taskIds] };
}

// trace:v1 id=impl.candidate-ref-guard work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function assertCommittedRef(ref: string): void {
  if (!ref || /\s/.test(ref)) throw new Error(`candidate ref must be a single committed token, got: ${JSON.stringify(ref)}`);
  if (/dirty|uncommitted|untracked/i.test(ref))
    throw new Error(`candidate ref must be committed, got: ${JSON.stringify(ref)}`);
}

// trace:v1 id=impl.candidate-worktree-args work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function worktreeAddArgs(worktreePath: string, ref: string): string[] {
  assertCommittedRef(ref);
  return ["worktree", "add", worktreePath, ref];
}

// trace:v1 id=impl.candidate-worktree-create work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function createWorktree(
  repoRoot: string,
  worktreePath: string,
  ref: string,
): { ok: boolean; stderr: string } {
  const args = worktreeAddArgs(worktreePath, ref);
  // trace:exempt reason=internal-detail
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.error) throw result.error;
  return { ok: result.status === 0, stderr: String(result.stderr ?? "") };
}
