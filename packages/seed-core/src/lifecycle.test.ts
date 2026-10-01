/**
 * lifecycle.test.ts — pareto dominance, stage exits, rent, deprecation,
 * consolidation.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  advanceStage,
  consolidationOutcome,
  deprecationReason,
  dominates,
  emptyRent,
  errorRate,
  trackRent,
} from "./lifecycle.ts";

test("pareto dominance: non-strict on every axis, strict on at least one", () => {
  assert.equal(dominates({ score: 1, cost: 1 }, { score: 1, cost: 1 }), false, "ties never dominate");
  assert.equal(dominates({ score: 1, cost: 1 }, { score: 0.5, cost: 2 }), true);
  assert.equal(dominates({ score: 1, cost: 2 }, { score: 1, cost: 1 }), false, "worse on cost cannot dominate");
  assert.equal(dominates({ score: 0.5, cost: 1 }, { score: 1, cost: 1 }), false, "worse on score cannot dominate");
  assert.equal(dominates({ score: 1, cost: 1 }, { score: 0.5, cost: 1 }), true, "equal cost, better score");
  assert.equal(dominates({ score: 1, cost: 1 }, { score: 1, cost: 2 }), true, "equal score, lower cost");
});

test("rent tracks uses, distinct tasks, errors and idle turns", () => {
  let rent = emptyRent();
  rent = trackRent(rent, { kind: "use", ok: true, task: "t1" });
  rent = trackRent(rent, { kind: "use", ok: true, task: "t1" });
  rent = trackRent(rent, { kind: "use", ok: false, task: "t2" });
  assert.deepEqual(rent.tasks, ["t1", "t2"]);
  assert.equal(rent.uses, 3);
  assert.equal(rent.successes, 2);
  assert.equal(rent.errors, 1);
  assert.equal(errorRate(rent), 1 / 3);
  rent = trackRent(rent, { kind: "idle", turns: 5 });
  assert.equal(rent.idleTurns, 5);
  rent = trackRent(rent, { kind: "use", ok: true });
  assert.equal(rent.idleTurns, 0, "a use resets idle tracking");
  assert.throws(() => trackRent(rent, { kind: "idle", turns: -1 }), /idle turns/);
});

test("stage exits require the counted thresholds", () => {
  let rent = emptyRent();
  assert.equal(advanceStage("ephemeral", rent), "ephemeral");
  for (const task of ["t1", "t2", "t3"]) rent = trackRent(rent, { kind: "use", ok: true, task });
  assert.equal(advanceStage("ephemeral", rent), "probation");

  let probation = emptyRent();
  for (let index = 0; index < 9; index += 1) probation = trackRent(probation, { kind: "use", ok: true });
  assert.equal(advanceStage("probation", probation), "probation", "9 uses is below the exit");
  probation = trackRent(probation, { kind: "use", ok: true });
  assert.equal(advanceStage("probation", probation), "established");

  let mature = emptyRent();
  for (let index = 0; index < 50; index += 1) mature = trackRent(mature, { kind: "use", ok: true });
  assert.equal(advanceStage("established", mature), "mature");
  assert.equal(advanceStage("mature", mature), "mature", "mature is terminal");
});

test("deprecation reasons: unused, dominated, error-rate — in that priority", () => {
  const idle = trackRent(emptyRent(), { kind: "idle", turns: 100 });
  assert.equal(deprecationReason({ stage: "mature", rent: idle }), "unused");
  assert.equal(deprecationReason({ stage: "mature", rent: trackRent(emptyRent(), { kind: "idle", turns: 99 }) }), null);

  const dominated = deprecationReason({
    stage: "probation",
    rent: emptyRent(),
    self: { score: 0.4, cost: 2 },
    peers: [{ score: 0.6, cost: 1 }],
  });
  assert.equal(dominated, "dominated");

  let flaky = emptyRent();
  for (let index = 0; index < 20; index += 1) flaky = trackRent(flaky, { kind: "use", ok: index >= 6 });
  assert.equal(errorRate(flaky), 0.3);
  assert.equal(deprecationReason({ stage: "established", rent: flaky }), "error-rate");
  assert.equal(deprecationReason({ stage: "established", rent: emptyRent() }), null);
});

test("consolidation requires >=80% tag overlap and >=70% use overlap", () => {
  const outcome = consolidationOutcome(
    { tags: ["a", "b", "c", "d", "e"], uses: ["x", "y", "z"] },
    { tags: ["a", "b", "c", "d"], uses: ["x", "y"] },
  );
  assert.equal(outcome.tagOverlap, 1, "4 of 4 smaller-set tags shared");
  assert.equal(outcome.useOverlap, 1);
  assert.equal(outcome.consolidate, true);

  const weakTags = consolidationOutcome({ tags: ["a", "b"], uses: ["x"] }, { tags: ["a", "z"], uses: ["x"] });
  assert.equal(weakTags.tagOverlap, 0.5);
  assert.equal(weakTags.consolidate, false);

  const weakUses = consolidationOutcome(
    { tags: ["a", "b", "c", "d", "e"], uses: ["x", "y", "z", "w"] },
    { tags: ["a", "b", "c", "d"], uses: ["x", "y"] },
  );
  assert.equal(weakUses.consolidate, true);
  const disjointUses = consolidationOutcome(
    { tags: ["a", "b", "c", "d", "e"], uses: ["x", "y", "q"] },
    { tags: ["a", "b", "c", "d"], uses: ["x", "y", "z", "w"] },
  );
  assert.equal(disjointUses.useOverlap, 2 / 3);
  assert.equal(disjointUses.consolidate, false, "66% use overlap is below the 70% bar");
  assert.equal(consolidationOutcome({ tags: [], uses: [] }, { tags: [], uses: [] }).consolidate, false);
});
