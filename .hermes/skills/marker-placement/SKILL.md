---
name: marker-placement
description: Place trace:v1 markers so the engine attaches them to symbols (TL003 adjacency, doc-comment and decorator rules, per-language notes).
---

# Marker placement
<!-- trace:v1 id=doc.marker.placement type=document work=WORK-TL-X9QCP01F satisfies=REQ-TL-10BRQG4G -->

The engine requires a marker to be **directly adjacent to exactly one supported symbol**. Adjacency failures report as TL003 detached.
### The two gotchas

1. **File-top markers are detached.** A marker at the top of the module attaches as file-level, which errors under standard policy. Markers sit on the line DIRECTLY ABOVE the symbol declaration — never at file top.
2. **Doc comments and decorators break adjacency.** A marker above a doc comment block is NOT adjacent to the symbol. Place the marker BETWEEN the doc comment and the symbol line (one line above the declaration, below the trailing doc line). For decorated definitions (`@app.command()`, `@dataclass`, `#[derive(...)]`, `#[test]`), the marker goes directly above the FIRST decorator — or use the exemption form below for internals.

### Workflow

1. Add markers: line comment (`# trace:v1 id=... work=... satisfies=...`, `// trace:v1 ...` per language) directly above the symbol; `<!-- trace:v1 ... -->` below the heading for Markdown; `.trace/work.toml` entries for work items.
2. Run `tracelayer index`, then `tracelayer verify --changed` — fix TL003 (move marker adjacent), TL002 (reference only existing ids, or create the target artifact).
3. Re-index, re-verify until pass.
### ID conventions

`impl.<domain>.<name>`, `test.<domain>.<name>`, `REQ-<PREFIX>-NNN`, `PLAN-X/Pn`, `WORK-X-NNN` (work ids live in `.trace/work.toml`). Derived facts (paths, SHAs, lines) are never declared — the engine derives them.
### What NOT to mark

Imports, getters/setters, generated code, local loops, formatting changes, generic utilities, or every changed file. Meaningful behavioral boundaries only: public APIs, business rules, security boundaries, persistence/migration behavior, verification tests, operational procedures.
