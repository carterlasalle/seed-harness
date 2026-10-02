/**
 * seed-core scientist: 3-hypothesis output validation and prompt building.
 *
 * Purpose: enforce the scientist contract — exactly three falsifiable
 * hypotheses, one per class (direct, cross-system, assumption-inversion), with
 * an assumption-inversion third — and build the scientist prompt from clusters,
 * budgets and recent scores.
 * Why it exists: the scientist is the lab's proposer; its output becomes
 * experiments, so a wrong shape or three restatements of one idea wastes a
 * whole cycle. Validation is mechanical and reject-first.
 * Responsibilities: envelope + per-hypothesis validation (hypothesis.ts),
 * class ordering, distinctness (pairwise statement similarity must stay below
 * 0.8), and deterministic prompt assembly.
 * Invariants: pure; validation is deterministic and order-sensitive
 * (hypotheses[2] must be the assumption-inversion); never proposes edits to
 * the guardian, eval oracles or promotion rule (stated in the prompt).
 * Public: validateScientistOutput, buildScientistPrompt, ScientistOutput,
 * ScientistContext, ScientistOutputError, SCIENTIST_CLASSES.
 */

import {
  HypothesisValidationError,
  parseImprovementHypothesis,
  // trace:exempt reason=internal-detail
  type HypothesisClass,
  // trace:exempt reason=internal-detail
  type ImprovementHypothesis,
} from "./hypothesis.ts";
import type { FrictionCluster } from "./cluster.ts";

// trace:exempt reason=internal-detail
export interface ScientistBudget {
  taskUsd: number;
  experimentUsd: number;
  dayUsd: number;
}

// trace:exempt reason=internal-detail
export interface ScientistScore {
  candidate: string;
  score: number;
  cost: number;
}

// trace:exempt reason=internal-detail
export interface ScientistContext {
  clusters: readonly FrictionCluster[];
  budget: ScientistBudget;
  recentScores: readonly ScientistScore[];
}

// trace:exempt reason=internal-detail
export interface ScientistOutput {
  hypotheses: ImprovementHypothesis[];
}

// trace:exempt reason=internal-detail
export const SCIENTIST_CLASSES: readonly HypothesisClass[] = [
  "direct",
  "cross-system",
  "assumption-inversion",
];

// trace:exempt reason=internal-detail
export const SCIENTIST_MAX_STATEMENT_SIMILARITY = 0.8;

// trace:v1 id=impl.sc-scientist-call work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export async function runScientistModel(
  prompt: string,
  callModel: (prompt: string) => Promise<unknown>,
): Promise<{ output: ScientistOutput; raw: unknown }> {
  // trace:exempt reason=internal-detail
  const raw = await callModel(prompt);
  return { output: validateScientistOutput(raw), raw };
}

// trace:v1 id=impl.sc-scientist-error work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export class ScientistOutputError extends Error {
  readonly issues: string[];

  // trace:exempt reason=internal-detail
  constructor(issues: string[]) {
    super(`invalid scientist output: ${issues.join("; ")}`);
    this.name = "ScientistOutputError";
    this.issues = issues;
  }
}

// trace:exempt reason=internal-detail
function statementTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1),
  );
}

// trace:exempt reason=internal-detail
function statementSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  // trace:exempt reason=internal-detail
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  // trace:exempt reason=internal-detail
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

