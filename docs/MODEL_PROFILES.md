<!-- purpose: MODEL_PROFILES.md: per-model profile record shape and how the router uses it. -->
# Model profiles

<!-- trace:v1 id=impl.doc-model-profiles work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS -->
Records validate against `schemas/model-profile.schema.json` (`id`,
`provider`, `modelId`, `family`, `observedAt`, `capabilities`,
`preferredPolicyId`, `profileStatus`; legacy `model`, `strengths`,
`weaknesses`, `costPerTask`, `p50LatencyMs`, `tasksEvaluated` retained for
routing). The profiler updates profiles from eval outcomes;
