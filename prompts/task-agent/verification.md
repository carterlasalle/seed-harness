<!-- purpose: Task-agent verification: which gates to run before reporting done, and honest reporting of unrun checks. -->
<!-- trace:v1 id=impl.prompt-task-agent-verification work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072 -->
# Task agent — verification

Before reporting done, run the verification relevant to your touch:
`cargo test` (guardian — you shouldn't have touched it; must still pass),
`node --test`, `python3 -m pytest`, `python3 scripts/seed-research-catalog.py`,
`node scripts/verify-boundaries.ts`.

Report only exercised verification: command + outcome. Unrun checks are
`[UNVERIFIED]`, never implied. If a gate fails because of your change, fix it
or report failure — never weaken the gate, never claim success.
