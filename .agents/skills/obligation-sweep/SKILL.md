---
name: obligation-sweep
description: Batch-clear TRACE OBLIGATIONS PENDING in one scripted pass (canonical id derivation, strict adjacency, hook-output feedback loop).
---

# Obligation sweep (batch)
<!-- trace:v1 id=doc.obligation.sweep type=document work=WORK-TL-X9QCP01F satisfies=REQ-TL-10BRQG4G -->

When a mutation prints `TRACE OBLIGATIONS PENDING — N TOTAL` (authoring gate), clear it in ONE scripted pass instead of one-by-one.

### ID derivation (matches the gate's own suggestions)

For source file `<crate>/src/<path>.rs` (or the equivalent in your language), symbol `SymName` or `sym_name`:

- src file: `// trace:v1 id=impl.<path-dashed>.<kebab-symbol>`
- tests dir: `// trace:v1 id=test.<name>.<kebab-symbol>`

Kebab: snake_case AND CamelCase boundaries become dashes, lowercased (`AdapterManifest` → `adapter-manifest`). Optional `work=` / `satisfies=` / `verifies=` suffixes MUST reference ids that exist as nodes — a truncated work slug yields TL002 even when verify passes.

### Placement (adjacency is strict)

Insert directly ABOVE the boundary line:

- BELOW any doc comments (they detach → TL003).
- BETWEEN attributes and the item: the marker is the last line before the definition, never separated by an attribute.
- Skip items whose lookback (attrs/comments) already contains `trace:v1` / `trace:exempt`.
- Nested items inside another item attach at file level → hoist to module level instead of marking in place.

### Feedback loop

1. Run the sweep script over changed files.
2. Re-run the build/check the hook watches — the hook reprints the remaining count.
3. Repeat until 0, then `tracelayer verify --changed` AND `tracelayer verify --all` (`--all` catches stale edge targets that `--changed` misses).
4. If the write-time gate demands bootstrap for a brand-new artifact: `tracelayer task bootstrap --json` with `{title, kind, intent, requirements[{title, statement}], plan:{tasks:[...]}}` — it returns the real WORK/REQ ids to reference.
