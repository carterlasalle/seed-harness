---
name: bulk-exempt
description: Bulk-exempt untraced internal symbols in one scripted pass (scan, adjacency check, descending-line insert, second pass).
---

# Bulk exempt
<!-- trace:v1 id=doc.bulk.exempt type=document work=WORK-TL-X9QCP01F satisfies=REQ-TL-10BRQG4G -->

Use when a file (or tree) carries dozens of untraced internal symbols and per-symbol marking would take many turns.

### Procedure

1. Scan for definitions (`pub fn/struct/enum/type/const`, private `fn/impl/mod`, or the equivalents in your language).
2. Adjacency check: skip symbols whose lookback already contains `trace:v1` or `trace:exempt` — and walk UP past doc comments/attributes to the true symbol line before deciding.
3. Insert `trace:exempt reason=internal-detail` (unit tests: `reason=unit-test`) with matching indentation directly above the symbol — marker goes BETWEEN the last doc comment and the declaration, never above the doc block.
4. Insert in descending line order so earlier inserts don't shift later offsets.
5. Verify: `tracelayer index && tracelayer verify --changed` to confirm 0 diagnostics.

### Pitfalls

- Doc comments between marker and symbol break adjacency (TL003) — the exemption must be the immediately preceding line.
- A marker between one item's closing brace and the next item's doc comment is detached — it claims nothing.
- `impl` blocks: the block marker does not cover the methods inside; each method needs its own line.
- First pass catches public items (~80%); run a second pass with broader patterns for private items, impl blocks, modules, and test fns.

### Verification

`tracelayer verify --changed` must pass with 0 diagnostics; the consuming build (cargo/rustc, tsc, pytest) must still pass.
