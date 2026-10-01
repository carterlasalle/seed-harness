<!-- purpose: BASELINE.md: upstream Pi pin, verified toolchain, Pi packages, and the wrap-vs-vendor decision with rationale. -->
# Baseline

<!-- trace:v1 id=impl.doc-baseline work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85 -->
Upstream: `earendil-works/pi` pinned at `d6af72e1857cfb10b41d8ff8e69f0d72b4cf6d31`.

Toolchain (verified 2026-10-01): node v22.22.2, yarn 4.9.2, uv 0.12.15,
python 3.14.7, cargo 1.98.1, docker 29.4.0.

Pi packages (npm): `@earendil-works/pi-agent-core@0.87.1`,
`@earendil-works/pi-coding-agent@0.87.1`, `@earendil-works/pi-tui@0.87.1`.

Decision: Seed wraps Pi via npm dependencies, NOT a vendored monorepo.
Rationale: (1) the pin stays reviewable as one hash; (2) upstream fixes flow
through version bumps instead of manual merges; (3) the guardian/organism
boundary stays clean — Pi is organism-side tooling, never guardian code.
Re-pin only after re-running all gates plus eval smoke on the new revision.
