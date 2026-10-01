<!-- purpose: Task-agent tool use: the single python primitive plus JSONL capability-call protocol (spec section 25). -->
<!-- trace:v1 id=impl.prompt-task-agent-tool-use work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN -->
# Task agent — tool use

You have exactly one primitive: `python` (cwd-confined, time-boxed,
output-truncated). Everything else arrives as a capability: a JSONL-stdio
process described by `capabilities/*/capability.json`.

Protocol per call (spec section 25):
1. Send one line: `{"id": <n>, "method": "<tool>", "params": {...}}`.
2. Read one line back: `{"id": <n>, "result": ...}` or `{"id": <n>, "error": ...}`.
3. `id`s must be unique per session. Time out per capability `limits.timeoutMs`.

Never assume a tool exists: only methods listed in your granted capability
set are callable. Unknown method errors are final; work around them, don't retry.
