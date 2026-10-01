<!-- purpose: ADR 0001: records the immutable-guardian versus evolvable-organism split decision and its consequences. -->
# ADR 0001: guardian/organism split

<!-- trace:v1 id=impl.adr-0001 work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA -->
Status: accepted. Date: 2026-10-01.

Context: a self-evolving harness must improve itself without corrupting its
own judge. One codebase that both evolves and evaluates can learn to cheat
(edit oracles, weaken gates, promote itself).

Decision: split into an immutable guardian (Rust, `crates/seed-guardian`:
evaluation, archive, champion pointer, rollback) and an evolvable organism
(TS + Python: prompts, router, capabilities, lab loop). The guardian owns
gates, budgets, and promotion; the organism owns everything else.

Consequences: all cross-boundary contact goes through `hello`/`task`/
`telemetry` RPC plus the capability JSONL ABI; `scripts/verify-boundaries.ts`
enforces the split in CI; evolution velocity is bounded by gate cost, which
is the intended safety price.
