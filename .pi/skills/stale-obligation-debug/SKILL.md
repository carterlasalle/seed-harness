---
name: stale-obligation-debug
description: Diagnose recurring TRACE OBLIGATIONS PENDING loops (session-file triage, reconcile probing, exception-swallowing check).
---

# Stale obligation debug
<!-- trace:v1 id=doc.stale.obligation.debug type=document work=WORK-TL-X9QCP01F satisfies=REQ-TL-10BRQG4G -->

Use when `TRACE OBLIGATIONS PENDING` banners repeat with no progress while the default session looks clean — the obligations live in a **non-default harness session file**.

### Diagnosis

1. Find the guilty session file: scan `.trace/cache/session/*.json` for files with pending obligations. Harness sessions use UUID filenames; `task context` only reconciles the session in the hook payload or default.
2. Run reconcile directly on that session id and read `reconciled` vs `remaining`. `reconciled=0, remaining>0` means the expected boundary exists but has NO marker (reconcile resolves only non-existent or marked boundaries), or the marker sits outside the attachment window.
3. If reconcile returns 0 unexpectedly, invoke the inner resolver without exception swallowing and read the traceback — the caller wraps resolution in `try/except: pass`, so one `NameError` looks like success with zero progress.

### Clearing

Resolve per obligation through session state (`resolve_obligation(sid, path, symbol)`), scoped to paths already decided as infrastructure — never blanket-clear product behavior obligations.

### Prevention

- Scan exclusions must exist in `.trace/policy.toml [exclusions] paths`; repos with stale policy files need the hardcoded test-file and CLI skip patterns too.
- When iterating on the tool itself, prefer `uv run tracelayer` over a globally installed binary — installed copies lag the checkout.
