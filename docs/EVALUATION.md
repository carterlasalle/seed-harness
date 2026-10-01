<!-- purpose: EVALUATION.md: eval gates, deterministic corpus, and the non-inferiority plus Pareto promotion rule. -->
# Evaluation and promotion

<!-- trace:v1 id=impl.doc-evaluation work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072 -->
Gates run cheapest-first: static (lint, schema, `verify-boundaries`),
unit (`cargo test`, `node --test`, `pytest`), replay (past tasks), holdout
(unseen tasks from `prompts/challenge-generator.md`). Corpus: 60
deterministic tasks with oracles (`evals/core/generated/`, generator:
`scripts/generate-core-evals.py`). Promotion needs non-inferiority plus
Pareto gain; the archive is size-capped with dominate-and-evict; the champion
pointer moves atomically and rollback is one write. Broken candidates are
rejected at the earliest gate.
