/**
 * novelty.test.ts — categorical Jaccard over the five tag axes.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { categoricalJaccard, emptyNoveltyTags, noveltyScore } from "./novelty.ts";

test("identical tag sets are fully similar and zero novelty", () => {
  const tags = { subsystem: ["runner"], tool: ["python"], context: ["compile"], edit: [], control: [] };
  assert.equal(categoricalJaccard(tags, tags), 1);
  assert.equal(noveltyScore(tags, tags), 0);
});

test("disjoint tag sets are zero similarity and full novelty", () => {
  const left = { subsystem: ["runner"], tool: ["python"] };
  const right = { subsystem: ["web"], tool: ["node"] };
  assert.equal(categoricalJaccard(left, right), 0);
  assert.equal(noveltyScore(left, right), 1);
});

test("partial overlap is averaged over the categories that carry tags", () => {
  const left = { subsystem: ["a", "b"], tool: ["x"] };
  const right = { subsystem: ["a", "c"], tool: ["x"] };
  // subsystem: 1 shared / 3 union = 1/3; tool: 1/1 = 1; the three empty axes are ignored.
  const expected = (1 / 3 + 1) / 2;
  const actual = categoricalJaccard(left, right);
  assert.ok(Math.abs(actual - expected) < 1e-12, `expected ${expected}, got ${actual}`);
});

test("empty and missing categories contribute zero", () => {
  assert.equal(categoricalJaccard(emptyNoveltyTags(), emptyNoveltyTags()), 0);
  assert.equal(categoricalJaccard({}, {}), 0);
});
