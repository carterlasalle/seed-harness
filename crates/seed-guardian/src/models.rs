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

/// Per-model registry record (spec section 85 shape).
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.models-profile work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub struct ModelProfile {
    /// Registry id.
    pub id: String,
    /// Provider name.
    pub provider: String,
    /// Concrete model id (schema `modelId`).
    #[serde(rename = "modelId")]
    pub model_id: String,
    /// Model family.
    pub family: String,
    /// First observation timestamp (schema `observedAt`).
    #[serde(rename = "observedAt")]
    pub observed_at: String,
    /// Capability scores 0..1 from probes.
    pub capabilities: ModelCapabilities,
    /// Preferred policy id (schema `preferredPolicyId`).
    #[serde(rename = "preferredPolicyId")]
    pub preferred_policy_id: String,
    /// Lifecycle status (schema `profileStatus`).
    #[serde(rename = "profileStatus")]
    pub profile_status: String,
    /// Legacy display name (model id).
    #[serde(default)]
    pub model: String,
    /// Observed strengths.
    #[serde(default)]
    pub strengths: Vec<String>,
    /// Observed weaknesses.
    #[serde(default)]
    pub weaknesses: Vec<String>,
    /// Mean cost per task (schema `costPerTask`).
    #[serde(default, rename = "costPerTask")]
    pub cost_per_task: f64,
    /// Median latency ms (schema `p50LatencyMs`).
    #[serde(default, rename = "p50LatencyMs")]
    pub p50_latency_ms: f64,
    /// Tasks measured (schema `tasksEvaluated`).
    #[serde(default, rename = "tasksEvaluated")]
    pub tasks_evaluated: u64,
}

/// Capability scores 0..1 (spec section 85).
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.models-capabilities work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub struct ModelCapabilities {
    /// Tool-calling score (schema `toolCalling`).
    #[serde(default, rename = "toolCalling")]
    pub tool_calling: f64,
    /// Editing score.
    #[serde(default)]
    pub editing: f64,
    /// Long-context score (schema `longContext`).
    #[serde(default, rename = "longContext")]
    pub long_context: f64,
    /// Vision score.
    #[serde(default)]
    pub vision: f64,
    /// Parallel-tool score (schema `parallelTools`).
    #[serde(default, rename = "parallelTools")]
    pub parallel_tools: f64,
    /// Instruction-following score (schema `instructionFollowing`).
    #[serde(default, rename = "instructionFollowing")]
    pub instruction_following: f64,
}

/// Generic-safe provisional profile for an unseen model: no claimed
/// strengths, zero cost/latency, zero tasks.
// trace:v1 id=impl.models-provisional work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
pub fn provisional(model: &str) -> ModelProfile {
    ModelProfile {
        id: model.to_string(),
        provider: "unknown".to_string(),
        model_id: model.to_string(),
        family: "unknown".to_string(),
        observed_at: String::new(),
        capabilities: ModelCapabilities {
            tool_calling: 0.0,
            editing: 0.0,
            long_context: 0.0,
            vision: 0.0,
            parallel_tools: 0.0,
            instruction_following: 0.0,
        },
        preferred_policy_id: "generic-safe".to_string(),
        profile_status: "unknown".to_string(),
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
