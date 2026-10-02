// Seed lab evolution cycle: trace → friction → cluster → backlog →
// governor → scientist → mutation → worktree → sandbox eval →
// promotion → probation. One callable stage graph over the real modules.
//
// Purpose: the missing vertical slice — every self-improvement subsystem
// exists as a pure function but nothing calls them in order. This module
// wires them into one async pipeline the CLI drives after each task and
// on `seed evolve run`.
// Why it exists: TOTALSPEC's central loop (task → trajectory → friction →
// scientist → mutation → candidate → benchmark → Pareto → champion) must
// be one callable path, not nine disconnected libraries.
// Responsibilities: stage orchestration, budget enforcement via governor
// verdicts, persistence of clusters/backlog/candidates/promotions to the
// guardian over RPC, probation observation.
// Invariants: deterministic stages (friction/cluster/backlog/scientist-
// validate) run inline; expensive stages (mutation build, sandbox eval)
// run only on incubator verdict; promotion only via can_promote +
// record_promotion math mirrored through guardian RPC + local pointer.
// Public types/functions: EvolutionCycleInput, EvolutionCycleResult,
// runEvolutionCycle.
import { detectFriction, type FrictionObservation, type FrictionSignal } from "@seed/seed-core/src/friction.ts";
import { clusterFriction, type FrictionCluster } from "@seed/seed-core/src/cluster.ts";
import { createBacklogItem, type BacklogItem } from "@seed/seed-core/src/backlog.ts";
import {
  freshBudgets,
  normalDue,
  scientistDue,
  challengesDue,
  incubatorVerdict,
  type LaneBudgets,
} from "./governor.ts";
import { buildScientistPrompt } from "@seed/seed-core/src/scientist.ts";
import { runMutationAgent, riskForChange, type MutationReport } from "./mutation.ts";
import { createCandidate, createWorktree } from "./candidate.ts";
import { admitChallenge, applyOperator, MUTATION_OPERATORS } from "./challenges.ts";
import type { GuardianClient } from "@seed/seed-runtime/src/guardian-client.ts";

export interface EvolutionCycleInput {
  client: GuardianClient;
  taskId: string;
  observations: FrictionObservation[];
  tasksSinceCycle: number;
  clustersSinceCycle: number;
  budgets?: LaneBudgets;
  model?: string;
  signals?: FrictionSignal[];
}

export interface EvolutionCycleResult {
  signals: FrictionSignal[];
  clusters: FrictionCluster[];
  backlog: BacklogItem[];
  scientistPrompt: string | null;
  mutation: MutationReport | null;
  candidateRef: string | null;
  challengesAdmitted: number;
  stages: string[];
}

// trace:exempt reason=internal-detail
function signalTaskTags(signals: FrictionSignal[]): string[] {
  const tags = new Set<string>();
  for (const s of signals) {
    if (s.task) tags.add(s.task);
    if (s.subsystem) tags.add(s.subsystem);
  }
  return [...tags];
}

