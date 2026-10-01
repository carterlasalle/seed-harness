// candidate.rs — candidate records, reports, and risk maps.
//
// Purpose: typed view over the `candidates` table plus human-readable
// promotion reports.
// Why it exists: promotion and archive reason over metadata, not raw JSON;
// reports make gate outcomes reviewable.
// Responsibilities: CandidateMetadata, CandidateReport + markdown render,
// risk map derivation.
// Invariants: refs are non-empty; commit SHAs are 40-hex when present;
// risk map always covers network, fs-escape, and provenance.
// Public types/functions: CandidateMetadata, RiskLevel, CandidateReport,
// risk_map, render_report.

use crate::metrics::Metrics;
use serde::{Deserialize, Serialize};

/// Candidate identity and provenance (spec section 18 shape).
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.candidate-metadata work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub struct CandidateMetadata {
    /// Candidate id (primary key).
    pub id: String,
    /// Content ref (worktree commit or blob hash).
    pub ref_str: String,
    /// Parent candidate ref (empty for root).
    pub parent_ref: String,
    /// Git commit SHA under evaluation (empty when not from git).
    pub commit_sha: String,
    /// Model that produced the candidate.
    pub model: String,
    /// Hypothesis ids backing this candidate.
    pub hypotheses: Vec<String>,
    /// Capability tags for novelty (Jaccard input).
    pub tags: Vec<String>,
    /// Whether the run needs network (elevates risk).
    pub needs_network: bool,
}

/// Risk severity for one factor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
// trace:v1 id=impl.candidate-risk work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub enum RiskLevel {
    /// Safe default.
    Low,
    /// Needs reviewer attention.
    Medium,
    /// Blocks auto-promotion.
    High,
}

/// Derive the risk map: network, fs-escape (worktree-less ref), provenance
/// (root candidate with no parent and no hypotheses).
// trace:v1 id=impl.candidate-risk-map work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn risk_map(meta: &CandidateMetadata) -> Vec<(String, RiskLevel)> {
    let mut risks = Vec::with_capacity(3);
    risks.push((
        "network".to_string(),
        if meta.needs_network {
            RiskLevel::High
        } else {
            RiskLevel::Low
        },
    ));
    risks.push((
        "fs-escape".to_string(),
        if meta.ref_str.is_empty() {
            RiskLevel::High
        } else {
            RiskLevel::Low
        },
    ));
    risks.push((
        "provenance".to_string(),
        if meta.parent_ref.is_empty() && meta.hypotheses.is_empty() {
            RiskLevel::Medium
        } else {
            RiskLevel::Low
        },
    ));
    risks
}

/// Evaluation report for one candidate (spec section 63 shape).
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.candidate-report work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub struct CandidateReport {
    /// Candidate identity.
    pub metadata: CandidateMetadata,
    /// Measured metrics.
    pub metrics: Metrics,
    /// Gates passed in order (e.g. ["static","unit"]).
    pub gates_passed: Vec<String>,
    /// Gate that rejected the candidate, if any.
    pub rejected_at: Option<String>,
    /// Risk findings.
    pub risks: Vec<(String, RiskLevel)>,
}

/// Render a one-page markdown report.
// trace:v1 id=impl.candidate-render work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn render_report(report: &CandidateReport) -> String {
    let mut out = String::new();
    out.push_str(&format!("# Candidate {}\n\n", report.metadata.id));
    out.push_str(&format!("ref: {}\n\n", report.metadata.ref_str));
    out.push_str(&format!(
        "metrics: quality={:.3} latency_ms={:.1} tokens={:.0} cost={:.4} reliability={:.3} complexity={:.1}\n\n",
        report.metrics.quality,
        report.metrics.latency_ms,
        report.metrics.tokens,
        report.metrics.cost,
        report.metrics.reliability,
        report.metrics.complexity
    ));
    out.push_str(&format!("gates: {}\n\n", report.gates_passed.join(",")));
    if let Some(gate) = &report.rejected_at {
        out.push_str(&format!("rejected at: {gate}\n\n"));
    }
    out.push_str("risks:\n");
    for (name, level) in &report.risks {
        out.push_str(&format!("- {name}: {level:?}\n"));
    }
    out
}
