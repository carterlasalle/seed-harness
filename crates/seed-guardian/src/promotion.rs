// promotion.rs — promotion gate and probation tracking.
//
// Purpose: decide when a challenger may replace the champion, and watch
// newly promoted champions during probation.
// Why it exists: REQ-SEED-JJ5Q1072 — promotion needs gates plus
// non-inferiority plus a material Pareto gain; probation catches regressions
// the gates missed.
// Responsibilities: PromotionRecord, can_promote check, Probation tracker.
// Invariants: promotion requires a Champion-terminal state, non-inferior
// metrics, and a meaningful gain; probation runs 10 tasks and rolls back on
// 2 strikes (catastrophic, regression, or explicit rollback request).
// Public types/functions: PromotionRecord, ProbationOutcome,
// Probation, can_promote, record_promotion.

use crate::db::Db;
use crate::evaluation::State;
use crate::metrics::{self, Metrics};
use crate::pareto;
use serde::{Deserialize, Serialize};

/// Probation task count before a promotion sticks.
pub const PROBATION_TASKS: u32 = 10;
/// Strikes that force a rollback during probation.
pub const ROLLBACK_STRIKES: u32 = 2;

/// Durable promotion receipt stored in the `promotions` table.
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.promotion-record work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub struct PromotionRecord {
    /// Promoted candidate ref.
    pub candidate_ref: String,
    /// Champion it replaced.
    pub from_ref: String,
    /// New champion ref (== candidate_ref on success).
    pub to_ref: String,
    /// Gates the candidate passed, in order.
    pub gates_passed: Vec<String>,
    /// Candidate metrics at promotion time.
    pub metrics: Metrics,
    /// Champion metrics at promotion time.
    pub champion_metrics: Metrics,
    /// Probation tasks required.
    pub probation_tasks: u32,
    /// Reason string.
    pub reason: String,
}

/// Approve a promotion: state must be Champion-terminal, metrics
/// non-inferior (critical toggles 0.005 tolerance), and the gain material.
// trace:v1 id=impl.promotion-check work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn can_promote(
    candidate: &Metrics,
    champion: &Metrics,
    state: State,
    critical: bool,
) -> Result<(), String> {
    if state != State::Champion {
        return Err(format!("candidate state {state:?} is not promotable"));
    }
    if !metrics::non_inferior(candidate, champion, critical) {
        return Err("candidate is inferior to champion beyond tolerance".to_string());
    }
    if !pareto::meaningful_gain(candidate, champion) {
        return Err("candidate shows no material gain over champion".to_string());
    }
    Ok(())
}

/// One probation task outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
// trace:v1 id=impl.promotion-outcome work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub enum ProbationOutcome {
    /// Task succeeded.
    Success,
    /// Task succeeded but worse than the old champion (strike).
    Regression,
    /// Task failed catastrophically (strike).
    Catastrophic,
    /// Human asked for rollback (strike).
    ExplicitRollback,
}

/// Probation tracker: 10 tasks, rollback on 2 strikes.
#[derive(Debug, Clone)]
// trace:v1 id=impl.promotion-probation work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub struct Probation {
    completed: u32,
    strikes: u32,
}

// trace:exempt reason=internal-detail
impl Probation {
    /// Fresh tracker with nothing observed.
    // trace:exempt reason=internal-detail
    pub fn new() -> Self {
        Self {
            completed: 0,
            strikes: 0,
        }
    }

    /// Record one task outcome.
    // trace:exempt reason=internal-detail
    pub fn observe(&mut self, outcome: ProbationOutcome) {
        self.completed += 1;
        if outcome != ProbationOutcome::Success {
            self.strikes += 1;
        }
    }

    /// True once 10 tasks ran without triggering rollback.
    // trace:exempt reason=internal-detail
    pub fn passed(&self) -> bool {
        self.completed >= PROBATION_TASKS && self.strikes < ROLLBACK_STRIKES
    }

    /// True once 2 strikes accumulate.
    // trace:exempt reason=internal-detail
    pub fn must_rollback(&self) -> bool {
        self.strikes >= ROLLBACK_STRIKES
    }
}

// trace:exempt reason=internal-detail
impl Default for Probation {
    // trace:exempt reason=internal-detail
    fn default() -> Self {
        Self::new()
    }
}

/// Persist a promotion receipt and return it.
// trace:v1 id=impl.promotion-record-fn work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn record_promotion(
    db: &Db,
    candidate_ref: &str,
    from_ref: &str,
    gates_passed: Vec<String>,
    metrics: &Metrics,
    champion_metrics: &Metrics,
    reason: &str,
) -> Result<PromotionRecord, String> {
    let record = PromotionRecord {
        candidate_ref: candidate_ref.to_string(),
        from_ref: from_ref.to_string(),
        to_ref: candidate_ref.to_string(),
        gates_passed,
        metrics: metrics.clone(),
        champion_metrics: champion_metrics.clone(),
        probation_tasks: PROBATION_TASKS,
        reason: reason.to_string(),
    };
    let json = serde_json::to_string(&record).unwrap_or_else(|_| "{}".to_string());
    db.insert_promotion(candidate_ref, from_ref, candidate_ref, &json)?;
    Ok(record)
}