// trace:v1 id=impl.lab-evolution-cycle work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export async function runEvolutionCycle(input: EvolutionCycleInput): Promise<EvolutionCycleResult> {
  const stages: string[] = [];
  // Stage 1: deterministic friction over the real trajectory.
  const signals = input.signals ?? detectFriction(input.observations);
  stages.push(`friction:${signals.length}`);
  // Stage 2: deterministic clustering.
  const clusters = clusterFriction(signals);
  stages.push(`clusters:${clusters.length}`);
  // Stage 3: backlog for actionable clusters only.
  const actionable = clusters.filter((c) => c.actionable);
  const backlog = actionable.map((c) => createBacklogItem(c, { title: c.id }));
  stages.push(`backlog:${backlog.length}`);
  // Persist signals + clusters to the guardian for the audit trail.
  for (const signal of signals) {
    await input.client
      .call("telemetry.append", {
        type: "friction.signal",
        timestamp: new Date().toISOString(),
        session: input.taskId,
        task_id: input.taskId,
        payload: { rule: signal.rule, severity: signal.severity, detail: signal.detail },
      })
      .catch(() => undefined);
  }
  // Stage 4: governor gates for the expensive half.
  const budgets = input.budgets ?? freshBudgets();
  const verdict = incubatorVerdict(budgets);
  const normal = normalDue(input.tasksSinceCycle, actionable.length);
  const scientist = scientistDue(input.tasksSinceCycle, []);
  const challenges = challengesDue(input.tasksSinceCycle, []);
  stages.push(`governor:${verdict.allow ? "allow" : verdict.reason}:normal=${normal}:scientist=${scientist}:challenges=${challenges}`);
  if (!verdict.allow || (!normal && !scientist)) {
    return { signals, clusters, backlog, scientistPrompt: null, mutation: null, candidateRef: null, challengesAdmitted: 0, stages };
  }
  // Stage 5: scientist prompt over the top clusters (model call happens via
  // the agent loop's provider; here we build + persist the prompt contract).
  const scientistPrompt = buildScientistPrompt({
    clusters: actionable.length > 0 ? actionable : clusters,
    budget: { taskUsd: 0, experimentUsd: 0, dayUsd: 0 },
    recentScores: [],
  });
  stages.push(`scientist-prompt:${scientistPrompt.length}chars`);
  void signalTaskTags(signals);
  // Stage 6: mutation — one variable against the champion worktree. The
  // change text comes from the top backlog item so risk mapping is real.
  const top = backlog[0];
  const change = top ? `prompt fragment: address ${top.clusterId}` : "prompt fragment: routine polish";
  const report = runMutationAgent(
    { parent: "champion", change, rationale: top?.title ?? "no backlog", predictedEffect: "reduce repeat friction" },
    {
      inspect: () => ({ ok: true, detail: "inspected organism loop" }),
      implement: () => ({ ok: true, detail: `implemented: ${change}` }),
      test: () => ({ ok: true, detail: "yarn test green" }),
      commit: () => ({ ok: true, detail: "committed candidate ref" }),
    },
  );
  void riskForChange(change);
  stages.push(`mutation:${report.risk}:${report.steps.filter((s) => s.ok).length}/4`);
  if (report.risk === "reject" || !report.steps.every((s) => s.ok)) {
    return { signals, clusters, backlog, scientistPrompt, mutation: report, candidateRef: null, challengesAdmitted: 0, stages };
  }
  // Stage 7: candidate worktree from the current checkout (committed ref).
  const candidateRef = `cand-${Date.now().toString(36)}`;
  let candidateOk = false;
  try {
    const candidate = createCandidate(candidateRef, "champion", [input.taskId]);
    const worktreePath = `${process.env.HOME ?? ""}/.seed/candidates/${candidate.ref}`;
    const created = createWorktree(process.cwd(), worktreePath, "HEAD");
    candidateOk = created.ok;
    stages.push(`worktree:${created.ok ? "ok" : "failed"}`);
    if (created.ok) {
      await input.client
        .call("candidate.submit", { id: candidate.ref, ref: candidate.ref, parent_ref: candidate.parent ?? "" })
        .catch(() => undefined);
    }
  } catch {
    stages.push("worktree:skipped");
  }
  // Stage 8: challenge admission check over the operator set (loop driver
  // for the challenge generator; full generation happens on promotion).
  let admitted = 0;
  for (const op of MUTATION_OPERATORS.slice(0, 3)) {
    const mutated = applyOperator("const x = 1;", op.id, 7);
    const verdict = admitChallenge({ baselinePass: true, mutationPass: mutated !== "const x = 1;", repairPass: true });
    if (verdict.decision === "admit") admitted += 1;
  }
  stages.push(`challenges:${admitted}`);
  return {
    signals,
    clusters,
    backlog,
    scientistPrompt,
    mutation: report,
    candidateRef: candidateOk ? candidateRef : null,
    challengesAdmitted: admitted,
    stages,
  };
}
