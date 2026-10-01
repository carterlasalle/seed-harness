/**
 * parents.test.ts — four-parent selection (champion, crowding, exploration, novelty).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { selectParents, type ParentCandidate } from "./parents.ts";

const population: ParentCandidate[] = [
  { id: "p1", score: 0.9, crowding: 1, explored: 5, tags: { subsystem: ["runner"], tool: ["python"] } },
  { id: "p2", score: 0.7, crowding: 7, explored: 0, tags: { subsystem: ["web"], tool: ["node"] } },
  { id: "p3", score: 0.5, crowding: 2, explored: 2, tags: { subsystem: ["runner"], tool: ["node"] } },
  { id: "p4", score: 0.4, crowding: 3, explored: 1, tags: { subsystem: ["docs"], tool: ["python"] } },
  { id: "p5", score: 0.3, crowding: 4, explored: 9, tags: { subsystem: ["eval"], tool: ["python"] } },
];

test("selects champion, highest-crowding, least-explored and most-novel parents", () => {
  const selected = selectParents(population, { championId: "p1" });
  assert.deepEqual(
    selected.map((parent) => parent.role),
    ["champion", "highest-crowding", "least-explored", "most-novel"],
  );
  assert.equal(selected[0]?.id, "p1");
  assert.equal(selected[1]?.id, "p2");
  assert.equal(selected[2]?.id, "p4", "p4 has the lowest explored count among unused candidates");
  const ids = selected.map((parent) => parent.id);
  assert.equal(new Set(ids).size, ids.length, "roles never reuse a candidate");
});

test("without an explicit champion the highest score leads", () => {
  const selected = selectParents(population);
  assert.equal(selected[0]?.role, "champion");
  assert.equal(selected[0]?.id, "p1");
});

test("small populations return only as many roles as candidates", () => {
  const pair = population.slice(0, 2);
  const selected = selectParents(pair, { championId: "p2" });
  assert.deepEqual(
    selected.map((parent) => parent.id),
    ["p2", "p1"],
  );
  assert.deepEqual(selectParents([], {}), []);
});

test("selection is deterministic", () => {
  assert.deepEqual(selectParents(population, { championId: "p1" }), selectParents(population, { championId: "p1" }));
});
