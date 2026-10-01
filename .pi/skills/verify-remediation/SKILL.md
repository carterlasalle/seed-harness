---
name: verify-remediation
description: Diagnose and fix trace verify failures rule by rule (TL001/TL002/TL003/TL012/TL013) with adjacency, exclusion, and re-verify discipline.
---

# Verify remediation
<!-- trace:v1 id=doc.verify.remediation type=document work=WORK-TL-X9QCP01F satisfies=REQ-TL-10BRQG4G -->

Use when `tracelayer verify --changed` fails. Work rule by rule, not file by file.

### 1. Inventory

```bash
tracelayer verify --changed 2>&1 | grep -E "^(ERROR|WARNING)" | sort | uniq -c | sort -rn
tracelayer verify --changed --format json 2>/dev/null | python3 -c "
import json,sys,collections
d = json.load(sys.stdin)
c = collections.Counter((x.get('rule'), x.get('path')) for x in d['diagnostics'] if x.get('severity') == 'ERROR')
for (r, p), n in c.most_common(20): print(n, r, p)"
```

### 2. Triage order

- **TL001 duplicate ID**: two markers share one id. Dedupe to a single marker; rename the newcomer. Check skill-mirror copies (`.agents/`, `.omp/`, `.claude/` skills dirs carry identical marker text) — policy-exclude harness dirs so mirrors never index.
- **TL002 edge targets missing node**: a `satisfies=`/`work=`/`verifies=` target has no active node. Reference only ids that exist (check `.trace/work.toml` for work ids); re-materialize session-only nodes with `tracelayer task begin <WORK-ID>`.
- **TL003 detached or ambiguous**: the marker is not adjacent to its symbol. See the `marker-placement` skill. Prove scope before fighting: transplant known-good content to the failing path and back; if path-keyed (content-independent), exclude the path with a WHY comment instead of iterating.
- **TL012 changed path has no claiming node**: the file needs a real `trace:v1` marker node above a supported symbol, or a `[exclusions]` policy entry. An exempt alone does NOT satisfy TL012. New test files need a `test.*` marker above the first test fn. Shell scripts (no supported parser): mint an ops node — see the `tl012-shell-script` skill.
- **TL013 per-boundary accounting**: every new or materially-changed boundary in a changed file needs a marker, an inherit declaration, or an exempt. Internal helpers and data types get `trace:exempt reason=internal-detail`; unit tests get `reason=unit-test`. Batch-apply with a script over verify output `(path:line)` pairs in descending line order; skip boundaries that already carry a marker.

### 3. Gotchas

- Markers above `pub mod` / `use` / `const` declarations (or above doc comments) are TL003-detached — not supported symbols. Use the first real `pub fn` / `def` / component, or a policy exclusion.
- TL063 (enforcement config changed) after touching `.trace/policy.toml` is informational and non-blocking.
- Output goes to stdout, not stderr — capture both when scripting.

### 4. Re-verify

```bash
tracelayer index && tracelayer verify --changed
```

Expect pass. Then `tracelayer verify --all` — it catches stale edge targets that `--changed` misses.
