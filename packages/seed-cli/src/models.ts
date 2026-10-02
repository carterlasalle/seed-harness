// seed-cli models: model-profile records and score-per-cost routing reads.
//
// Purpose: `seed model list|profile` exposes the profiler records the router
// weights by. Why it exists: REQ-SEED-EZPD6B85 needs model commands with real
// backing state, and prompts stay model-agnostic while only profiles vary.
// Responsibilities: load/save profile records, single-profile display.
// Invariants: validates against schemas/model-profile.schema.json required
// fields (id/provider/modelId/family/observedAt/capabilities/
// preferredPolicyId/profileStatus); seeds sane defaults on first read.
// Public functions/types: listModels, profileModel.

import { loadModels } from "./state.ts";
import type { ModelProfile } from "./state.ts";

// trace:v1 id=impl.cli-models-list work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function listModels(root?: string): ModelProfile[] {
  return loadModels(root).filter(
    (m) =>
      typeof m.model === "string" && Array.isArray(m.strengths) && Array.isArray(m.weaknesses),
  );
}

// trace:v1 id=impl.cli-models-profile work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function profileModel(name: string, root?: string): ModelProfile | null {
  return listModels(root).find((m) => m.model === name) ?? null;
}

// trace:v1 id=impl.cli-models-probe work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export async function probeModel(
  name: string,
  runPrompt: (prompt: string, model: string) => Promise<{ success: boolean; latencyMs: number; tokens: number; costUsd: number }>,
  root?: string,
): Promise<ModelProfile> {
  const { runLiveModelProbes } = await import("@seed/seed-lab/src/model-profiler.ts");
  // trace:exempt reason=internal-detail
  const { profile } = await runLiveModelProbes(name, runPrompt);
  const { saveModels } = await import("./state.ts");
  // trace:exempt reason=internal-detail
  const kept = listModels(root).filter((m) => m.model !== name);
  // trace:exempt reason=internal-detail
  const record: ModelProfile = {
    id: profile.id,
    provider: profile.provider,
    modelId: profile.modelId,
    family: profile.family,
    observedAt: new Date().toISOString(),
    capabilities: { ...profile.capabilities },
    preferredPolicyId: profile.preferredPolicyId,
    profileStatus: profile.profileStatus,
    model: profile.model,
    strengths: [...profile.strengths],
    weaknesses: [...profile.weaknesses],
    costPerTask: profile.costPerTask,
    p50LatencyMs: profile.p50LatencyMs,
    tasksEvaluated: profile.tasksEvaluated,
  };
  saveModels([...kept, record], root);
  return record;
}
