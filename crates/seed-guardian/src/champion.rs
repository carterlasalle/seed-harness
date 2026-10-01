// champion.rs — champion pointer get/set/history/rollback.
//
// Purpose: single-serving champion ref with atomic moves and one-step
// rollback, per docs/EVALUATION.md.
// Why it exists: exactly one champion serves; sessions pin it at start so
// mid-run promotions never leak into in-flight tasks.
// Responsibilities: read current ref, append new ref, list history, roll
// back to the immediate predecessor only.
// Invariants: rollback targets the previous row only (never an arbitrary
// ref); rollback is one appended row, history stays append-only.
// Public functions: current, set, history, rollback.

use crate::db::Db;

/// Latest champion ref; None when never set.
// trace:v1 id=impl.champion-current work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn current(db: &Db) -> Result<Option<String>, String> {
    db.current_champion()
}

/// Move the pointer by appending one row (atomic single write).
// trace:v1 id=impl.champion-set work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn set(db: &Db, candidate_ref: &str, reason: &str) -> Result<(), String> {
    if candidate_ref.is_empty() {
        return Err("champion ref must not be empty".to_string());
    }
    db.push_champion(candidate_ref, reason)
}

/// History newest-first as (ref, reason, set_at).
// trace:v1 id=impl.champion-history work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn history(db: &Db) -> Result<Vec<(String, String, String)>, String> {
    db.champion_history()
}

/// Roll back to the immediate predecessor only; errors with fewer than two
/// rows or when the predecessor ref is empty.
// trace:v1 id=impl.champion-rollback work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn rollback(db: &Db) -> Result<String, String> {
    let hist = db.champion_history()?;
    if hist.len() < 2 {
        return Err("rollback needs at least two champion rows".to_string());
    }
    let previous = hist[1].0.clone();
    if previous.is_empty() {
        return Err("previous champion ref is empty".to_string());
    }
    db.push_champion(&previous, "rollback")?;
    Ok(previous)
}
