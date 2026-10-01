/**
 * hypothesis.test.ts — improvement hypothesis schema + risk map.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  defaultRiskFor,
  HYPOTHESIS_RISK_MAP,
  HypothesisValidationError,
  parseImprovementHypothesis,
} from "./hypothesis.ts";

const minimal = {
  id: "h1",
  statement: "Retry the flaky compile step.",
  prediction: "Compile loops drop below one per task.",
  falsification: "Compile loops still repeat with the retry in place.",
  status: "open",
};

test("parses a minimal hypothesis and defaults risk by class", () => {
  const hypothesis = parseImprovementHypothesis(minimal);
  assert.equal(hypothesis.class, null);
  assert.equal(hypothesis.risk, "high", "unclassified hypotheses default to high risk");
  assert.equal(hypothesis.assumption, null);

  const direct = parseImprovementHypothesis({ ...minimal, class: "direct" });
  assert.equal(direct.risk, "low");
  const crossSystem = parseImprovementHypothesis({ ...minimal, class: "cross-system" });
  assert.equal(crossSystem.risk, "medium");
});

test("HYPOTHESIS_RISK_MAP and defaultRiskFor agree", () => {
  assert.deepEqual(HYPOTHESIS_RISK_MAP, {
    direct: "low",
    "cross-system": "medium",
    "assumption-inversion": "high",
  });
  assert.equal(defaultRiskFor("assumption-inversion"), "high");
  assert.equal(defaultRiskFor(null), "high");
});

test("requires prediction and falsification", () => {
  assert.throws(
    () => parseImprovementHypothesis({ ...minimal, falsification: "" }),
    (error: unknown) => error instanceof HypothesisValidationError && error.issues.some((issue) => issue.includes("falsification")),
  );
  assert.throws(() => parseImprovementHypothesis({ ...minimal, prediction: undefined }), HypothesisValidationError);
});

test("assumption-inversion requires assumption, reason and replacement", () => {
  assert.throws(
    () => parseImprovementHypothesis({ ...minimal, class: "assumption-inversion" }),
    (error: unknown) =>
      error instanceof HypothesisValidationError &&
      ["assumption", "reason", "replacement"].every((field) => error.issues.some((issue) => issue.includes(field))),
  );
  const complete = parseImprovementHypothesis({
    ...minimal,
    class: "assumption-inversion",
    assumption: "python3 is on PATH",
    reason: "images may ship other layouts",
    replacement: "resolve the interpreter from the manifest",
  });
  assert.equal(complete.risk, "high");
});

test("rejects unknown fields and bad enums", () => {
  assert.throws(() => parseImprovementHypothesis({ ...minimal, extra: 1 }), HypothesisValidationError);
  assert.throws(() => parseImprovementHypothesis({ ...minimal, status: "maybe" }), HypothesisValidationError);
  assert.throws(() => parseImprovementHypothesis({ ...minimal, class: "vibes" }), HypothesisValidationError);
});
