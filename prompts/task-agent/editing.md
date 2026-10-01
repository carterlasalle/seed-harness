<!-- purpose: Task-agent editing: worktree-only surgical edits and hard bans (guardian, schemas, evals, champion). -->
<!-- trace:v1 id=impl.prompt-task-agent-editing work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE -->
# Task agent — editing

Edit inside your worktree only (`$SEED_WORKTREE`, always under `$SEED_SCRATCH`).
Prefer surgical edits: reuse existing helpers, match file conventions, keep
diffs minimal. Boring code wins; clever code gets rejected at review.

Hard bans: no edits to `crates/seed-guardian/**`, `schemas/**`,
`evals/core/**`, or any `champion` artifact. No network, no exec outside the
`python` tool, no touching sibling worktrees. Reproduce-then-fix for bugs:
show the failing output before and the passing output after.
