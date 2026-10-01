/**
 * scientist.test.ts — exactly-3-hypothesis validation, class ordering,
 * distinctness (rejects three restatements) and prompt building.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateScientistOutput, buildScientistPrompt, ScientistOutputError } from "./scientist.ts";
import type { FrictionCluster } from "./cluster.ts";

function hypothesis(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "h",
    statement: "statement",
    prediction: "prediction",
    falsification: "falsification",
    status: "open",
    ...overrides,
  };
}

const validTriple = {
  hypotheses: [
    hypothesis({
      id: "h1",
      class: "direct",
      statement: "Wrap the flaky compile step in a retry helper.",
      prediction: "Compile-loop friction drops below one signal per task.",
      falsification: "Compile loops still repeat after the wrapper lands.",
    }),
    hypothesis({
      id: "h2",
      class: "cross-system",
      statement: "Cache invalidation in the file watcher delays edits consumed by the test runner.",
      prediction: "Runner staleness disappears once the watcher broadcasts invalidation.",
      falsification: "Runner still reads stale files with invalidation wired through.",
    }),
    hypothesis({
      id: "h3",
      class: "assumption-inversion",
      statement: "The harness assumes python3 is always on PATH.",
      assumption: "python3 resolves on PATH in every capability environment.",
      reason: "Capabilities may run in images that ship another interpreter layout.",
      replacement: "Resolve the interpreter from the manifest and fail fast when absent.",
      prediction: "Capability starts stop failing with ENOENT after the resolution change.",
      falsification: "Starts still fail with ENOENT once resolution is manifest-driven.",
    }),
  ],
};

test("accepts exactly three hypotheses with the three ordered classes", () => {
  const output = validateScientistOutput(validTriple);
  assert.equal(output.hypotheses.length, 3);
  assert.deepEqual(
    output.hypotheses.map((entry) => entry.class),
    ["direct", "cross-system", "assumption-inversion"],
  );
  assert.deepEqual(
    output.hypotheses.map((entry) => entry.risk),
    ["low", "medium", "high"],
  );
  assert.equal(output.hypotheses[2]?.replacement !== null, true);
});

test("rejects outputs that are not exactly three hypotheses", () => {
  assert.throws(
    () => validateScientistOutput({ hypotheses: [validTriple.hypotheses[0], validTriple.hypotheses[1]] }),
    (error: unknown) => error instanceof ScientistOutputError && error.issues.some((issue) => issue.includes("exactly 3")),
  );
  assert.throws(() => validateScientistOutput({}), ScientistOutputError);
});

test("rejects a triple of grep variants", () => {
  const variants = {
    hypotheses: [
      hypothesis({
        id: "h1",
        class: "direct",
        statement: "grep the repository for the missing import in the test runner",
      }),
      hypothesis({
        id: "h2",
        class: "cross-system",
        statement: "grep the repository for the missing import in the pytest runner",
      }),
      hypothesis({
        id: "h3",
        class: "assumption-inversion",
        statement: "grep the repository for the missing import in the python runner",
        assumption: "the import exists somewhere in the repository",
        reason: "if it existed, grep would find it",
        replacement: "search by symbol instead of by import spelling",
      }),
    ],
  };
  assert.throws(
    () => validateScientistOutput(variants),
    (error: unknown) =>
      error instanceof ScientistOutputError && error.issues.some((issue) => issue.includes("restate one idea")),
  );
});

test("rejects an assumption-inversion missing its required fields", () => {
  const missingReplacement = structuredClone(validTriple);
  const third = missingReplacement.hypotheses[2] as Record<string, unknown>;
  delete third.replacement;
  assert.throws(
    () => validateScientistOutput(missingReplacement),
    (error: unknown) =>
      error instanceof ScientistOutputError && error.issues.some((issue) => issue.includes("replacement")),
  );
});

test("rejects hypotheses in the wrong class order", () => {
  const swapped = structuredClone(validTriple);
  const first = swapped.hypotheses[0] as Record<string, unknown>;
  const second = swapped.hypotheses[1] as Record<string, unknown>;
  [first.class, second.class] = [second.class, first.class];
  assert.throws(() => validateScientistOutput(swapped), ScientistOutputError);
});

test("buildScientistPrompt includes classes, clusters and budget deterministically", () => {
  const cluster: FrictionCluster = {
    id: "cluster-1",
    signals: [],
    features: { tool: "python" },
    taskCount: 3,
    occurrences: 6,
    severity: 1,
    actionable: true,
  };
  const context = {
    clusters: [cluster],
    budget: { taskUsd: 1, experimentUsd: 5, dayUsd: 20 },
    recentScores: [{ candidate: "candidate-a", score: 0.5, cost: 0.2 }],
  };
  const prompt = buildScientistPrompt(context);
  assert.ok(prompt.includes("exactly 3 falsifiable"));
  assert.ok(prompt.includes('"assumption-inversion"'));
  assert.ok(prompt.includes("cluster-1"));
  assert.ok(prompt.includes("task 1, experiment 5, day 20"));
  assert.ok(prompt.includes("candidate-a"));
  assert.equal(prompt, buildScientistPrompt(context), "prompt building is deterministic");
});
