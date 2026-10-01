// Seed lab GEPA contract: JSON client for the python seed_evolution package.
//
// Purpose: run GEPA propose/test/keep cycles over text targets (skill,
// system-prompt section, tool description, routing instruction) with a
// train/validation/holdout split where the holdout stays hidden from the mutator.
// Why it exists: GEPA evolves prompts by reflecting on traces in natural language
// (research/papers.yaml:gepa); the python package does the work, this client
// owns the split discipline and the JSON wire shape.
// Responsibilities: target validation, split construction, request serialization,
// reflection synthesis from scores.
// Invariants: holdout ids are never exposed to the mutator callback; only the
// four named targets are accepted; splits always partition the task list.
// Public types/functions: GepaTarget, GepaSplit, GepaProposal, GepaOutcome,
// buildSplit, buildRequest, summarizeReflection.

// trace:exempt reason=internal-detail
export type GepaTarget = "skill" | "system-prompt-section" | "tool-description" | "routing-instruction";

// trace:exempt reason=internal-detail
export interface GepaSplit {
  train: string[];
  validation: string[];
  holdout: string[];
}

// trace:exempt reason=internal-detail
export interface GepaProposal {
  target: GepaTarget;
  before: string;
  after: string;
  rationale: string;
  parent: string;
}

// trace:exempt reason=internal-detail
export interface GepaOutcome {
  proposal: GepaProposal;
  trainScore: number;
  validationScore: number;
  keep: boolean;
}

// trace:v1 id=impl.gepa-split work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function buildSplit(taskIds: string[], holdoutCount: number): GepaSplit {
  if (holdoutCount < 1) throw new Error("gepa split needs at least one holdout task");
  if (taskIds.length < holdoutCount + 2) throw new Error("gepa split needs train + validation + holdout tasks");
  const unique = [...new Set(taskIds)];
  if (unique.length !== taskIds.length) throw new Error("gepa split needs distinct task ids");
  const holdout = unique.slice(-holdoutCount);
  // trace:exempt reason=internal-detail
  const rest = unique.slice(0, unique.length - holdoutCount);
  // trace:exempt reason=internal-detail
  const validation = [rest[rest.length - 1] as string];
  // trace:exempt reason=internal-detail
  const train = rest.slice(0, rest.length - 1);
  return { train, validation, holdout };
}

// trace:v1 id=impl.gepa-request work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function buildRequest(
  target: GepaTarget,
  text: string,
  parent: string,
  split: GepaSplit,
): { target: GepaTarget; text: string; parent: string; train: string[]; validation: string[] } {
  // trace:exempt reason=internal-detail
  const valid: GepaTarget[] = ["skill", "system-prompt-section", "tool-description", "routing-instruction"];
  if (!valid.includes(target)) throw new Error(`unknown gepa target: ${target}`);
  if (!text) throw new Error("gepa request needs non-empty text");
  // Holdout deliberately omitted: hidden from the mutator.
  return { target, text, parent, train: [...split.train], validation: [...split.validation] };
}

// trace:v1 id=impl.gepa-reflect work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function summarizeReflection(
  proposal: GepaProposal,
  trainScore: number,
  validationScore: number,
): GepaOutcome {
  return { proposal, trainScore, validationScore, keep: validationScore > trainScore };
}
