<!-- README: Seed v1 quickstart. Purpose: prereqs/install/config/run/test/lint/build/verify in one page. Why: single entry so every slice's commands stay real. Invariant: every command below exists and runs on a fresh checkout (task/lab/CLI runners land with their own slices; until then the echo fixture is the runnable end-to-end demo). -->
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
```

## Config

```sh
cp .env.example .env   # guardian URL + scratch root; edit to match your machine
```

## Run

```sh
echo '{"id": 1, "method": "echo", "params": {"hello": "world"}}' | python3 capabilities/fixtures/echo/server.py
python3 scripts/seed-research-catalog.py
node scripts/verify-boundaries.ts
```

## Test

```sh
yarn test              # node --test across workspaces
cargo test --workspace # guardian tests
python3 -m pytest      # python tests
```

## Lint

```sh
yarn lint                                # node --test (lint gate)
cargo clippy --workspace -- -D warnings
ruff check .
```

## Build

```sh
yarn typecheck            # node --check over boundary gate script
cargo build --workspace   # guardian build
```

## Verify

```sh
node scripts/verify-boundaries.ts        # guardian/organism boundary gate
python3 scripts/seed-research-catalog.py # research catalog validation
yarn verify                               # both gates
```
