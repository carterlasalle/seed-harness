<!-- README: Seed v1 quickstart. Purpose: prereqs/install/config/run/test/lint/build/verify in one page. Why: single entry so every slice's commands stay real. Invariant: every command below was executed during the audit; `seed` subcommands run via `yarn seed`. -->
<!-- trace:v1 id=impl.readme work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85 -->
# Seed v1 — self-evolving agent harness

Immutable guardian (Rust evaluator) + evolvable organism (TS/Python agent
loop). Spec: `docs/specs/seed-v1-self-evolving-harness.md`. Architecture:
`docs/ARCHITECTURE.md`. Baseline pin: `docs/BASELINE.md`.

## Prereqs

```sh
node --version    # >= 22 (have v22.22.2)
yarn --version    # 4.9.2 via corepack
python3 --version # >= 3.10
cargo --version
docker --version
```

## Install

```sh
corepack enable
yarn install --immutable
cd python/seed_evolution && uv sync --all-groups && cd ../..
cargo build --workspace
```

## Config

```sh
cp .env.example .env   # SEED_GUARDIAN_URL + SEED_SCRATCH_ROOT; test-only SEED_STATE_DIR stays unset
```

## Run

```sh
yarn seed run "rename the account abstraction"  # champion-pinned task + echo probe, recorded to ~/.seed
yarn seed doctor  # exits 1 until SEED_GUARDIAN_URL is set (see .env.example); all other checks must pass
yarn seed capabilities list
yarn seed eval smoke   # fail-then-pass oracle contract on scratch copies (2 tasks)
```

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
cargo build --workspace            # guardian daemon binary
```

## Verify

```sh
yarn verify   # boundary gate + research catalog validation
```
