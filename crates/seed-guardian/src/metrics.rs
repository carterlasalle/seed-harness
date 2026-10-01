// metrics.rs — candidate metric math.
//
// Purpose: single place for the six promotion axes and their statistics.
// Why it exists: REQ-SEED-JJ5Q1072 — promotion compares candidates to the
// champion on fixed axes with fixed tolerances, never ad-hoc fields.
// Responsibilities: Metrics record, p50/p95 percentiles, non-inferiority.
// Invariants: higher-better = quality, reliability; lower-better = latency,
// tokens, cost, complexity. Default tolerance 0.01, critical 0.005.
// Public types/functions: Metrics, percentile, p50, p95, non_inferior.

use serde::{Deserialize, Serialize};

/// Six promotion axes for one candidate on one evaluation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
// trace:v1 id=impl.metrics-record work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub struct Metrics {
    /// Task success rate, 0..=1, higher is better.
    pub quality: f64,
    /// Milliseconds per task, lower is better.
    pub latency_ms: f64,
    /// Tokens per task, lower is better.
    pub tokens: f64,
    /// Cost per task, lower is better.
    pub cost: f64,
    /// Fraction of runs without infra failure, 0..=1, higher is better.
    pub reliability: f64,
    /// Structural complexity score, lower is better.
    pub complexity: f64,
}

/// Zero metrics: worst on higher-better axes, best on lower-better ones.
// trace:v1 id=impl.metrics-default work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn zero() -> Metrics {
    Metrics {
        quality: 0.0,
        latency_ms: 0.0,
        tokens: 0.0,
        cost: 0.0,
        reliability: 0.0,
        complexity: 0.0,
    }
}

/// Nearest-rank percentile over unsorted samples; None when empty.
// trace:v1 id=impl.metrics-percentile work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn percentile(samples: &[f64], pct: f64) -> Option<f64> {
    if samples.is_empty() || !(0.0..=100.0).contains(&pct) {
        return None;
    }
    let mut sorted = samples.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let rank = ((pct / 100.0 * sorted.len() as f64).ceil() as usize).max(1);
    sorted.get(rank - 1).copied()
}

/// Median of unsorted samples; None when empty.
// trace:v1 id=impl.metrics-p50 work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn p50(samples: &[f64]) -> Option<f64> {
    percentile(samples, 50.0)
}

/// 95th percentile of unsorted samples; None when empty.
// trace:v1 id=impl.metrics-p95 work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn p95(samples: &[f64]) -> Option<f64> {
    percentile(samples, 95.0)
}

/// True when the candidate is no worse than the champion beyond tolerance
/// (0.01 default, 0.005 critical) on every axis.
// trace:v1 id=impl.metrics-noninferior work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn non_inferior(candidate: &Metrics, champion: &Metrics, critical: bool) -> bool {
    let tol = if critical { 0.005 } else { 0.01 };
    candidate.quality >= champion.quality - tol
        && candidate.reliability >= champion.reliability - tol
        && within_tol(candidate.latency_ms, champion.latency_ms, tol)
        && within_tol(candidate.tokens, champion.tokens, tol)
        && within_tol(candidate.cost, champion.cost, tol)
        && within_tol(candidate.complexity, champion.complexity, tol)
}

/// Lower-better comparison with relative tolerance and a floor of 1.0 so a
/// zero baseline still allows only a small absolute slip.
// trace:exempt reason=internal-detail
fn within_tol(candidate: f64, champion: f64, tol: f64) -> bool {
    candidate <= champion + tol * champion.max(1.0)
}
