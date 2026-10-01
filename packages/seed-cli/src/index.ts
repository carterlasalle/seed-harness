// seed-cli index: public entry re-exporting every command module.
//
// Purpose: the package entry so tests and embedders import one path. Why it
// exists: keeps `src/index.ts` the stable surface while logic lives in
// per-command modules. Responsibilities: re-export state, capabilities,
// doctor, run, evolve, eval, models, champion, research, cli. Invariants:
// pure barrel — no logic, no side effects. Public functions/types: every
// export of the command modules.

export * from "./state.ts";
export * from "./capabilities.ts";
export * from "./doctor.ts";
export * from "./run.ts";
export * from "./evolve.ts";
export * from "./eval.ts";
export * from "./models.ts";
export * from "./champion.ts";
export * from "./research.ts";
export * from "./cli.ts";
export * from "./schema.ts";
