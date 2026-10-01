// Seed lab mutation agent: one-variable runner with phase gate and risk map.
//
// Purpose: execute a single-organism-variable mutation through
// inspect > implement > test > commit, stopping at the first failing phase,
// and emit the candidate-report.json payload for the guardian to evaluate.
// Why it exists: per prompts/mutation-agent.md, mutations stay small, reversible
// (parent ref always recorded), and guardian-boundary touches are rejected
// before evaluation burns budget.
// Responsibilities: risk classification, ordered phase execution, report shape.
// Invariants: exactly one variable per report; phases run in fixed order and
// short-circuit on failure; a "reject" risk never reaches the test phase.
// Public types/functions: MutationRisk, MutationRequest, MutationStepResult,
// MutationReport, riskForChange, runMutationAgent, serializeMutationReport.

// trace:exempt reason=internal-detail
export type MutationRisk = "low" | "medium" | "high" | "reject";

// trace:exempt reason=internal-detail
export type MutationPhase = "inspect" | "implement" | "test" | "commit";

// trace:exempt reason=internal-detail
export interface MutationRequest {
  parent: string;
  change: string;
  rationale: string;
  predictedEffect: string;
}

// trace:exempt reason=internal-detail
export interface MutationStepResult {
  phase: MutationPhase;
  ok: boolean;
  detail: string;
}

// trace:exempt reason=internal-detail
export interface MutationReport extends MutationRequest {
  risk: MutationRisk;
  steps: MutationStepResult[];
  reportPath: string;
}

// trace:v1 id=impl.mutation-risk work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function riskForChange(change: string): MutationRisk {
  if (/guardian|eval.{0,8}oracle|promotion rule|champion\.promote|gate\.override/i.test(change)) return "reject";
  if (/router weight|prompt fragment|tool default/i.test(change)) return "low";
  if (/system prompt|routing|capabilit/i.test(change)) return "medium";
  return "high";
}

// trace:v1 id=impl.mutation-run work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function runMutationAgent(
  request: MutationRequest,
  phases: Record<MutationPhase, () => Omit<MutationStepResult, "phase">>,
): MutationReport {
  const risk = riskForChange(request.change);
  const order: MutationPhase[] = ["inspect", "implement", "test", "commit"];
  // trace:exempt reason=internal-detail
  const steps: MutationStepResult[] = [];
  for (const phase of order) {
    if (risk === "reject" && (phase === "test" || phase === "commit")) {
      steps.push({ phase, ok: false, detail: "skipped: change touches guardian boundary" });
      break;
    }
    // trace:exempt reason=internal-detail
    const result = phases[phase]();
    steps.push({ phase, ...result });
    if (!result.ok) break;
  }
  return { ...request, risk, steps, reportPath: "candidate-report.json" };
}

// trace:v1 id=impl.mutation-serialize work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function serializeMutationReport(report: MutationReport): string {
  return JSON.stringify(report, null, 2);
}
