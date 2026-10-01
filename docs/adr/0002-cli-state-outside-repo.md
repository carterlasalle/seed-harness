<!-- purpose: ADR 0002: CLI runtime state lives outside the user project. -->
<!-- trace:v1 id=impl.adr-0002 work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85 -->
# ADR 0002: CLI state outside the repo

Status: accepted. Date: 2026-10-01.

Context: `stateDir()` defaulted to `<repo>/.seed-state`, so `seed run`,
`seed eval smoke`, and `seed doctor` wrote runtime JSON into the user
project, violating spec section 11 and tripping trace TL012/TL013 on
generated state files.

Decision: default CLI state to `~/.seed` (SEED_STATE_DIR override keeps
priority; explicit root args still resolve `<root>/.seed-state` for
tests/CI). `.gitignore` now also covers `.seed-state/`, `.scratch/`,
`SEED_SCRATCH/`.

Consequences: fresh checkouts stay clean; operators back up `~/.seed`;
tests keep hermetic overrides.
