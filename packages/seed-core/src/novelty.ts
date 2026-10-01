/**
 * seed-core novelty: categorical Jaccard over harness tag sets.
 *
 * Purpose: measure how different two artifacts/candidates are across the five
 * categorical axes the lab tracks (subsystem, tool, context, edit, control).
 * Why it exists: parent selection and archive maintenance need a cheap,
 * deterministic diversity measure; embeddings would be neither auditable nor
 * comparable across runs.
 * Responsibilities: per-category Jaccard similarity between tag sets and the
 * novelty score (1 - similarity), averaged over the categories that carry tags.
 * Invariants: pure; categories where both tag sets are empty are excluded from
 * the average (identical sets score 1, fully disjoint sets score 0); missing
 * categories are treated as empty sets; result is in [0, 1].
 * Public: categoricalJaccard, noveltyScore, emptyNoveltyTags, NoveltyTags,
 * NOVELTY_CATEGORIES.
 */

// trace:exempt reason=internal-detail
export const NOVELTY_CATEGORIES = ["subsystem", "tool", "context", "edit", "control"] as const;

// trace:exempt reason=internal-detail
export type NoveltyCategory = (typeof NOVELTY_CATEGORIES)[number];

// trace:exempt reason=internal-detail
export interface NoveltyTags {
  subsystem: string[];
  tool: string[];
  context: string[];
  edit: string[];
  control: string[];
}

// trace:exempt reason=internal-detail
export type PartialNoveltyTags = Partial<Record<NoveltyCategory, readonly string[]>>;

// trace:v1 id=impl.sc-novelty-empty work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function emptyNoveltyTags(): NoveltyTags {
  return { subsystem: [], tool: [], context: [], edit: [], control: [] };
}

// trace:exempt reason=internal-detail
function categorySimilarity(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): number {
  // trace:exempt reason=internal-detail
  const a = new Set(left ?? []);
  // trace:exempt reason=internal-detail
  const b = new Set(right ?? []);
  if (a.size === 0 && b.size === 0) return 0;
  // trace:exempt reason=internal-detail
  let shared = 0;
  for (const value of a) {
    if (b.has(value)) shared += 1;
  }
  // trace:exempt reason=internal-detail
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

// trace:v1 id=impl.sc-novelty-jaccard work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function categoricalJaccard(a: PartialNoveltyTags, b: PartialNoveltyTags): number {
  let total = 0;
  let measured = 0;
  for (const category of NOVELTY_CATEGORIES) {
    const left = a[category] ?? [];
    const right = b[category] ?? [];
    if (left.length === 0 && right.length === 0) continue;
    total += categorySimilarity(left, right);
    measured += 1;
  }
  return measured === 0 ? 0 : total / measured;
}

// trace:v1 id=impl.sc-novelty-score work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function noveltyScore(a: PartialNoveltyTags, b: PartialNoveltyTags): number {
  return 1 - categoricalJaccard(a, b);
}
