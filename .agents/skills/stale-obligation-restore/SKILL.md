---
name: stale-obligation-restore
description: Clear stale pending obligations on deleted scratch files via restore-mark-clean (never hand-edit session JSON).
---

# Stale obligation restore
<!-- trace:v1 id=doc.stale.obligation.restore type=document work=WORK-TL-X9QCP01F satisfies=REQ-TL-10BRQG4G -->

Use when `TRACE OBLIGATIONS PENDING` names a file that no longer exists (typically gitignored scratch) while `tracelayer verify`, `tracelayer doctor`, and `tracelayer summary` all report clean. The session record holds the entry with `"path_existed": false`: the liveness check reads it as "not yet written" while the reconciler skips unreadable paths, so it waits forever.

### Procedure (restore → mark → clean)

1. Confirm staleness (read-only): verify passes, doctor reports 0 issues, and a scan of `.trace/cache/session/*.json` shows the entry with `state=pending`, `path_existed=false`, path absent on disk.
2. Recreate the file faithfully at the obligated path with the obligated symbol (a minimal faithful stub is fine for scratch). Add the requested marker directly above the symbol using the work id from the obligation record.
3. Let any edit trigger the post-mutation hook; re-read the session JSON and confirm the entry flipped to `satisfied` — the tool verifies marker-on-boundary itself, never hand-edit the JSON.
4. Delete the scratch file again (only if gitignored/scratch, purpose served). The dedupe guard keeps it satisfied.
5. Confirm: `tracelayer verify --changed` passes and the entry still reads `satisfied`.

### Never

- Hand-edit `.trace/cache/session/*.json` or scan baselines.
- Mark `satisfied` without the marker actually landing.
- Use this for real product files — those get properly traced, not deleted.
