/**
 * router.test.ts — BM25 relevance, boosts, pinned tools, hard cap, latency.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_MAX_VISIBLE_TOOLS, selectTools, type ToolCard } from "./router.ts";

function card(id: string, name: string, description: string, languages: readonly string[] = []): ToolCard {
  return { id, name, description, capability: "test/cap", languages };
}

const twentyTools: ToolCard[] = [
  card("python", "python", "confined python primitive", ["python"]),
  card("pytest-runner", "pytest", "run pytest test suites", ["python"]),
  ...Array.from({ length: 18 }, (_, index) =>
    card(`filler-${index}`, `filler-${index}`, `misc helper ${index}`, ["javascript"]),
  ),
];

test("selectTools ranks the relevant tool first among 20 candidates", () => {
  const selected = selectTools({
    task: "the pytest suite is failing, run pytest to see the error",
    cards: twentyTools,
    pinned: [],
  });
  assert.equal(selected[0]?.id, "pytest-runner");
  assert.ok(selected[0]?.score !== undefined && selected[0].score > 0);
});

test("selectTools never exceeds max_visible_tools (default 8) and keeps pinned python", () => {
  const selected = selectTools({
    task: "unrelated task text",
    cards: twentyTools,
  });
  assert.equal(DEFAULT_MAX_VISIBLE_TOOLS, 8);
  assert.equal(selected.length, 8);
  assert.equal(selected[0]?.id, "python");
  assert.equal(selected[0]?.pinned, true);
});

test("selectTools respects a custom limit and never duplicates ids", () => {
  const selected = selectTools({
    task: "unrelated",
    cards: [...twentyTools, twentyTools[1] as ToolCard],
    maxVisibleTools: 3,
  });
  assert.equal(selected.length, 3);
  assert.equal(new Set(selected.map((tool) => tool.id)).size, 3);
  assert.deepEqual(
    selectTools({ task: "x", cards: twentyTools, maxVisibleTools: 0 }),
    [],
  );
});

test("same-task usefulness and session use boost score, high error rate penalizes", () => {
  const twins = [
    card("tool-a", "pytest runner", "run pytest suites", ["python"]),
    card("tool-z", "pytest runner", "run pytest suites", ["python"]),
  ];
  const baseline = selectTools({ task: "pytest", cards: twins, pinned: [] });
  assert.equal(baseline[0]?.id, "tool-a", "tie broken by id without boosts");

  const useful = selectTools({ task: "pytest", cards: twins, pinned: [], taskUseful: ["tool-z"] });
  assert.equal(useful[0]?.id, "tool-z");

  const session = selectTools({ task: "pytest", cards: twins, pinned: [], sessionUsed: ["tool-z"] });
  assert.equal(session[0]?.id, "tool-z");

  const flaky = selectTools({
    task: "pytest",
    cards: twins,
    pinned: [],
    usage: { "tool-a": { uses: 60, errors: 20 } },
  });
  assert.equal(flaky[0]?.id, "tool-z", "20/60 errors must penalize tool-a");
  assert.ok((flaky[0]?.score ?? 0) > (flaky[1]?.score ?? 0));
});

test("selectTools stays under 10ms for 500 tools", () => {
  const many: ToolCard[] = Array.from({ length: 500 }, (_, index) =>
    card(`tool-${index}`, `tool ${index}`, `capability ${index} helper for editing files`, ["typescript"]),
  );
  const task = "edit the failing test file and re-run the suite";
  let best = Number.POSITIVE_INFINITY;
  for (let run = 0; run < 5; run += 1) {
    const started = performance.now();
    const selected = selectTools({ task, cards: many });
    best = Math.min(best, performance.now() - started);
    assert.equal(selected.length, 8);
  }
  assert.ok(best < 10, `expected < 10ms, best run was ${best.toFixed(2)}ms`);
});
