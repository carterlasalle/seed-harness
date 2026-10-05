// Seed-runtime tool router: Day-1 visible-tool selection.
//
// Purpose: the organism's view of which tools the task agent may see —
// Day 1 that is exactly the python primitive, ranked through the core
// BM25 router so the cap logic stays in one place.
// Why it exists: REQ-SEED-AJZXZFBN owns selection in seed-core; the
// runtime re-exports it with python pinned so the organism loop cannot
// drift into exposing unvetted tools.
// Responsibilities: re-export core selectTools plus the Day-1 defaults
// (python pinned, max 8), one helper building the python-only context.
// Invariants: selectVisibleTools never returns more than maxVisibleTools;
// python is always present on Day 1; no new ranking logic here.
// Public functions/types: selectTools, DEFAULT_MAX_VISIBLE_TOOLS,
// DEFAULT_PINNED_TOOLS, ToolCard, ToolSelectionContext, SelectedTool,
// selectVisibleTools.

import {
  DEFAULT_MAX_VISIBLE_TOOLS,
  DEFAULT_PINNED_TOOLS,
  selectTools,
  type SelectedTool,
  type ToolCard,
  type ToolSelectionContext,
} from "@carterlasalle/seed-core/src/router.ts";

export {
  DEFAULT_MAX_VISIBLE_TOOLS,
  DEFAULT_PINNED_TOOLS,
  selectTools,
  type SelectedTool,
  type ToolCard,
  type ToolSelectionContext,
};

export const VISIBLE_TOOLS_DAY1: readonly string[] = ["python"];

// trace:v1 id=impl.rt-tool-router work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export function selectVisibleTools(
  task: string,
  cards: readonly ToolCard[],
  maxVisibleTools: number = DEFAULT_MAX_VISIBLE_TOOLS,
): SelectedTool[] {
  const pythonOnly = cards.filter((card) => VISIBLE_TOOLS_DAY1.some((tool) => tool === card.id || tool === card.name));
  return selectTools({
    task,
    cards: pythonOnly,
    pinned: [...DEFAULT_PINNED_TOOLS],
    maxVisibleTools,
  });
}
