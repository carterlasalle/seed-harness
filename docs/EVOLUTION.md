<!-- purpose: EVOLUTION.md: lab loop stages (friction, governor, crystallization, GEPA, mutation, scientist) and their triggers. -->
# Evolution loop

<!-- trace:v1 id=impl.doc-evolution work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS -->
Friction rules (pure functions over telemetry) feed clustering; the governor
enforces task/experiment/day budgets with kill + partial results;
crystallization (3+ successes, distinct tasks) promotes patterns to
capabilities via `prompts/crystallizer.md`. `seed-gepa`
(`python/seed_evolution`) runs propose/test/keep with parent refs; the
mutation agent changes one variable per report; the scientist proposes
exactly 3 falsifiable hypotheses (`schemas/hypothesis.schema.json`).
Catalog: `research/*.yaml`, validated by `scripts/seed-research-catalog.py`.
