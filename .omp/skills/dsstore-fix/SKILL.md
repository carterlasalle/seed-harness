---
name: dsstore-fix
description: Fix TL012 verify failures on macOS .DS_Store files (remove, gitignore, policy-exclude, re-verify).
---

# .DS_Store fix
<!-- trace:v1 id=doc.dsstore.fix type=document work=WORK-TL-X9QCP01F satisfies=REQ-TL-10BRQG4G -->

Use when `tracelayer verify --changed` fails with TL012 on `.DS_Store` paths. These are macOS directory metadata, not source — never mark them, exclude them.

### Fix

1. Delete them: `find . -name .DS_Store -delete`.
2. Gitignore: append `.DS_Store` to `.gitignore` if absent (`tracelayer init` seeds this).
3. Policy: add `"**/.DS_Store"` to `[exclusions] paths` in `.trace/policy.toml` (glob engines disagree on bare `.DS_Store`, so use the `**/` form).
4. Re-verify: `tracelayer index && tracelayer verify --changed`.
