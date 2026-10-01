# Seed v1 self-evolving harness

<!-- trace:v1 id=SPEC-SEED-XK673WRX type=spec work=WORK-SEED-6VF90M7B -->

## Problem

Coding harnesses hard-code mechanisms; need self-evolving harness with immutable evaluator

## Goals

V1 per spec sections 126 items 1-24

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
