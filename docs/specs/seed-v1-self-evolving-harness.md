# Seed v1 self-evolving harness

<!-- trace:v1 id=SPEC-SEED-XK673WRX type=spec work=WORK-SEED-6VF90M7B -->

## Problem

Coding harnesses hard-code mechanisms; need self-evolving harness with immutable evaluator

## Goals

V1 sections 1-24 (traced where implemented):

- §0 Normative language: MUST/SHOULD/MAY bind implementation (see AGENTS.md immutable core).
- §1 Product definition: Guardian (immutable judge) / Organism (evolvable TS+Python) / Lab (evolution) / Champion / Candidate / Archive (see CONTEXT.md, ADR-0001).
- §2 Why Seed exists: small-kernel Pi-shaped loop; mechanisms enter as evaluated candidates (see BASELINE.md, research/harnesses.yaml).
- §3 Goals G1-G10: python primitive, runtime synthesis, durable capabilities, self-modification in worktrees, external evaluation, improvement pressure, foreground priority, open-ended discovery, model adaptation, Pareto optimization.
- §4 Non-goals: no weight training, no distributed consensus, no remote exec outside sandbox, no hot-swap, no global installs, no exposed eval internals.
- §5 Research basis: GEPA / Hermes / DGM / ADAS / LATM / SkillWeaver / AWM / Reflexion / Toolformer / Gödel (see research/*.yaml).
- §6 Architecture: CLI > Guardian (Rust RPC+SQLite) > Organism (TS/Python) > capability host (see ARCHITECTURE.md).
- §7 Language responsibilities: TS owns Organism, Rust owns Guardian, Python owns optimization/research (see Codex #7).
- §8 Repository strategy: Pi pin d6af72e (see BASELINE.md).
- §9 Repository layout: packages/seed-{core,runtime,lab,cli}, crates/seed-guardian, python/seed_evolution, capabilities/, evals/, research/, prompts/, schemas/.
- §10 Package management: yarn 4 / uv / cargo with lockfiles.
- §11 Runtime state: ~/.seed outside the repo (see ADR-0002).
- §12 Trust boundary: guardian sees oracles+lineage; organism sees workspace+limited RPC (see SECURITY.md).
- §13-15 Guardian process + RPC + hello: seed-guardian socket, 1MiB cap, protocol_version 1, champion pin per session.
- §16-18 Champion + candidates: pinned sha per session, git worktrees for committed refs, CandidateMetadata lineage.
- §19-20 Bootstrap tool: python only on day 1; cwd-confined, timeouts, truncation, telemetry.
- §21-27 Capabilities: manifest schema, JSONL ABI, registry, max-8 BM25 router, ephemeral under $SEED_SCRATCH.
- §28-29 Crystallization: >=5 uses / >=3 tasks / utility>=0.80 triggers proposal, never auto-promotes.
- §30-37 Skills/hooks/MCP/LSP/policies/codecs/edit-protocols: metadata-only skills, fatal-or-continue hooks, MCP initialize handshake, LSP adapter ops, model policies, JSON/summary/retrieval codecs, full-file/search-replace/unified-diff/hasline edits.
- §38-46 Telemetry/friction/backlog/governor: evidence levels, trace hierarchy, friction signals, deterministic clustering, backlog ordering, inline<=30s + post-task<=5s + incubator budgets.
- §47-56 Incubator/cycle/layers/distillation: post-task reflection, incubator gates, full evolution cycle, fast/medium/slow/very-slow layers, experience distillation.
- §57-60 GEPA/DGM/ADAS: propose/test/keep with held-out scoring, Pareto archive, code-level mutations.
- §61-70 Scientist/mutation/eval/promotion: 3-hypothesis validation, one-variable mutation with risk gate, worktree+sandbox eval, non-inferiority + Pareto gain, 10-task/2-strike probation, rollback.
- §71-76 Model characterization: 12-probe profiler, provisional until 10 tasks, cost-cap scaffolding drop, per-model policy routing.
- §77-80 Challenges/replay/hidden/cross-model: mutation-operator challenges with triple-check admission, holdout slice, replay of prior failures, cross-model runs.
- §81-84 Context/edit competition: codec competition set, edit-format detection, per-model assignment.
- §85 Model registry: schema-validated profiles backing seed model list/profile/probe.
- §86-92 Prompts/CLI/eval-smoke: task-agent parts, seed run/evolve/eval/champion/research/schema/doctor commands, 2-task smoke contract.
- §93-94 Research catalog: hashline + snapcompact refs enforced by validator.
- §95-99 Sessions/scratch/ephemeral: session pin, scratch roots, ephemeral tracking of every python turn.
- §100-106 State/metrics/costs: JSON state shapes, pass-rate metrics, token/cost accounting, budget tripwires.
- §107-113 Errors/failure modes: fail-closed provider errors, oracle failure detail, rollback on probation strikes.
- §114-119 Security/invariants: boundary gate, permission declarations, sandbox (CPU 4/mem 8g/pids 512/net off), determinism (seed 1337).
- §120-126 Rollout/docs/debt: CI gates + eval smoke + doctor, ADRs, work-item tracking, no invented compatibility shims.

## Non-goals

Weight training, distributed consensus, custom inference (spec section 4)

## Test strategy

cargo test, node --test, pytest, eval smoke, security invariant tests

## Requirements

### Guardian trusted evaluator

<!-- trace:v1 id=REQ-SEED-N5PYP0GA type=requirement work=WORK-SEED-6VF90M7B derived_from=SPEC-SEED-XK673WRX -->

Guardian Rust daemon exposes JSON-RPC hello/task/telemetry, persists SQLite WAL, manages worktrees, gates, Pareto archive, champion pointer, rollback

Acceptance:

- cargo test passes

- handshake + task + telemetry roundtrip works

### Python-only bootstrap organism

<!-- trace:v1 id=REQ-SEED-YM8XJREE type=requirement work=WORK-SEED-6VF90M7B derived_from=SPEC-SEED-XK673WRX -->

Organism exposes single python primitive with cwd confinement, timeouts, output truncation, telemetry, session-pinned champion, ephemeral tracking

Acceptance:

- python tool tests pass incl traversal/timeout/truncation

### Capability registry and router

<!-- trace:v1 id=REQ-SEED-AJZXZFBN type=requirement work=WORK-SEED-6VF90M7B derived_from=SPEC-SEED-XK673WRX -->

Capability packages validate against schema, discover/activate/start/stop, process ABI isolation, BM25 bounded visibility max 8

Acceptance:

- fixture echo capability installs executes unloads

- router never exceeds 8

### Lab evolution loop

<!-- trace:v1 id=REQ-SEED-D5V8QCMS type=requirement work=WORK-SEED-6VF90M7B derived_from=SPEC-SEED-XK673WRX -->

Deterministic friction rules, clustering, governor budgets, crystallization triggers, GEPA contract, mutation agent report, 3-hypothesis scientist, challenges, model profiler

Acceptance:

- friction unit tests pass

- scientist validates 3-hypothesis shape

### Evaluation promotion safety

<!-- trace:v1 id=REQ-SEED-JJ5Q1072 type=requirement work=WORK-SEED-6VF90M7B derived_from=SPEC-SEED-XK673WRX -->

Static/unit/replay/holdout gates, 60-task deterministic corpus with oracles, non-inferiority plus Pareto promotion, archive limit, invariants as tests

Acceptance:

- broken candidate rejected

- promotion rules unit-tested

### CLI doctor CI

<!-- trace:v1 id=REQ-SEED-EZPD6B85 type=requirement work=WORK-SEED-6VF90M7B derived_from=SPEC-SEED-XK673WRX -->

seed CLI run/status/doctor/capabilities/evolve/eval/model/champion/research, doctor checks deps, CI runs all gates plus eval smoke

Acceptance:

- seed doctor runs

- CI workflow exists
