## Seed change

### Requirement IDs

- REQ-SEED-

### Change summary

-

### Safety

- Guardian boundary impact: none / described below
- Migration impact: none / described below
- Rollback: `seed champion rollback <ref>` / N/A

### Verification

- [ ] `yarn test` (110 node:test cases)
- [ ] `yarn typecheck`
- [ ] `node scripts/verify-boundaries.ts`
- [ ] `cargo test --workspace` (when guardian touched)
- [ ] `uv run --project python/seed_evolution pytest python/seed_evolution` (when evolution touched)
- [ ] `yarn seed eval smoke`
- [ ] `trace verify --changed` green
- [ ] Documentation updated (README/docs/AGENTS memory), or no content change
