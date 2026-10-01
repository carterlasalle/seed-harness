// telemetry.rs — telemetry ingest and validation.
//
// Purpose: validate the organism event envelope and persist it as spans.
// Why it exists: schemas/event.schema.json is the contract; the guardian
// persists every event to SQLite WAL so friction rules and evals read one
// durable stream.
// Responsibilities: TelemetryEvent record, envelope validation, db append.
// Invariants: type matches ^[a-z]+\.[a-z-]+$; timestamp and session are
// non-empty; payload defaults to {}; candidate defaults to "".
// Public types/functions: TelemetryEvent, validate, append.

use crate::db::Db;
use serde::{Deserialize, Serialize};

/// One organism event (schemas/event.schema.json shape).
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.telemetry-event work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct TelemetryEvent {
    /// Dotted kind, e.g. "task.start".
    #[serde(rename = "type")]
    pub typ: String,
    /// RFC3339 timestamp string.
    pub timestamp: String,
    /// Owning session id.
    pub session: String,
    /// Optional task id (span index, not part of the schema envelope).
    #[serde(default)]
    pub task_id: String,
    /// Optional JSON payload object.
    #[serde(default = "default_payload")]
    pub payload: serde_json::Value,
    /// Optional candidate ref under evaluation.
    #[serde(default)]
    pub candidate: String,
}

// trace:exempt reason=internal-detail
fn default_payload() -> serde_json::Value {
    serde_json::json!({})
}

// trace:exempt reason=internal-detail
fn valid_type(typ: &str) -> bool {
    let mut parts = typ.split('.');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(a), Some(b), None) => {
            !a.is_empty()
                && !b.is_empty()
                && a.bytes().all(|c| c.is_ascii_lowercase())
                && b.bytes().all(|c| c.is_ascii_lowercase() || c == b'-')
        }
        _ => false,
    }
}

/// Reject envelopes with a bad type, empty timestamp, or empty session.
// trace:v1 id=impl.telemetry-validate work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn validate(event: &TelemetryEvent) -> Result<(), String> {
    if !valid_type(&event.typ) {
        return Err(format!("bad event type {:?}", event.typ));
    }
    if event.timestamp.is_empty() {
        return Err("event timestamp must not be empty".to_string());
    }
    if event.session.is_empty() {
        return Err("event session must not be empty".to_string());
    }
    Ok(())
}

/// Validate then persist one event as a span row.
// trace:v1 id=impl.telemetry-append work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn append(db: &Db, event: &TelemetryEvent) -> Result<(), String> {
    validate(event)?;
    let payload = serde_json::to_string(&event.payload).unwrap_or_else(|_| "{}".to_string());
    db.insert_span(
        &event.session,
        &event.task_id,
        &event.typ,
        &event.timestamp,
        &payload,
        &event.candidate,
    )
}
