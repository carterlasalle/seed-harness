<!-- purpose: CONTRIBUTING.md: how to change Seed without breaking gates. -->
<!-- trace:v1 id=impl.doc-contributing work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85 -->
# Contributing

1. `corepack enable && yarn install --immutable`
2. `uv sync --locked --project python/seed_evolution`
3. Change code; keep `trace verify --changed` green (markers on boundaries, exempts on internals).
4. Run before pushing: `yarn test`, `yarn typecheck`, `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `uv run --project python/seed_evolution --with ruff ruff check python/seed_evolution scripts/generate-core-evals.py`, `uv run --project python/seed_evolution --with pyright pyright -p python/seed_evolution python/seed_evolution/src python/seed_evolution/tests`, `uv run --project python/seed_evolution pytest python/seed_evolution`, `yarn seed eval smoke`, `SEED_GUARDIAN_URL=http://127.0.0.1:7788 yarn seed doctor`.
5. One concern per commit; imperative subject near 50 chars; body explains why.

## Releasing

1. Bump **every** surface in lockstep to the same version: each
   `packages/*/package.json` (including the `@carterlasalle/seed-*` cross
   pins), `crates/seed-guardian/Cargo.toml`, and
   `python/seed_evolution/pyproject.toml`. Regenerate `yarn.lock`,
   `Cargo.lock`, and `python/seed_evolution/uv.lock`.
2. Add the `CHANGELOG.md` entry, then merge through a PR — the release
   workflow refuses a tag that is not an ancestor of protected `main`.
3. Tag and push:

   ```sh
   git tag -a vX.Y.Z -m "Seed vX.Y.Z: <headline>"
   git push origin vX.Y.Z
   ```

4. The tag runs `.github/workflows/release.yml`, which:
   - generates a CycloneDX SBOM and attests its provenance;
   - verifies tag == `seed_evolution` version, then publishes to PyPI via
     trusted publishing;
   - verifies tag == every workspace version, then publishes all five npm
     packages via trusted publishing;
   - creates the GitHub Release with the built distributions.

5. Publish the crate separately: `cargo publish -p seed-guardian`.
6. Regenerate the Homebrew formula with `contrib/brew/bump.sh <version>`
   **after** the npm and PyPI releases exist, since it pins both tarballs
   by sha256.

### One-time operator setup

Trusted publishing needs a publisher registered per package on the
registry; the workflow cannot grant that to itself, and the npm registry
requires an authenticated operator for it.

- **PyPI**: trusted publisher for `seed-evolution` naming this repository,
  the `release.yml` workflow, and the `pypi` environment.
- **npm**: register the GitHub relationship for each package. Needs npm
  `>= 11.21` for the `trust` command (`npm i -g npm@11.21.0`), then:

  ```sh
  npm login          # interactive; account must have 2FA satisfied
  for pkg in seed-core seed-runtime seed-lab seed-tui seed-cli; do
    npm trust github "@carterlasalle/${pkg}" \
      --file release.yml \
      --repo carterlasalle/seed-harness \
      --allow-publish -y
    npm trust list "@carterlasalle/${pkg}"
  done
  ```

  The `--file` value must be exactly the workflow filename
  (`release.yml`) and the repo must match the `repository` field in each
  `package.json`, or the OIDC exchange is rejected.

Until that exists, the npm publish job fails with an authentication error.
Do not add a long-lived `NPM_TOKEN` to work around it: the tokenless path
is the point. Once registered, re-running the release workflow for the
tag publishes npm with no further code change.
