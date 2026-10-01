/**
 * seed-core improvement hypotheses: schema, validation, risk map.
 *
 * Purpose: one typed representation of a scientist/mutation hypothesis
 * (spec section 59) plus the class -> risk mapping used when ranking them.
 * Why it exists: hypotheses cross from a model's output into experiments and
 * eval decisions, so shape and distinctness are validated at the boundary;
 * risk must be a function of the hypothesis class, not a self-assessment.
 * Responsibilities: validate/normalize {id, statement, prediction,
 * falsification, status, class, risk, assumption, reason, replacement};
 * require assumption/reason/replacement for assumption-inversion hypotheses;
 * provide the class -> risk map and the default risk resolver.
 * Invariants: pure; unknown fields are rejected (except `x-*`); prediction and
 * falsification are always required (a hypothesis without a refutation is not
 * testable); resolved risk is always one of low/medium/high.
 * Public: parseImprovementHypothesis, ImprovementHypothesis, HypothesisClass,
 * HypothesisStatus, RiskLevel, HYPOTHESIS_RISK_MAP, defaultRiskFor,
 * HypothesisValidationError.
 */

// trace:exempt reason=internal-detail
export type HypothesisClass = "direct" | "cross-system" | "assumption-inversion";
// trace:exempt reason=internal-detail
export type HypothesisStatus = "open" | "supported" | "refuted";
// trace:exempt reason=internal-detail
export type RiskLevel = "low" | "medium" | "high";

// trace:exempt reason=internal-detail
export interface ImprovementHypothesis {
  id: string;
  statement: string;
  prediction: string;
  falsification: string;
  status: HypothesisStatus;
  class: HypothesisClass | null;
  risk: RiskLevel;
  assumption: string | null;
  reason: string | null;
  replacement: string | null;
}

// trace:exempt reason=internal-detail
export const HYPOTHESIS_RISK_MAP: Record<HypothesisClass, RiskLevel> = {
  direct: "low",
  "cross-system": "medium",
  "assumption-inversion": "high",
};

// trace:exempt reason=internal-detail
const HYPOTHESIS_KEYS: Record<string, true> = {
  id: true,
  statement: true,
  prediction: true,
  falsification: true,
  status: true,
  class: true,
  risk: true,
  assumption: true,
  reason: true,
  replacement: true,
};

// trace:exempt reason=internal-detail
const STATUS_VALUES: Record<string, true> = { open: true, supported: true, refuted: true };
// trace:exempt reason=internal-detail
const CLASS_VALUES: Record<string, true> = {
  direct: true,
  "cross-system": true,
  "assumption-inversion": true,
};
// trace:exempt reason=internal-detail
const RISK_VALUES: Record<string, true> = { low: true, medium: true, high: true };

// trace:v1 id=impl.sc-hypothesis-error work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export class HypothesisValidationError extends Error {
  readonly issues: string[];

  // trace:exempt reason=internal-detail
  constructor(issues: string[]) {
    super(`invalid hypothesis: ${issues.join("; ")}`);
    this.name = "HypothesisValidationError";
    this.issues = issues;
  }
}

// trace:v1 id=impl.sc-hypothesis-risk work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function defaultRiskFor(hypothesisClass: HypothesisClass | null): RiskLevel {
  return hypothesisClass === null ? "high" : HYPOTHESIS_RISK_MAP[hypothesisClass];
}

// trace:exempt reason=internal-detail
function readRequiredString(
  source: Record<string, unknown>,
  key: string,
  issues: string[],
): string | null {
  // trace:exempt reason=internal-detail
  const value = source[key];
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`field "${key}" must be a non-empty string`);
    return null;
  }
  return value.trim();
}

// trace:exempt reason=internal-detail
function readOptionalField(source: Record<string, unknown>, key: string, issues: string[]): string | null {
  // trace:exempt reason=internal-detail
  const value = source[key];
  if (value === undefined) return null;
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`field "${key}" must be a non-empty string when present`);
    return null;
  }
  return value.trim();
}

// trace:v1 id=impl.sc-hypothesis-parse work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function parseImprovementHypothesis(input: unknown): ImprovementHypothesis {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new HypothesisValidationError(["hypothesis must be a JSON object"]);
  }
  const source = input as Record<string, unknown>;
  const issues: string[] = [];
  // trace:exempt reason=internal-detail
  for (const key of Object.keys(source)) {
    if (!Object.hasOwn(HYPOTHESIS_KEYS, key) && !key.startsWith("x-")) {
      issues.push(`unknown field "${key}" in hypothesis`);
    }
  }

  // trace:exempt reason=internal-detail
  const id = readRequiredString(source, "id", issues);
  // trace:exempt reason=internal-detail
  const statement = readRequiredString(source, "statement", issues);
  // trace:exempt reason=internal-detail
  const prediction = readRequiredString(source, "prediction", issues);
  // trace:exempt reason=internal-detail
  const falsification = readRequiredString(source, "falsification", issues);

  // trace:exempt reason=internal-detail
  const statusValue = source["status"];
  if (typeof statusValue !== "string" || !Object.hasOwn(STATUS_VALUES, statusValue)) {
    issues.push('field "status" must be "open", "supported" or "refuted"');
  }

  // trace:exempt reason=internal-detail
  const classValue = source["class"];
  // trace:exempt reason=internal-detail
  let hypothesisClass: HypothesisClass | null = null;
  if (classValue !== undefined) {
    if (typeof classValue !== "string" || !Object.hasOwn(CLASS_VALUES, classValue)) {
      issues.push('field "class" must be "direct", "cross-system" or "assumption-inversion"');
    } else {
      hypothesisClass = classValue as HypothesisClass;
    }
  }

  // trace:exempt reason=internal-detail
  const assumption = readOptionalField(source, "assumption", issues);
  // trace:exempt reason=internal-detail
  const reason = readOptionalField(source, "reason", issues);
  // trace:exempt reason=internal-detail
  const replacement = readOptionalField(source, "replacement", issues);
  if (hypothesisClass === "assumption-inversion") {
    if (assumption === null) issues.push('assumption-inversion hypotheses require "assumption"');
    if (reason === null) issues.push('assumption-inversion hypotheses require "reason"');
    if (replacement === null) issues.push('assumption-inversion hypotheses require "replacement"');
  }

  // trace:exempt reason=internal-detail
  const riskValue = source["risk"];
  if (riskValue !== undefined && (typeof riskValue !== "string" || !Object.hasOwn(RISK_VALUES, riskValue))) {
    issues.push('field "risk" must be "low", "medium" or "high"');
  }

  if (issues.length > 0) throw new HypothesisValidationError(issues);

  return {
    id: id ?? "",
    statement: statement ?? "",
    prediction: prediction ?? "",
    falsification: falsification ?? "",
    status: (statusValue as HypothesisStatus | undefined) ?? "open",
    class: hypothesisClass,
    risk: (riskValue as RiskLevel | undefined) ?? defaultRiskFor(hypothesisClass),
    assumption,
    reason,
    replacement,
  };
}
