---
name: obligation-batch
description: Resolve TRACE OBLIGATIONS PENDING batches by sweeping the whole touched file in one pass (marker-vs-exempt semantics, TL003 adjacency, collision handling).
---

# Resolving obligation batches
<!-- trace:v1 id=doc.obligation.batch type=document work=WORK-TL-X9QCP01F satisfies=REQ-TL-10BRQG4G -->

When the harness shows `TRACE OBLIGATIONS PENDING` listing symbols with suggested marker ids, that is the **pre-edit authoring gate** — not the completion gate. `tracelayer verify` / `tracelayer verify --changed` passing with 0 diagnostics is authoritative; the banner re-enumerates the touched file's symbols in small batches every time the file changes, including already-resolved symbols (phantom re-lists).

### Key semantics

1. The gate wants a **`trace:v1` marker carrying its EXACT suggested id** — a plain exempt satisfies verify but NOT the obligation list; the symbol stays pending until the suggested id (or a unit-test/internal exempt in the exact slot) is present.
2. Marker adjacency (TL003): the marker sits **directly above the symbol line**, **below** doc comments AND **below** attribute/decorator lines. For test fns: directly above the test attribute, not above the fn.
3. Name-slug collisions (same method name across types, e.g. `as_str` on several enums) → `trace:exempt reason=internal-detail` (methods) or `reason=unit-test` (tests) instead of a name-slug marker, or TL001 duplicate-id fires.

### Fast resolution (avoid the one-batch-per-turn loop)

Sweep the whole touched file in one pass instead of marking the listed symbols and waiting for the next banner: for each untraced boundary, place the gate's exact suggested marker adjacent per the rules above. After the sweep, run `tracelayer index` + `tracelayer verify` and **convert colliding method/test markers to exempts** (any marker directly above an indented method gets `reason=internal-detail`; test fns get `reason=unit-test`).

### Verification sequence

1. `tracelayer index` → note nodes/edges/markers, 0 diagnostics.
2. `tracelayer verify` → must pass with 0 diagnostics.
3. Full test suite green.
4. Commit with a message listing what was marked; the commit message records the marker ids for the audit trail.

### Anti-patterns

- Do NOT keep marking just the listed batch and reply "done" — the gate lists the next batch and the loop never terminates. Sweep the file, verify green, state the sweep is complete.
- Do NOT blanket-insert markers above doc comments/derives — that creates TL003 detached markers (worse than the obligation).
- Do NOT remove `.trace/` or add exempts "to silence" without a real reason — the verifier checks the graph, not the banner.
