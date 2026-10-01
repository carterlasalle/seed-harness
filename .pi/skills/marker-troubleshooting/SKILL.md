---
name: marker-troubleshooting
description: Ordered checklist for trace verify failures in TS/JS repos (TL003/TL012/TL002), including multi-agent hygiene.
---

# Marker troubleshooting (TS/JS repos)
<!-- trace:v1 id=doc.marker.troubleshooting type=document work=WORK-TL-X9QCP01F satisfies=REQ-TL-10BRQG4G -->

### TL003 detached or ambiguous

1. Marker on the line IMMEDIATELY above the symbol declaration. No blank lines.
2. Valid boundaries: functions, interfaces, methods, classes — not `const X = ...`, not file top.
3. Run `tracelayer marker suggest <path>[:line]` — it prints the exact canonical marker line and target boundary.
4. Strip dangling refs: deleted `satisfies=`/`work=` targets demote markers to detached.
5. Still failing in a valid file? Nuke the incremental cache (`rm -rf .trace/cache/index.sqlite3*`), then `tracelayer index && tracelayer verify --changed`. Symptom of corruption: `tracelayer marker suggest <valid-file>` says "no behavioral boundary found".

### TL012 changed path has no marker

- New/deleted files from other agents mid-edit produce transient TL012 — re-index before acting.
- Unsupported languages (CSS, shell) can never carry attached markers → `[exclusions]` paths in `.trace/policy.toml`, or an ops node for shell scripts worth tracking (see the `tl012-shell-script` skill).
- Generated artifacts (`docs/spec*.md`, `docs/plan-*.md`) belong in exclusions.

### TL002 edge targets missing node

- Another session's lifecycle removed the REQ/WORK node your markers reference. Strip the dangling clauses or re-bootstrap the requirement.

### Multi-agent hygiene

- Only one agent runs `tracelayer index` at a time; concurrent indexes race and serve stale parses.
- Commit scoped files explicitly (`git add <file>`) — shared-tree `git add -A` captures half-done edits.
