---
name: remediation-dead-end-audit
description: Audit rule/CLI remediation dead-ends where following the diagnostic text changes nothing (map acceptance paths, reproduce, fix at mechanism level).
---

# Remediation dead-end audit
<!-- trace:v1 id=doc.remediation.dead.end.audit type=document work=WORK-TL-X9QCP01F satisfies=REQ-TL-10BRQG4G -->

Use when a `tracelayer verify` diagnostic persists after following its remediation text — the documented fix is structurally unreachable, which looks exactly like stale cache.

### 1. Map the acceptance path (source, not docs)

Rule registry + messages, rule implementations (live rules read the store), acceptance mechanisms (marker attach, exempt, inherit, per-language windows), verify scope/changed-paths, CLI helpers (ignore/new/marker suggest). For each fired rule, enumerate every path that could clear it, then check each is reachable for that file class (extension maps, glob engines, id minting, filesystem state).

Known dead-end shapes: two glob engines disagreeing on `**/.DS_Store` or `dir/*`; remediation text naming an exact id while minting slugified ids without persisting the node; checker window stricter than indexer window (markdown markers); extension maps disagreeing between indexer and gate; `ignore <bare-file>` storing `file/**` which never matches the file; TL012 demanding markers on deleted files or on files whose only authorable statement is a file-level exempt.

### 2. Reproduce before fixing

Scratch git repo: init → one fixture file with a marker → `trace init` → commit → mutate → verify. Always run the source binary (editable install), never an installed copy — installed releases lag working-tree fixes and make green fixes look still-broken. Prefer JSON output for fields (`rule_id`, `message`, `path`, `severity`).

### 3. Fix at the mechanism level

One shared engine per concept: single glob matcher, single marker window constant, one normalized extension map. Filesystem is the tiebreaker for file-vs-dir semantics. Fresh `trace init` must pass its own gate: default config excludes seeded agent dirs and writes a default work item. Never hand-edit generated docs — edit the builder, then regenerate.

### 4. Verify

Per fix: unit tests for the touched rule + scratch-repro re-run with the source binary (expect 0 occurrences). Full battery: lint, full test suite, `verify` and `verify --changed` both pass, docs generate check. Mark new helpers exempt (marker above decorators) or the gate adds obligations.
