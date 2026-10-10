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
scripts/install.sh          # toolchain check, deps, .env, `seed` on PATH
```

The script is idempotent, so it doubles as the repair path. It puts `seed`
and `seed-guardian` in `SEED_BIN_DIR` (default `~/.local/bin`) and says so if
that directory is not on your `PATH`. Only the toolchain and the static gates
can fail it: a stopped Docker daemon or guardian is reported, not fatal.

### Updating

```sh
seed update                 # git pull --ff-only, then reinstall
seed update --check         # report installed vs latest, change nothing
```

`seed update` upgrades a **source install** in place. It resolves the checkout
from the installed CLI rather than your working directory, so it works from any
project. A registry install has no checkout to pull, so `seed update` says so
and names the registry command instead.

`seed update --check` and the reminder work for every install mode: they read
the latest GitHub release from a cache, so neither delays the command you
actually ran. Set `SEED_NO_UPDATE_CHECK=1` to silence the reminder.

### From the registries

Each surface ships separately and follows its own registry's latest
release.

```sh
brew install carterlasalle/tap/seed   # seed CLI + seed-gepa + seed-guardian
npm install -g @carterlasalle/seed-cli
cargo install seed-guardian
pipx install seed-evolution           # or: uvx --from seed-evolution seed-gepa --help
```

Verify each install with `seed help` (CLI), `seed-gepa --help` (GEPA loop),
and `seed-guardian` binding `~/.seed/run/guardian.sock` (see Run below).
Regenerate the brew formula after each PyPI release with
`contrib/brew/bump.sh <version>`.

## Quick start

### Prerequisites

- Node.js `>= 22.18` (have v22.22.2) — Seed runs TypeScript directly, which
  Node strips without a flag only from 22.18
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

Two presentation modes over one engine. On a real terminal, `seed` with no
arguments launches the interactive product; anything else stays headless.

### Interactive

```sh
seed            # TTY: header, transcript, composer, status bar
```

- The session opens with a short boot animation; any key skips it, and
  `SEED_NO_ANIM=1` turns it off for scripted use.
- `/` opens a searchable slash menu; `Ctrl+P` opens the command palette.
  Both are views of the same registry, so an extension that registers a
  command makes it appear in each without a restart.
- `/model` picks a model showing its measured profile (tasks evaluated,
  cost/task, p50 latency, strengths), not just an id.
- `/settings` is generated from one settings schema. Guardian-policy values
  (promotion tolerance, probation, sandbox network) render locked: the
  evolvable organism must not move its own grading criteria through the UI.
- `/skills`, `/tools`, and `/registry` show what is discovered, where it came
  from, and — for tools the router did not surface — why not.
- `/evolve` reads the guardian directly: champion lineage, candidates with
  their status, Pareto archive members with novelty, the experiment queue,
  and friction from recorded runs.
- `/sessions` lists saved sessions as a resume tree; selecting one replays its
  transcript and continues it. `/new` forks, recording the previous session as
  the new one's parent. Sessions are written when there is real work, so an
  unused session leaves no file behind.
- `/image <path>` renders a PNG/JPEG/GIF/WebP inline when the terminal supports
  it and reports the file's facts when it does not. Images are never required.
- `/doctor`, `/champion`, `/capabilities`, and `/status` run the same
  functions the headless CLI calls.
- Skills and capabilities are watched on disk: drop one in and it appears
  without a reload.
- Mouse is opt-in (`SEED_TUI_MOUSE=1`): it switches to the alternate screen, so
  the default keeps your terminal's own scrollback. The alternate screen is
  also the only mode where the transcript is walkable — the affordances come
  from `TuiAltScreen`, not from Seed:
  - `Ctrl+Shift+F` searches the transcript; `Enter` and `Shift+Enter` step
    through matches, `Esc` closes.
  - Clicking an OSC 8 link opens it (`open`/`xdg-open`), restricted to
    http(s).
  - A `↓ end` label appears while you are scrolled away from the live tail;
    click it or press `Ctrl+End`.
  - Drag selects text; a selection copies on release (OSC 52, or the native
    clipboard when available).
  None of this exists on the main screen, which is the trade for keeping your
  terminal's own scrollback.

### Headless

```sh
seed run "rename the account abstraction"  # one task, recorded to ~/.seed
seed run "..." --json                      # machine-readable
seed eval smoke                            # fail-then-pass oracle contract
seed doctor                                # environment and state checks
```

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
  seed-tui/                 Interactive frontend: live registry, transcript, dialogs (only Pi-importing package)
crates/seed-guardian/       Immutable evaluator: JSON-RPC, WAL store, gates, archive, promotion
python/seed_evolution/      GEPA contract, splits, statistics, trace analysis (uv)
capabilities/               builtin/python, fixtures/echo (JSONL stdio)
evals/core/generated/       60 generated tasks (gitignored, regen via script)
research/                   harnesses/papers/mechanisms YAML (validated in CI)
prompts/                    Task-agent parts + lab role prompts
schemas/                    Capability/event/experiment/hypothesis/model-profile JSON
```

Guardian code never leaks into the organism: `scripts/verify-boundaries.ts` fails CI on `seed-guardian` imports or guardian-only RPC in the organism. The same gate keeps Pi confined to the frontend: `@earendil-works/pi-tui` may be imported only under `packages/seed-tui/`, never by `seed-core`, `seed-runtime`, `seed-lab`, `seed-cli`, `seed-guardian`, or `seed_evolution`, and `packages/seed-tui/src/registry/` stays terminal-UI-free so headless callers can build a registry without loading a TUI. Spec: `docs/specs/seed-v1-self-evolving-harness.md`. Architecture: `docs/ARCHITECTURE.md`. Baseline pin: `docs/BASELINE.md`.

## Safety model

Seed intentionally makes dangerous paths inconvenient:

- The running champion never hot-swaps; sessions pin the SHA, new sessions take the new champion.
- Generated capabilities default to out-of-process (`process` runtime) with allowlisted env only.
- Model-driven Python runs restricted by default: only `SEED_*` plus non-secret runtime lookups (`PATH`, `HOME`, XDG cache dirs, tmp). Harness credentials such as `OPENROUTER_API_KEY` never reach model-generated code; pass `trust: "workspace"` only for trusted local work.
- Sandbox mounts are `/candidate` rw, `/workspace` rw, `/seed-fixture` ro; network off; CPU 4 / mem 8g / pids 512.
- Promotion needs a Champion-terminal state, non-inferior metrics, and material gain; probation runs 10 tasks and rolls back on 2 strikes.
- Self-reported candidate telemetry is diagnostic metadata, never promotion evidence.
- Secrets are references, never committed values; `.env` stays local and `SEED_GUARDIAN_URL` is the only credential-shaped check.

The normative requirements are in the [spec](docs/specs/seed-v1-self-evolving-harness.md). Architectural decisions are indexed in the [ADR directory](docs/adr/).

## Test

```sh
yarn test                                            # 152 node:test cases across packages/*/src
yarn typecheck                                       # tsc --noEmit per package
cargo test --workspace                               # 19 guardian tests (invariants + roundtrip + promotion)
uv run --project python/seed_evolution pytest python/seed_evolution  # 15 pytest cases
```

## Lint

```sh
yarn lint                                            # same 152 node:test cases (lint gate)
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
