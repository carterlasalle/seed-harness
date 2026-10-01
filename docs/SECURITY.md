<!-- purpose: SECURITY.md: trust boundaries, confinement, permissions, and what each side must never touch. -->
# Security

<!-- trace:v1 id=impl.doc-security work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA -->
Guardian never executes organism code; organism never imports guardian
(`scripts/verify-boundaries.ts` fails CI on `seed-guardian` references or
guardian-only RPC: `champion.promote/rollback`, `archive.evict`,
`gate.override`, `worktree.destroy`). Tasks run in isolated worktrees under
`$SEED_SCRATCH`; scratch writes stay under `$SEED_SCRATCH` (task-agent core
prompt, spec section 99). Capabilities declare permissions
(`fs.read/fs.write/net/exec`) and limits; the python primitive enforces cwd
confinement, timeouts, truncation. No network for task agents.
