<!-- purpose: BASELINE.md: upstream Pi pin, verified toolchain, Pi packages, and the wrap-vs-vendor decision with rationale. -->
# Baseline

<!-- trace:v1 id=impl.doc-baseline work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85 -->
Upstream: `earendil-works/pi` pinned at `d6af72e1857cfb10b41d8ff8e69f0d72b4cf6d31`.

Toolchain (verified 2026-10-01): node v22.22.2, yarn 4.9.2, uv 0.12.15,
python 3.14.7, cargo 1.98.1, docker 29.4.0.

Pi packages: exactly one, `@earendil-works/pi-tui@1.0.4` (MIT, Node
>=22.19), depended on by `packages/seed-tui` only. The `0.87.1`
coordinates above name the reviewed upstream revision; the organism
still fetches no other `@earendil-works/*` tarball and `yarn.lock`
contains no Pi runtime entries beyond that one UI package.

Decision: Seed's execution architecture does NOT depend on Pi. The
organism implements the small-kernel loop directly (python primitive,
router, lab) and treats Pi as a mechanism-catalog entry
(`research/harnesses.yaml`). The guardian/organism boundary stays
clean — Pi-shaped ideas enter only as evaluated candidates, never as
unevaluated imports.

One deliberate exception, scoped to presentation: the optional
interactive frontend (`packages/seed-tui`) builds on Pi's TUI package
as its terminal foundation. Pi's TUI is a standalone published Node
package with no OMP or Bun dependency graph, and the boundary is
enforced in code, not convention:

- Pi imports are allowed only under `packages/seed-tui/`.
- They are forbidden in `seed-core`, `seed-runtime`, `seed-lab`,
  `seed-cli`, `seed-guardian`, and `seed_evolution`.
- `packages/seed-tui/src/registry/` must stay terminal-UI-free, so
  headless callers (the CLI, `seed doctor`, CI) can build a registry
  without loading a terminal UI.

`scripts/verify-boundaries.ts` fails CI on any breach.

Re-pin only after re-running all gates plus eval smoke on the new revision.
