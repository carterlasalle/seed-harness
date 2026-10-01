---
name: init-commit-setup
description: Set up verification for a fresh repository's first commits (markers per file, exempts for configs, ignore bulk, verify clean).
---

# Initial commit setup
<!-- trace:v1 id=doc.init.commit.setup type=document work=WORK-TL-X9QCP01F satisfies=REQ-TL-10BRQG4G -->

Use on a freshly initialized repository before its first commits.

### Pattern

1. Add `trace:v1` markers with unique ids above each behavior boundary (one line directly above the symbol, never at file top or above doc comments).
2. Use `trace:exempt reason=<why>` for configs, docs, and generated files — with a durable semantic reason, never `initial-commit`/`bootstrap`/`temporary` (those are flagged).
3. Configure `[exclusions] paths` for bulk exclusions (fixtures, generated trees, harness dirs) rather than exempting file by file.
4. Verify with `tracelayer verify` — expect 0 diagnostics.

### Before push

- Verify passes; commit with a descriptive message; push.
