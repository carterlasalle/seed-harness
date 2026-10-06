<!-- purpose: ARCHITECTURE.md: one-page map of the guardian/organism split, packages, stores, boundaries, and pointers to detail docs. -->
# Seed architecture

<!-- trace:v1 id=impl.doc-architecture work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA -->
Guardian (Rust, `crates/seed-guardian`) is immutable: JSON-RPC
`hello`/`task`/`telemetry`, SQLite WAL store, worktrees, gates, Pareto
archive, champion pointer, rollback. Organism (TS `packages/*` + Python
`python/seed_evolution`) is evolvable: one `python` primitive, capability
registry + BM25 router (max 8), lab loop (friction, governor, scientist,
crystallizer, mutation, challenges, profiler). Boundary enforced by
`scripts/verify-boundaries.ts`; research catalog validated by
`scripts/seed-research-catalog.py`. Upstream pin and wrap decision:
`docs/BASELINE.md`. Split rationale: `docs/adr/0001-guardian-organism-split.md`.

## Interactive frontend

`packages/seed-tui` is the interactive terminal product: `seed` with no
arguments on a real TTY renders the session (header, transcript, composer,
status bar); with a pipe, `--json`, or any explicit subcommand it stays
headless, so CI and automation never load a terminal UI.

Its one architectural rule is **registry/UI consistency**: there is a single
live registry (`packages/seed-tui/src/registry/`) and every surface — the
slash menu, the Ctrl+P palette, the model picker, settings browser, skills
list, tools view — renders whatever the registry currently holds. Registering
a command, setting, model, skill, tool, or renderer makes it visible on the
next render; nothing keeps a second copy. `registry.test.ts` and
`consistency.test.ts` assert that invariant, and `registry/watch.ts` keeps
filesystem-backed domains live through a debounced `fs.watch`, so dropping a
capability or skill on disk shows up without a restart.

The registry subpath is deliberately free of terminal-UI imports so headless
callers can populate it. Pi dependencies live only in this package and are
forbidden everywhere else; see `docs/BASELINE.md` for the boundary and
`scripts/verify-boundaries.ts` for its enforcement.
