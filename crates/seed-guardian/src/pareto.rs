// pareto.rs — Pareto dominance, meaningful gain, archive eviction, novelty.
//
// Purpose: multi-objective comparison over Metrics plus a capped archive.
// Why it exists: REQ-SEED-JJ5Q1072 — promotion needs non-inferiority plus a
// material Pareto gain; the archive stays capped via dominate-and-evict.
// Responsibilities: dominates, meaningful_gain, eviction choice, Jaccard.
// Invariants: tolerance-aware no-worse on every axis; meaningful thresholds
// quality +0.01 / latency-tokens-cost 10% / reliability +0.01 / complexity
// 20%; archive cap 64.
// Public functions/constants: ARCHIVE_CAP, dominates, meaningful_gain,
// eviction_index, jaccard, novelty.

use crate::metrics::Metrics;

/// Max Pareto archive members.
pub const ARCHIVE_CAP: usize = 64;

/// True when the candidate beats the champion materially on at least one
/// axis: quality +0.01, reliability +0.01, latency/tokens/cost 10% lower,
/// or complexity 20% lower.
// trace:v1 id=impl.pareto-meaningful work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn meaningful_gain(candidate: &Metrics, champion: &Metrics) -> bool {
    if candidate.quality >= champion.quality + 0.01 {
        return true;
    }
    if candidate.reliability >= champion.reliability + 0.01 {
        return true;
    }
    if lower_by(candidate.latency_ms, champion.latency_ms, 0.10) {
        return true;
    }
    if lower_by(candidate.tokens, champion.tokens, 0.10) {
        return true;
    }
    if lower_by(candidate.cost, champion.cost, 0.10) {
        return true;
    }
    if lower_by(candidate.complexity, champion.complexity, 0.20) {
        return true;
    }
    false
}

// trace:exempt reason=internal-detail
fn lower_by(candidate: f64, champion: f64, frac: f64) -> bool {
    if champion <= 0.0 {
        return candidate < champion;
    }
    candidate <= champion * (1.0 - frac)
}

/// True when `a` is no worse than `b` beyond tolerance on every axis and
/// materially better on at least one.
// trace:v1 id=impl.pareto-dominates work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn dominates(a: &Metrics, b: &Metrics) -> bool {
    crate::metrics::non_inferior(a, b, false) && meaningful_gain(a, b)
}

/// Jaccard similarity over tag sets; 1.0 when both empty.
// trace:v1 id=impl.pareto-jaccard work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn jaccard(a: &[String], b: &[String]) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    let set_a: std::collections::HashSet<&str> = a.iter().map(String::as_str).collect();
    let set_b: std::collections::HashSet<&str> = b.iter().map(String::as_str).collect();
    let inter = set_a.intersection(&set_b).count() as f64;
    let union = set_a.union(&set_b).count() as f64;
    if union == 0.0 {
        1.0
    } else {
        inter / union
    }
}

/// Novelty of `tags` against archive tag sets: 1 minus the max Jaccard.
// trace:v1 id=impl.pareto-novelty work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn novelty(tags: &[String], archive: &[Vec<String>]) -> f64 {
    let mut best = 0.0;
    for other in archive {
        let sim = jaccard(tags, other);
        if sim > best {
            best = sim;
        }
    }
    1.0 - best
}

/// Eviction index when the archive is full: first a member dominated by
/// another (lowest novelty among dominated), else the least novel
/// (most redundant). None when empty.
// trace:v1 id=impl.pareto-evict work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn eviction_index(members: &[(Metrics, f64)]) -> Option<usize> {
    if members.is_empty() {
        return None;
    }
    let mut dominated: Vec<usize> = Vec::new();
    for (i, (mi, _)) in members.iter().enumerate() {
        for (j, (mj, _)) in members.iter().enumerate() {
            if i != j && dominates(mj, mi) {
                dominated.push(i);
                break;
            }
        }
    }
    let pool: Vec<usize> = if dominated.is_empty() {
        (0..members.len()).collect()
    } else {
        dominated
    };
    pool.into_iter().min_by(|a, b| {
        members[*a]
            .1
            .partial_cmp(&members[*b].1)
            .unwrap_or(std::cmp::Ordering::Equal)
    })
}
