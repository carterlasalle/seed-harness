<!-- purpose: DESIGN.md: durable Seed design (context, decision, flows, tradeoffs, risks). -->
<!-- trace:v1 id=impl.doc-design work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA -->
# Seed design

## Context

Seed evolves its own harness without corrupting its own judge.

## Decision

Split guardian (immutable Rust: RPC, store, gates, archive, promotion)
from organism (evolvable TS/Python: loop, router, capabilities, lab).
Contact crosses only NDJSON JSON-RPC (agent allowlist of 9) and the
capability JSONL ABI. `scripts/verify-boundaries.ts` enforces the split.

## Flows

- `seed run`: pin champion, rank caps (max 8), echo probe, record run.
- Evolution: friction signals, governor lanes, scientist hypotheses, GEPA
  propose/test/keep, challenges, profiler, promotion with probation.
- Eval: generated 60-task corpus with executable oracles; smoke proves
  fail-then-pass on scratch copies.

## Tradeoffs

- CLI state defaults to `~/.seed` (spec section 11); tests/CI override via
  SEED_STATE_DIR or explicit roots. Cost: two path modes. Benefit: user
  projects stay clean.
- Small kernel: `seed run` probes via echo, not a full agent turn. Full
  model loop is future work, not faked here.

## Risks

- Guardian socket/db paths follow config; operators must back up `~/.seed`.
- Corpus oracles are repair markers, not full task graders; promotion still
  needs the external gates in `docs/EVALUATION.md`.
