/**
 * seed-core tool router: BM25 selection of visible tools with a hard cap.
 *
 * Purpose: rank capability tool cards against the current task and choose the
 * small set the task agent may see (spec: BM25 router, max 8 visible).
 * Why it exists: prompt size must stay predictable, and visibility must be
 * earned by measured usefulness, not by how many capabilities are installed.
 * Responsibilities: tokenized BM25 over name/description/capability/language
 * metadata (no embeddings), multiplicative boosts for same-task usefulness
 * (+25%), session use (+15%) and proven-but-unreliable tools (>20% errors over
 * 50+ uses: -30%), pinned tools (the python primitive by default), and the
 * max_visible_tools cap.
 * Invariants: pure; deterministic ordering (score desc, id asc); pinned tools
 * first; the result never exceeds maxVisibleTools (default 8) and never
 * contains duplicate ids.
 * Public: ToolSelectionContext, ToolCard, SelectedTool, selectTools,
 * DEFAULT_MAX_VISIBLE_TOOLS, DEFAULT_PINNED_TOOLS, ROUTER_BOOSTS.
 */

// trace:exempt reason=internal-detail
export interface ToolCard {
  id: string;
  name: string;
  description: string;
  capability: string;
  languages: readonly string[];
}

// trace:exempt reason=internal-detail
export interface ToolUsage {
  uses: number;
  errors: number;
}

// trace:exempt reason=internal-detail
export interface ToolSelectionContext {
  task: string;
  cards: readonly ToolCard[];
  pinned?: readonly string[];
  sessionUsed?: readonly string[];
  taskUseful?: readonly string[];
  usage?: Readonly<Record<string, ToolUsage>>;
  maxVisibleTools?: number;
}

// trace:exempt reason=internal-detail
export interface SelectedTool {
  id: string;
  score: number;
  pinned: boolean;
}

// trace:exempt reason=internal-detail
export const DEFAULT_MAX_VISIBLE_TOOLS = 8;
// trace:exempt reason=internal-detail
export const DEFAULT_PINNED_TOOLS: readonly string[] = ["python"];
// trace:exempt reason=internal-detail
export const ROUTER_BOOSTS = { sameTaskUseful: 1.25, sessionUsed: 1.15, highErrorRate: 0.7 } as const;
// trace:exempt reason=internal-detail
export const HIGH_ERROR_USES = 50;
// trace:exempt reason=internal-detail
export const HIGH_ERROR_RATE = 0.2;

// trace:exempt reason=internal-detail
const BM25_K1 = 1.2;
// trace:exempt reason=internal-detail
const BM25_B = 0.75;

// trace:exempt reason=internal-detail
function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

// trace:exempt reason=internal-detail
function bm25Scores(documents: readonly (readonly string[])[], query: readonly string[]): number[] {
  if (documents.length === 0) return [];
  // trace:exempt reason=internal-detail
  const averageLength =
    documents.reduce((sum, document) => sum + document.length, 0) / documents.length;
  if (averageLength === 0) return documents.map(() => 0);
  // trace:exempt reason=internal-detail
  const terms = [...new Set(query)];
  // trace:exempt reason=internal-detail
  const documentFrequency = new Map<string, number>();
  for (const term of terms) {
    // trace:exempt reason=internal-detail
    let count = 0;
    for (const document of documents) {
      if (document.includes(term)) count += 1;
    }
    documentFrequency.set(term, count);
  }
  return documents.map((document) => {
    if (document.length === 0) return 0;
    // trace:exempt reason=internal-detail
    const frequencies = new Map<string, number>();
    for (const token of document) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }
    // trace:exempt reason=internal-detail
    let score = 0;
    for (const term of terms) {
      // trace:exempt reason=internal-detail
      const frequency = frequencies.get(term);
      if (frequency === undefined) continue;
      // trace:exempt reason=internal-detail
      const df = documentFrequency.get(term) ?? 0;
      // trace:exempt reason=internal-detail
      const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
      // trace:exempt reason=internal-detail
      const denominator =
        frequency + BM25_K1 * (1 - BM25_B + BM25_B * (document.length / averageLength));
      score += (idf * (frequency * (BM25_K1 + 1))) / denominator;
    }
    return score;
  });
}

// trace:exempt reason=internal-detail
function compareSelected(a: SelectedTool, b: SelectedTool): number {
  if (a.score !== b.score) return a.score > b.score ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

// trace:v1 id=impl.sc-router-select work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export function selectTools(context: ToolSelectionContext): SelectedTool[] {
  const limit = Math.max(0, context.maxVisibleTools ?? DEFAULT_MAX_VISIBLE_TOOLS);
  if (limit === 0) return [];

  const cards: ToolCard[] = [];
  const seen: Record<string, true> = {};
  for (const card of context.cards) {
    if (Object.hasOwn(seen, card.id)) continue;
    seen[card.id] = true;
    cards.push(card);
  }
  if (cards.length === 0) return [];

  // trace:exempt reason=internal-detail
  const documents = cards.map((card) =>
    // trace:exempt reason=internal-detail
    tokenize(`${card.name} ${card.description} ${card.capability} ${card.languages.join(" ")}`),
  );
  // trace:exempt reason=internal-detail
  const rawScores = bm25Scores(documents, tokenize(context.task));
  // trace:exempt reason=internal-detail
  const useful = new Set(context.taskUseful ?? []);
  // trace:exempt reason=internal-detail
  const sessionUsed = new Set(context.sessionUsed ?? []);
  // trace:exempt reason=internal-detail
  const pinned = new Set(context.pinned ?? DEFAULT_PINNED_TOOLS);

  // trace:exempt reason=internal-detail
  const scored = cards.map((card, index) => {
    // trace:exempt reason=internal-detail
    let score = rawScores[index] ?? 0;
    if (useful.has(card.id)) score *= ROUTER_BOOSTS.sameTaskUseful;
    if (sessionUsed.has(card.id)) score *= ROUTER_BOOSTS.sessionUsed;
    // trace:exempt reason=internal-detail
    const usage = context.usage?.[card.id];
    if (usage !== undefined && usage.uses >= HIGH_ERROR_USES && usage.errors / usage.uses > HIGH_ERROR_RATE) {
      score *= ROUTER_BOOSTS.highErrorRate;
    }
    return { id: card.id, score, pinned: pinned.has(card.id) };
  });

  scored.sort(compareSelected);
  // trace:exempt reason=internal-detail
  const pinnedTools = scored.filter((tool) => tool.pinned);
  // trace:exempt reason=internal-detail
  const rest = scored.filter((tool) => !tool.pinned);
  return [...pinnedTools, ...rest].slice(0, limit);
}
