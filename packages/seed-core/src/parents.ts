/**
 * seed-core parent selection: the four breeding parents per generation.
 *
 * Purpose: choose the four parents a mutation/experiment generation starts
 * from — champion, highest-crowding, least-explored, most-novel — from a
 * scored population.
 * Why it exists: evolution needs both exploitation (champion), pressure in
 * crowded regions (crowding), coverage (least-explored) and genuine novelty
 * (most-novel); a single winner would collapse the search.
 * Responsibilities: deterministic role-by-role selection with stable
 * tie-breaks, novelty measured by categorical Jaccard against the champion.
 * Invariants: pure; roles are returned in fixed order; a candidate is used by
 * at most one role (roles with no unused candidate are omitted); ties break
 * by score desc then id asc; when no champion is supplied the highest-scoring
 * candidate plays the champion role.
 * Public: selectParents, ParentCandidate, SelectedParent, ParentRole.
 */

import { noveltyScore, type PartialNoveltyTags } from "./novelty.ts";

// trace:exempt reason=internal-detail
export type ParentRole = "champion" | "highest-crowding" | "least-explored" | "most-novel";

// trace:exempt reason=internal-detail
export interface ParentCandidate {
  id: string;
  tags?: PartialNoveltyTags;
  score?: number;
  crowding?: number;
  explored?: number;
}

// trace:exempt reason=internal-detail
export interface SelectedParent {
  role: ParentRole;
  id: string;
  score: number;
}

// trace:exempt reason=internal-detail
function scoreOf(candidate: ParentCandidate): number {
  return candidate.score ?? 0;
}

// trace:exempt reason=internal-detail
function pickBest(
  candidates: ParentCandidate[],
  valueOf: (candidate: ParentCandidate) => number,
): ParentCandidate | null {
  // trace:exempt reason=internal-detail
  let best: ParentCandidate | null = null;
  // trace:exempt reason=internal-detail
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    // trace:exempt reason=internal-detail
    const value = valueOf(candidate);
    if (
      best === null ||
      value > bestValue ||
      (value === bestValue &&
        (scoreOf(candidate) > scoreOf(best) ||
          (scoreOf(candidate) === scoreOf(best) && candidate.id < best.id)))
    ) {
      best = candidate;
      bestValue = value;
    }
  }
  return best;
}

// trace:exempt reason=internal-detail
function take(candidates: ParentCandidate[], candidate: ParentCandidate | null): ParentCandidate | null {
  if (candidate === null) return null;
  // trace:exempt reason=internal-detail
  const index = candidates.indexOf(candidate);
  if (index >= 0) candidates.splice(index, 1);
  return candidate;
}

// trace:v1 id=impl.sc-parents-select work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function selectParents(
  population: readonly ParentCandidate[],
  context: { championId?: string } = {},
): SelectedParent[] {
  const remaining = [...population];
  const selected: SelectedParent[] = [];

  // trace:exempt reason=internal-detail
  const explicitChampion =
    context.championId === undefined
      ? undefined
      : remaining.find((candidate) => candidate.id === context.championId);
  // trace:exempt reason=internal-detail
  const champion = take(
    remaining,
    explicitChampion ?? pickBest(remaining, scoreOf),
  );
  if (champion !== null) selected.push({ role: "champion", id: champion.id, score: scoreOf(champion) });

  // trace:exempt reason=internal-detail
  const crowded = take(remaining, pickBest(remaining, (candidate) => candidate.crowding ?? 0));
  if (crowded !== null) selected.push({ role: "highest-crowding", id: crowded.id, score: scoreOf(crowded) });

  // trace:exempt reason=internal-detail
  const unexplored = take(remaining, pickBest(remaining, (candidate) => -(candidate.explored ?? 0)));
  if (unexplored !== null) {
    selected.push({ role: "least-explored", id: unexplored.id, score: scoreOf(unexplored) });
  }

  // trace:exempt reason=internal-detail
  const championTags = champion?.tags ?? {};
  // trace:exempt reason=internal-detail
  const novel = take(
    remaining,
    // trace:exempt reason=internal-detail
    pickBest(remaining, (candidate) => noveltyScore(candidate.tags ?? {}, championTags)),
  );
  if (novel !== null) selected.push({ role: "most-novel", id: novel.id, score: scoreOf(novel) });

  return selected;
}
