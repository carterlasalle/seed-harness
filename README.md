<!-- README: Seed v1 quickstart. Purpose: prereqs/install/config/run/test/lint/build/verify in one page. Why: single entry so every slice's commands stay real. Invariant: every command below was executed during the audit; `seed` subcommands run via `yarn seed`. -->
<!-- trace:v1 id=impl.readme work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85 -->
<div align="center">

# Seed

**A self-evolving coding-agent harness: an immutable Rust guardian judges an evolvable TS/Python organism.**

[![ci](https://github.com/carterlasalle/seed-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/carterlasalle/seed-harness/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)
![Yarn](https://img.shields.io/badge/Yarn-4.9.2-2C8EBB?logo=yarn&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-guardian-CE422B?logo=rust&logoColor=white)

[Getting started](#quick-start) · [How it works](#how-it-works) · [Capabilities](#capabilities) · [Architecture](#architecture) · [Safety model](#safety-model) · [Contributing](CONTRIBUTING.md) · [Agent guidance](AGENTS.md)

</div>

Seed gives a small harness team the operating model of a mature self-improving system without weight training, multi-node consensus, or a custom model stack. The foreground agent declares work in one `python` primitive. Every run is instrumented, friction is extracted deterministically, and structural changes compete as Candidates against executable oracles — promoted only on non-inferiority plus Pareto gain, recorded in SQLite, and reversible with one rollback write.

## How it works

```mermaid
flowchart LR
    A[Task prompt] --> B[seed run: champion pin]
    B --> C[Organism python turn + telemetry]
    C --> D[Friction extraction + crystallization]
    D --> E[Scientist: 3 hypotheses]
    E --> F[Mutation + GEPA candidates]
    F --> G[Guardian gates + oracles]
    G --> H[Promotion or archive]
    H --> I[Champion pointer + rollback]
```

The guardian is the judge. The organism is everything that can change. SQLite stores lineage, metrics, archive, and promotion history; it never becomes a second agent loop.

## Capabilities

| Area | What Seed provides |
|---|---|
| Bootstrap | One confined `python` primitive (cwd jail, 30s/300s timeouts, 256 KiB middle-truncated output, SEED_* env, per-call telemetry) |
| Capabilities | Versioned packages (tool/skill/hook/extension/mcp/lsp/agent/codec/edit-protocol/memory/model-policy/optimizer) with manifest validation, JSONL stdio ABI, and least-privilege process isolation |
| Routing | Deterministic BM25 over name/description/capability/language, `python` pinned, max 8 visible (boosts +25% same-task useful, +15% session-used, −30% high-error) |
| Ephemeral | Session-scoped throwaway tools under `$SEED_SCRATCH/ephemeral/` with creation/modification/execution/args-hash/status/elapsed tracking |
| Crystallization | Counted triggers (≥5 invokes, ≥3 tasks, ≥3 sequences eliminated, utility ≥0.80) promote repeats to proposed capabilities — never auto-promoted |
| Evaluation | 60 deterministic oracle tasks (10×6 categories), fail-then-pass smoke, static→unit→replay→holdout→probation pipeline |
| Promotion | Non-inferiority (0.01, critical 0.005) plus material Pareto gain; 64-member archive with dominate-and-evict; 10-task probation with 2-strike rollback |
| Models | Per-model profiles with generic-safe fallback (limit 8), 12 characterization probes, scaffolding deletion when stronger models obsolete it |
| Challenges | 10 deterministic mutation operators with baseline-pass/mutation-fail/repair-pass admission |
| Research | Curated harness/paper/mechanism catalog (10/8/11 entries), validated in CI, refreshed without touching the organism |

## Install

Two paths: from source (to hack on Seed) or from the registries (to use Seed).

### From source

```sh
git clone https://github.com/carterlasalle/seed-harness.git
cd seed-harness
corepack enable
yarn install --immutable
uv sync --locked --project python/seed_evolution
cargo build --workspace
```

### From the registries

Each surface ships separately; all four are currently at `0.1.5`.

```sh
brew install carterlasalle/tap/seed   # seed CLI + seed-gepa + seed-guardian
npm install -g @carterlasalle/seed-cli
cargo install seed-guardian --version 0.1.5
pipx install "seed-evolution==0.1.5"  # or: uvx --from "seed-evolution==0.1.5" seed-gepa --help
```

Verify each install with `seed help` (CLI), `seed-gepa --help` (GEPA loop),
and `seed-guardian` binding `~/.seed/run/guardian.sock` (see Run below).
Regenerate the brew formula after each PyPI release with
`contrib/brew/bump.sh <version>`.

## Quick start

### Prerequisites

- Node.js `>= 22` (have v22.22.2)
- Corepack with Yarn `4.9.2`
- Python `>= 3.10` via `uv`
- Rust via Cargo
- Docker (candidate eval sandbox)
- Git

Run the complete gate suite:
```sh
yarn test && yarn typecheck && node scripts/verify-boundaries.ts && python3 scripts/seed-research-catalog.py
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
uv run --project python/seed_evolution pytest python/seed_evolution && yarn seed eval smoke
```

## Run

The guardian is a Unix-socket daemon (`~/.seed/run/guardian.sock`, DB at
`~/.seed/guardian.sqlite`). `run` and `eval run` need it live; `doctor`,
`status`, `capabilities`, `champion`, `schema`, and `model` work offline.
`seed run` also needs `OPENROUTER_API_KEY` for the model turn.

```sh
seed-guardian &                            # start the daemon (foreground: no args)
ls -la ~/.seed/run/guardian.sock           # srw------- : bound and listening
export OPENROUTER_API_KEY=...              # model turns fail loudly without it
cp .env.example .env                       # SEED_GUARDIAN_URL + SEED_SCRATCH_ROOT
seed run "rename the account abstraction"  # recorded to ~/.seed
seed status                                # queue depth + recent runs
seed champion show                         # guardian ref, local fallback offline
seed capabilities list                    # builtin/python + fixtures/echo, no guardian needed
seed eval smoke                            # fail-then-pass oracle contract, no guardian needed
seed doctor                                # all green except docker-socket when Docker is off
```

From a source checkout, prefix CLI calls with `yarn` (`yarn seed run ...`).
`kill %1` (or the daemon PID) stops the guardian; a stale socket file is
removed on the next bind, never followed blindly.

For environment setup and local command examples, follow [CONTRIBUTING.md](CONTRIBUTING.md).

## Task workflow

1. Write the task as one prompt: `yarn seed run "<task>"`.
2. The organism pins the champion, runs one `python` turn with telemetry, extracts friction, and records the run.
3. Repeated helpers crystallize into proposed capabilities (manifest + tests + provenance) — still unpromoted.
4. The lab (scientist → mutation/GEPA → challenges) builds Candidates in isolated worktrees.
5. The guardian gates, scores oracles, checks non-inferiority + Pareto gain, and promotes or archives.
6. Roll back with `seed champion rollback <ref>` when probation strikes.

Start with `yarn seed eval smoke`, which proves the fail-then-pass oracle contract on scratch copies. The corpus contract is `evals/core/generated/` (regen with `scripts/generate-core-evals.py --seed 1337`, never hand-edit).

## Architecture

Seed is a Yarn workspace with deliberately narrow package boundaries:

```text
packages/
  seed-core/                Manifest registry, BM25 router (max 8), friction, scientist, edits, codecs
  seed-runtime/             Python primitive, sessions, ephemeral, telemetry, guardian client, organism
  seed-lab/                 Governor, crystallizer, mutation, challenges, profiler, GEPA client
  seed-cli/                 seed commands over ~/.seed state
crates/seed-guardian/       Immutable evaluator: JSON-RPC, WAL store, gates, archive, promotion
python/seed_evolution/      GEPA contract, splits, statistics, trace analysis (uv)
capabilities/               builtin/python, fixtures/echo (JSONL stdio)
evals/core/generated/       60 generated tasks (gitignored, regen via script)
research/                   harnesses/papers/mechanisms YAML (validated in CI)
prompts/                    Task-agent parts + lab role prompts
schemas/                    Capability/event/experiment/hypothesis/model-profile JSON
```

Guardian code never leaks into the organism: `scripts/verify-boundaries.ts` fails CI on `seed-guardian` imports or guardian-only RPC in the organism. Spec: `docs/specs/seed-v1-self-evolving-harness.md`. Architecture: `docs/ARCHITECTURE.md`. Baseline pin: `docs/BASELINE.md`.

## Safety model

Seed intentionally makes dangerous paths inconvenient:

- The running champion never hot-swaps; sessions pin the SHA, new sessions take the new champion.
- Generated capabilities default to out-of-process (`process` runtime) with allowlisted env only.
- Candidate code never sees hidden oracle outputs, the guardian DB, promotion code, or other worktrees.
- Sandbox mounts are `/candidate` rw, `/workspace` rw, `/seed-fixture` ro; network off; CPU 4 / mem 8g / pids 512.
- Promotion needs a Champion-terminal state, non-inferior metrics, and material gain; probation runs 10 tasks and rolls back on 2 strikes.
- Self-reported candidate telemetry is diagnostic metadata, never promotion evidence.
- Secrets are references, never committed values; `.env` stays local and `SEED_GUARDIAN_URL` is the only credential-shaped check.

The normative requirements are in the [spec](docs/specs/seed-v1-self-evolving-harness.md). Architectural decisions are indexed in the [ADR directory](docs/adr/).

## Test

```sh
yarn test                                            # 110 node:test cases across packages/*/src
yarn typecheck                                       # tsc --noEmit per package
cargo test --workspace                               # 19 guardian tests (invariants + roundtrip + promotion)
uv run --project python/seed_evolution pytest python/seed_evolution  # 15 pytest cases
```

## Lint

```sh
yarn lint                                            # same 110 node:test cases (lint gate)
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings
uv run --no-project ruff check python/seed_evolution scripts/generate-core-evals.py
```

## Build

```sh
cargo build --workspace            # guardian daemon binary (TS ships unbuilt via node strip-types)
```

## Verify

```sh
yarn verify   # boundary gate + research catalog validation
```

## Documentation

| Document | Purpose |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Guardian/organism split, packages, stores, boundaries |
| [Evaluation](docs/EVALUATION.md) | Gates, corpus, non-inferiority + Pareto promotion rule |
| [Evolution](docs/EVOLUTION.md) | Friction, governor, crystallization, GEPA, mutation, scientist |
| [Telemetry](docs/TELEMETRY.md) | Evidence levels, spans, tool-call and task shapes |
| [Security](SECURITY.md) | Reporting channel and trust-boundary summary |
| [Baseline](docs/BASELINE.md) | Upstream Pi pin and wrap-vs-vendor decision |
| [Contributing](CONTRIBUTING.md) | Development workflow and push gates |
| [Agent guidance](AGENTS.md) | Repository-specific instructions for coding agents |

## Contributing

This repository uses atomic commits with required CI checks. Solo-owner mode keeps required checks (not approvals) as the merge gate — there is no second reviewer. Read [CONTRIBUTING.md](CONTRIBUTING.md) before making changes. Run `trace verify --changed` when editing traced behavior and the full gate suite before pushing.
