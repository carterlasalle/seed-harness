<!-- purpose: CONTRIBUTING.md: how to change Seed without breaking gates. -->
<!-- trace:v1 id=impl.doc-contributing work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85 -->
# Contributing

1. `corepack enable && yarn install --immutable`
2. `uv sync --locked --project python/seed_evolution`
3. Change code; keep `trace verify --changed` green (markers on boundaries, exempts on internals).
4. Run before pushing: `yarn test`, `yarn typecheck`, `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `uv run --no-project ruff check python/seed_evolution scripts/generate-core-evals.py`, `uv run --project python/seed_evolution --with pyright pyright python/seed_evolution`, `uv run --project python/seed_evolution pytest python/seed_evolution`, `yarn seed eval smoke`, `SEED_GUARDIAN_URL=http://127.0.0.1:7788 yarn seed doctor`.
5. One concern per commit; imperative subject near 50 chars; body explains why.
