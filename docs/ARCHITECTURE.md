<!-- purpose: ARCHITECTURE.md: one-page map of the guardian/organism split, packages, stores, boundaries, and pointers to detail docs. -->
# Seed architecture

<!-- trace:v1 id=impl.doc-architecture work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA -->
Guardian (Rust, `crates/seed-guardian`) is immutable: JSON-RPC
`hello`/`task`/`telemetry`, SQLite WAL store, worktrees, gates, Pareto
archive, champion pointer, rollback. Organism (TS `packages/*` + Python
`python/seed_evolution`) is evolvable: one `python` primitive, capability
registry + BM25 router (max 8), lab loop (friction, governor, scientist,
crystallizer, mutation, challenges, profiler). Boundary enforced by
`scripts/verify-boundaries.ts`; research catalog validated by
`scripts/seed-research-catalog.py`. Upstream pin and wrap decision:
`docs/BASELINE.md`. Split rationale: `docs/adr/0001-guardian-organism-split.md`.
