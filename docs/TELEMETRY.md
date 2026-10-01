<!-- purpose: TELEMETRY.md: event envelope shape and emission rules for organism and guardian. -->
# Telemetry

<!-- trace:v1 id=impl.doc-telemetry work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE -->
Every event validates against `schemas/event.schema.json`
(`type`, `timestamp`, `session`, optional `payload`, `candidate`). Organism
emits `task.start` / `task.heartbeat` (60s) / `task.result`; guardian persists
to SQLite WAL and serves experiment reads. Sessions pin the champion ref so
mid-run promotions never leak into in-flight tasks. Friction rules consume
this stream; see `docs/EVOLUTION.md`.
