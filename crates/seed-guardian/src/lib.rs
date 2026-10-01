//! seed-guardian: immutable trusted evaluator daemon.
//!
//! Purpose: trusted evaluation side of the Seed split; JSON-RPC over a Unix
//! socket (`rpc`), SQLite WAL store (`db`), config (`config`), worktrees
//! (`worktree`), sandboxed runs (`sandbox`), metric math (`metrics`),
//! Pareto archive (`pareto`, `archive`), gate pipeline (`evaluation`),
//! promotion safety (`promotion`), candidate records (`candidate`), model
//! profiles (`models`), telemetry ingest (`telemetry`), champion pointer
//! (`champion`), content hashes (`hash`).
//! Why it exists: REQ-SEED-N5PYP0GA — the evaluator must be immutable so
//! evolution cannot corrupt its own judge.
//! Responsibilities: expose only the agent RPC surface; persist every state
//! change; enforce gates before any promotion.
//! Invariants: guardian never imports organism code; promotion and rollback
//! are guardian-only (see scripts/verify-boundaries.ts); the 0600 socket and
//! 1MiB message cap are enforced in `rpc`.
//! Public modules: config, db, rpc, telemetry, worktree, sandbox,
//! candidate, evaluation, metrics, pareto, promotion, archive, champion,
//! models, hash.

// trace:exempt reason=internal-detail
pub mod archive;
// trace:exempt reason=internal-detail
pub mod candidate;
// trace:exempt reason=internal-detail
pub mod champion;
// trace:exempt reason=internal-detail
pub mod config;
// trace:exempt reason=internal-detail
pub mod db;
// trace:exempt reason=internal-detail
pub mod evaluation;
// trace:exempt reason=internal-detail
pub mod hash;
// trace:exempt reason=internal-detail
pub mod metrics;
// trace:exempt reason=internal-detail
pub mod models;
// trace:exempt reason=internal-detail
pub mod pareto;
// trace:exempt reason=internal-detail
pub mod promotion;
// trace:exempt reason=internal-detail
pub mod rpc;
// trace:exempt reason=internal-detail
pub mod sandbox;
// trace:exempt reason=internal-detail
pub mod telemetry;
// trace:exempt reason=internal-detail
pub mod worktree;

/// Guardian daemon version, reported verbatim in `guardian.hello`.
pub const VERSION: &str = "0.1.0";
