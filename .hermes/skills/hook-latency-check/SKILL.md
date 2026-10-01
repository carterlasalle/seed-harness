---
name: hook-latency-check
description: Prove whether a slow hook/gate report is the hook itself vs harness overhead (timing receipts, OMP-free isolation, cost split).
---

# Hook latency check
<!-- trace:v1 id=doc.hook.latency.check type=document work=WORK-TL-X9QCP01F satisfies=REQ-TL-10BRQG4G -->

Use when a slow hook/gate is reported and you must prove whether the hook itself is slow vs harness/plugin overhead.

1. Read the receipts: `tracelayer timing` (n/total/p50/p95/max per command). Note which event is slow (pre-mutation, post-mutation, stop).
2. Isolate from the harness: copy the repo to `/tmp/<repo>-iso`, then run the raw hook with the gate payload and no plugins, e.g. `echo '{"lifecycle":"wip","session_id":"iso-test"}' | time tracelayer hook stop --format json`. Match against the timing-log rows — equal wall time convicts the hook.
3. Split the cost: `time TRACE_NO_TIMING=1 tracelayer verify --changed` then `time TRACE_NO_TIMING=1 tracelayer verify`. (`TRACE_NO_TIMING=1` keeps the probe out of the log.) The stop hook runs both back-to-back, so expect roughly the sum.
4. Read user/sys split: high `sys` implicates tree-walking/process-spawning; high `user` implicates rule evaluation. Check working-tree size vs graph size for the walking hypothesis.
5. Clean up the isolation copy. Report raw numbers with the harness-free receipt; do not change gate semantics (fail-open pre-mutation on transport failure, fail-closed stop) to fix latency.
