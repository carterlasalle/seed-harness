---
name: abort-vs-gate-diagnosis
description: Distinguish provider-side aborts from gate latency using the timing log (row pairing, transport baseline, election check).
---

# Abort vs gate latency
<!-- trace:v1 id=doc.abort.vs.gate.diagnosis type=document work=WORK-TL-X9QCP01F satisfies=REQ-TL-10BRQG4G -->

Use right after a "tool execution was aborted"-style failure to decide whether the provider dropped the call or the gate invited it.

1. Read the timing log (`tracelayer timing --last 20`): rows carry source (cli vs gate), event/cmd, duration, outcome, code, timed-out flag.
2. Gate rows: outcomes allow/deny/coached/hook-error/allow-on-error; timeouts flag explicitly. Only exit-2 denies in pre-mutation; crashes/timeouts fail open.
3. Pair gate+cli rows by timestamp (<200ms apart): gate-minus-cli of ~150–250ms is transport. Larger gaps mean resolver/contention.
4. Election: one lock per harness process is normal. Two pre-mutation gate rows <2s apart from one process means double registration.
5. Triage: normal ~1s hook rows beside the abort means a provider-side reasonless abort — retry. 17s+ rows mean gate latency invited it — profile verify/hook next.
