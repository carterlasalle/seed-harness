// seed-cli models: model-profile records and score-per-cost routing reads.
//
// Purpose: `seed model list|profile` exposes the profiler records the router
// weights by. Why it exists: REQ-SEED-EZPD6B85 needs model commands with real
// backing state, and prompts stay model-agnostic while only profiles vary.
// Responsibilities: load/save profile records, single-profile display.
// Invariants: validates against schemas/model-profile.schema.json required
// fields (model, strengths, weaknesses); seeds sane defaults on first read.
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
