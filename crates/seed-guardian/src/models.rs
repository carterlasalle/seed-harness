// models.rs — model profiles and provisional routing.
//
// Purpose: per-model score/cost/latency records plus safe defaults for
// unseen models.
// Why it exists: docs/MODEL_PROFILES.md — the router weights model choice
// by measured score-per-cost; unknown models route generically, never fail.
// Responsibilities: ModelProfile record, provisional fallback, JSON
// roundtrip for the model_profiles table.
// Invariants: provisional profile is generic-safe (empty strengths,
// zero cost/latency, zero tasks); JSON keys match the schema file.
// Public types/functions: ModelProfile, provisional, from_json, to_json.

use serde::{Deserialize, Serialize};

/// Per-model profiler record (schemas/model-profile.schema.json shape).
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.models-profile work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub struct ModelProfile {
    /// Model id.
    pub model: String,
    /// Observed strengths.
    #[serde(default)]
    pub strengths: Vec<String>,
    /// Observed weaknesses.
    #[serde(default)]
    pub weaknesses: Vec<String>,
    /// Mean cost per task.
    #[serde(default)]
    pub cost_per_task: f64,
    /// Median latency ms.
    #[serde(default)]
    pub p50_latency_ms: f64,
    /// Tasks measured.
    #[serde(default)]
    pub tasks_evaluated: u64,
}

/// Generic-safe provisional profile for an unseen model: no claimed
/// strengths, zero cost/latency, zero tasks.
// trace:v1 id=impl.models-provisional work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn provisional(model: &str) -> ModelProfile {
    ModelProfile {
        model: model.to_string(),
        strengths: Vec::new(),
        weaknesses: Vec::new(),
        cost_per_task: 0.0,
        p50_latency_ms: 0.0,
        tasks_evaluated: 0,
    }
}

/// Parse a stored profile blob; errors on bad JSON.
// trace:v1 id=impl.models-from-json work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn from_json(text: &str) -> Result<ModelProfile, String> {
    serde_json::from_str(text).map_err(|e| format!("model profile: {e}"))
}

/// Serialize a profile for the model_profiles table.
// trace:v1 id=impl.models-to-json work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn to_json(profile: &ModelProfile) -> String {
    serde_json::to_string(profile).unwrap_or_else(|_| "{}".to_string())
}
