<!-- purpose: MODEL_PROFILES.md: per-model profile record shape and how the router uses it. -->
# Model profiles

<!-- trace:v1 id=impl.doc-model-profiles work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS -->
Records validate against `schemas/model-profile.schema.json` (`model`,
`strengths`, `weaknesses`, `costPerTask`, `p50LatencyMs`,
`tasksEvaluated`). The profiler updates profiles from eval outcomes;
the router weights model choice by measured score-per-cost. Prompts stay
model-agnostic (one set, see `prompts/`); only profiles vary per model.
