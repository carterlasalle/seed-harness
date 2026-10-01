---
name: marker-attachment
description: Fix TL003 marker-detached errors with the ordered cause list (gap, decorator, duplicate id, const-arrow, attachment mode).
---

# Marker attachment (TL003 detached)
<!-- trace:v1 id=doc.marker.attachment type=document work=WORK-TL-X9QCP01F satisfies=REQ-TL-10BRQG4G -->

Symptom: the marker comment sits above a declaration but verify reports detached or ambiguous.

Causes and fixes, in order of likelihood:

1. **Blank line between marker and symbol** — remove it; the marker must be the immediately preceding line.
2. **Marker above a decorator or multi-line signature** — attach to the whole construct including any leading doc-comment; point at the first decorator.
3. **Duplicate id** — the file has multiple top-level symbols with the same name (helper + export). Ids must be unique; suffix the newcomer.
4. **TSX const-arrow between marker and function** — a `const X = ...` arrow sits between marker and target, so the marker attaches to the const instead. Reorder so the marker directly precedes the target.
5. **Attachment mode** — some repos need the marker inside JSDoc (`/** */`) rather than a line comment. Check `.trace/policy.toml`.

Debug loop: `tracelayer index` → `tracelayer verify --changed` after each fix.
