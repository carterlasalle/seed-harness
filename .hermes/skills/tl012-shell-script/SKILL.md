---
name: tl012-shell-script
description: Resolve TL012 on shell scripts by minting an ops node (exempt comments are structurally unreachable for shell).
---

# TL012 on shell scripts
<!-- trace:v1 id=doc.tl012.shell.script type=document work=WORK-TL-X9QCP01F satisfies=REQ-TL-10BRQG4G -->

TL012 clears a changed path only via a policy exclusion or an active node claiming it. Shell has no supported symbol parser and a file with no recognized boundaries returns "can't verify authoring here" — so `# trace:exempt` in a `.sh` file is structurally unreachable and re-indexing changes nothing.

### Fix

1. Mint an ops id: `tracelayer new operation --name "<slug-with-dashes>"`.
2. Claim the file with a file-level marker near the top (after the shebang): `# trace:v1 id=ops.<slug> title="<one-line description>"`. Shell degrades to file-level attachment, so this marker indexes and the ops node claims the path.
3. `tracelayer index`, then `tracelayer verify --changed`.

### Alternative

`tracelayer ignore <path>` adds a policy exclusion — same mechanism as `vendor/**`. Use when the file is not worth a node at all (note: `ignore` auto-suffixes bare names with `/**`).

### Traps

- Exempt comments in already-excluded shell files "work" only because the path is excluded — decorative, not a pattern to copy.
- Mint before writing: hand-written `ops.*` ids without a minted node dangle (TL002).
