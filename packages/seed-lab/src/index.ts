// Seed lab entry: the evolution loop (friction in, capabilities out).
//
// Purpose: single import surface for the guardian/CLI over governor,
// crystallizer, mutation runner, candidate worktrees, challenges, model
// profiler, GEPA contract, experience log, and research refresh.
// Why it exists: consumers need one stable path, not nine deep imports.
// Responsibilities: re-export only; no logic, no state.
// Invariants: no logic here — every behavior lives in its own module.
// Public functions/types: everything re-exported from the sibling modules.

export * from "./governor.ts";
export * from "./crystallizer.ts";
export * from "./mutation.ts";
export * from "./candidate.ts";
export * from "./challenges.ts";
export * from "./model-profiler.ts";
export * from "./gepa.ts";
export * from "./experience.ts";
export * from "./research.ts";