// trace:v1 id=impl.sc-scientist-validate work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function validateScientistOutput(output: unknown): ScientistOutput {
  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    throw new ScientistOutputError(["output must be a JSON object"]);
  }
  const raw = (output as Record<string, unknown>)["hypotheses"];
  if (!Array.isArray(raw) || raw.length !== 3) {
    throw new ScientistOutputError([
      `exactly 3 hypotheses are required (got ${Array.isArray(raw) ? raw.length : "none"})`,
    ]);
  }

  // trace:exempt reason=internal-detail
  const issues: string[] = [];
  // trace:exempt reason=internal-detail
  const hypotheses: ImprovementHypothesis[] = [];
  raw.forEach((entry, index) => {
    try {
      hypotheses.push(parseImprovementHypothesis(entry));
    } catch (error) {
      if (error instanceof HypothesisValidationError) {
        for (const issue of error.issues) issues.push(`hypotheses[${index}]: ${issue}`);
        return;
      }
      throw error;
    }
  });

  hypotheses.forEach((hypothesis, index) => {
    // trace:exempt reason=internal-detail
    const expected = SCIENTIST_CLASSES[index];
    if (expected !== undefined && hypothesis.class !== expected) {
      issues.push(`hypotheses[${index}] must have class "${expected}" (got ${hypothesis.class ?? "none"})`);
    }
  });

  // trace:exempt reason=internal-detail
  const tokens = hypotheses.map((hypothesis) => statementTokens(hypothesis.statement));
  for (let left = 0; left < tokens.length; left += 1) {
    for (let right = left + 1; right < tokens.length; right += 1) {
      // trace:exempt reason=internal-detail
      const leftTokens = tokens[left];
      // trace:exempt reason=internal-detail
      const rightTokens = tokens[right];
      if (leftTokens === undefined || rightTokens === undefined) continue;
      // trace:exempt reason=internal-detail
      const similarity = statementSimilarity(leftTokens, rightTokens);
      if (similarity >= SCIENTIST_MAX_STATEMENT_SIMILARITY) {
        issues.push(
          `hypotheses[${left}] and hypotheses[${right}] restate one idea (similarity ${similarity.toFixed(2)})`,
        );
      }
    }
  }

  if (issues.length > 0) throw new ScientistOutputError(issues);
  return { hypotheses };
}

// trace:exempt reason=internal-detail
function compareClusters(a: FrictionCluster, b: FrictionCluster): number {
  if (a.severity !== b.severity) return a.severity > b.severity ? -1 : 1;
  if (a.occurrences !== b.occurrences) return a.occurrences > b.occurrences ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

// trace:v1 id=impl.sc-scientist-prompt work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function buildScientistPrompt(context: ScientistContext): string {
  const lines: string[] = [];
  lines.push("You are the Seed scientist. Propose exactly 3 falsifiable improvement hypotheses — no more, no fewer.");
  lines.push("");
  lines.push("Classes, in order:");
  lines.push('1. "direct" — a fix or simplification aimed straight at the strongest cluster evidence.');
  lines.push('2. "cross-system" — a change in one subsystem that explains friction observed in another.');
  lines.push('3. "assumption-inversion" — names an assumption the harness makes (assumption), why it is suspect (reason), and the replacement behavior (replacement).');
  lines.push("");
  lines.push("Rules:");
  lines.push("- Every hypothesis needs statement, prediction and falsification: name the observation that would refute it.");
  lines.push("- Rank by expected score-per-cost; do not pad with restatements of one idea.");
  lines.push("- Never propose editing the guardian, the eval oracles, or the promotion rule.");
  lines.push("- Output JSON only: {\"hypotheses\": [h1, h2, h3]} with fields id, statement, prediction, falsification, status, class, and (H3) assumption, reason, replacement.");
  lines.push("");
  lines.push("Friction clusters:");
  // trace:exempt reason=internal-detail
  const clusters = [...context.clusters].sort(compareClusters);
  if (clusters.length === 0) lines.push("- (none yet)");
  for (const cluster of clusters) {
    // trace:exempt reason=internal-detail
    const features = Object.entries(cluster.features)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    lines.push(
      `- ${cluster.id}: severity ${cluster.severity}, tasks ${cluster.taskCount}, occurrences ${cluster.occurrences}${features === "" ? "" : `, ${features}`}`,
    );
  }
  lines.push("");
  lines.push(
    `Budget remaining (USD): task ${context.budget.taskUsd}, experiment ${context.budget.experimentUsd}, day ${context.budget.dayUsd}.`,
  );
  lines.push("");
  lines.push("Recent scores (candidate: score, cost):");
  // trace:exempt reason=internal-detail
  const scores = [...context.recentScores].sort((a, b) => (a.candidate < b.candidate ? -1 : a.candidate > b.candidate ? 1 : 0));
  if (scores.length === 0) lines.push("- (none yet)");
  for (const score of scores) {
    lines.push(`- ${score.candidate}: score ${score.score}, cost ${score.cost}`);
  }
  return lines.join("\n");
}
