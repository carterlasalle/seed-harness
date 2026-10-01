<!-- purpose: BASELINE.md: upstream Pi pin, verified toolchain, Pi packages, and the wrap-vs-vendor decision with rationale. -->
# Baseline

<!-- trace:v1 id=impl.doc-baseline work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85 -->
Upstream: `earendil-works/pi` pinned at `d6af72e1857cfb10b41d8ff8e69f0d72b4cf6d31`.

Toolchain (verified 2026-10-01): node v22.22.2, yarn 4.9.2, uv 0.12.15,
python 3.14.7, cargo 1.98.1, docker 29.4.0.

Pi packages: none installed. The `0.87.1` coordinates above name the
reviewed upstream revision only; no `@earendil-works/*` tarball is
fetched and `yarn.lock` contains no Pi entries (verified by grep).

Decision: Seed does NOT vendor or depend on Pi. The organism
implements the small-kernel loop directly (python primitive, router,
lab) and treats Pi as a mechanism-catalog entry
(`research/harnesses.yaml`), not a runtime dependency. This keeps the
guardian/organism boundary clean — Pi-shaped ideas enter only as
evaluated candidates, never as unevaluated imports.
Re-pin only after re-running all gates plus eval smoke on the new revision.
