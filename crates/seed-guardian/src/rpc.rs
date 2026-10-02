// rpc.rs — newline-delimited JSON-RPC 2.0 over a Unix socket.
//
// Purpose: the only wire into the guardian; agent-side methods for hello,
// tasks, telemetry, artifacts, candidates, experiments, capabilities, and
// model observations.
// Why it exists: REQ-SEED-N5PYP0GA — every state change goes through gated
// RPC; promotion-adjacent methods stay guardian-only and are rejected here.
// Responsibilities: request routing, hello shape, 0600 socket bind,
// 1MiB message cap; protocol mismatch terminates the connection.
// Invariants: AGENT_METHODS is the full callable set; FORBIDDEN_METHODS
// always answer -32601; any non-JSON-RPC-2.0 line closes the connection;
// oversize lines close the connection.
// Public items: MAX_MESSAGE_BYTES, AGENT_METHODS, FORBIDDEN_METHODS,
// HelloResult, handle_line, bind_socket, new_id.

use crate::db::{Artifact, Db};
use crate::telemetry::{self, TelemetryEvent};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixListener;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Max JSON-RPC line bytes; larger lines terminate the connection.
pub const MAX_MESSAGE_BYTES: usize = 1024 * 1024;

/// Agent-callable methods (hello/task/telemetry surface).
pub const AGENT_METHODS: &[&str] = &[
    "guardian.hello",
    "task.begin",
    "task.end",
    "telemetry.append",
    "artifact.register",
    "candidate.submit",
    "experiment.request",
    "capability.propose",
    "model.observed",
    "champion.show",
    "champion.history",
];

/// Guardian-only methods: rejected with method-not-found, never routed.
// trace:exempt reason=internal-detail
pub const FORBIDDEN_METHODS: &[&str] = &[
    "candidate.promote",
    "champion.set",
    "eval.expected",
    "guardian.db.query",
];

#[derive(Deserialize)]
// trace:exempt reason=internal-detail
struct Request {
    jsonrpc: String,
    method: String,
    #[serde(default)]
    params: Option<Value>,
    #[serde(default)]
    id: Option<Value>,
}

/// Exact `guardian.hello` result shape (spec section 15): protocol version,
/// pinned champion sha, and telemetry/capability schema versions.
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.rpc-hello-result work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct HelloResult {
    /// Agent protocol version (spec section 15: 1).
    pub protocol_version: u32,
    /// Champion sha pinned to the session ("" when unset).
    pub champion_sha: String,
    /// Telemetry event schema version.
    pub telemetry_schema_version: u32,
    /// Capability manifest schema version.
    pub capability_schema_version: u32,
    /// Session id (echoed when the caller supplied a known one).
    pub session_id: String,
}

// trace:exempt reason=internal-detail
static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

/// Unique `<prefix>-<pid>-<nanos>-<counter>` id for sessions/tasks/artifacts.
// trace:v1 id=impl.rpc-new-id work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn new_id(prefix: &str) -> String {
    let n = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{prefix}-{}-{nanos}-{n}", std::process::id())
}

// trace:exempt reason=internal-detail
fn respond(id: &Option<Value>, result: Value) -> String {
    serde_json::json!({"jsonrpc": "2.0", "result": result, "id": id.clone().unwrap_or(Value::Null)})
        .to_string()
}

// trace:exempt reason=internal-detail
fn fail(id: &Option<Value>, code: i32, message: &str) -> String {
    serde_json::json!({"jsonrpc": "2.0", "error": {"code": code, "message": message}, "id": id.clone().unwrap_or(Value::Null)}).to_string()
}

// trace:v1 id=impl.rpc-hello-value work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
fn hello_value(champion_sha: &str, session_id: &str) -> Value {
    serde_json::to_value(HelloResult {
        protocol_version: 1,
        champion_sha: champion_sha.to_string(),
        telemetry_schema_version: 1,
        capability_schema_version: 1,
        session_id: session_id.to_string(),
    })
    .unwrap_or(Value::Null)
}

/// Route one JSON-RPC line; `None` means terminate the connection
/// (unparseable, wrong version, or oversize). Unknown and guardian-only
/// methods answer -32601 without terminating.
// trace:v1 id=impl.rpc-handle-line work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn handle_line(db: &Db, line: &str) -> Option<String> {
    let line = line.trim_end_matches(['\n', '\r']);
    if line.is_empty() || line.len() > MAX_MESSAGE_BYTES {
        return None;
    }
    let req: Request = serde_json::from_str(line).ok()?;
    if req.jsonrpc != "2.0" {
        return None;
    }
    if FORBIDDEN_METHODS.contains(&req.method.as_str())
        || !AGENT_METHODS.contains(&req.method.as_str())
    {
        return Some(fail(&req.id, -32601, "method not found"));
    }
    let params = req.params.unwrap_or(Value::Null);
    let out = match req.method.as_str() {
        "guardian.hello" => hello(db, &req.id, &params),
        "task.begin" => task_begin(db, &req.id, &params),
        "task.end" => task_end(db, &req.id, &params),
        "telemetry.append" => telemetry_append(db, &req.id, &params),
        "artifact.register" => artifact_register(db, &req.id, &params),
        "candidate.submit" => candidate_submit(db, &req.id, &params),
        "experiment.request" => experiment_request(db, &req.id, &params),
        "capability.propose" => capability_propose(db, &req.id, &params),
        "model.observed" => model_observed(db, &req.id, &params),
        "champion.show" => champion_show(db, &req.id),
        "champion.history" => champion_history(db, &req.id),
        _ => fail(&req.id, -32601, "method not found"),
    };
    Some(out)
}

// trace:exempt reason=internal-detail
fn str_param(params: &Value, key: &str) -> Option<String> {
    params.get(key)?.as_str().map(str::to_string)
}

// trace:exempt reason=internal-detail
fn hello(db: &Db, id: &Option<Value>, params: &Value) -> String {
    // Spec section 15: params carry protocol_version/organism_sha/session_id;
    // any protocol_version other than 1 terminates startup (error here;
    // the daemon closes on non-2.0 envelopes in handle_line/serve_one).
    match params.get("protocol_version") {
        Some(v) if v.as_u64() == Some(1) => {}
        _ => return fail(id, -32602, "guardian.hello needs protocol_version 1"),
    }
    let requested = str_param(params, "session_id").unwrap_or_default();
    if !requested.is_empty() {
        match db.session_champion(&requested) {
            Ok(Some(pinned)) => return respond(id, hello_value(&pinned, &requested)),
            Ok(None) => {}
            Err(e) => return fail(id, -32603, &e),
        }
    }
    let session_id = if requested.is_empty() {
        new_id("sess")
    } else {
        requested
    };
    let champion = db.current_champion().unwrap_or(None).unwrap_or_default();
    match db.insert_session(&session_id, &champion) {
        Ok(()) => respond(id, hello_value(&champion, &session_id)),
        Err(e) => fail(id, -32603, &e),
    }
}

// trace:exempt reason=internal-detail
fn task_begin(db: &Db, id: &Option<Value>, params: &Value) -> String {
    let Some(session_id) = str_param(params, "session_id") else {
        return fail(id, -32602, "task.begin needs session_id");
    };
    let pinned = match db.session_champion(&session_id) {
        Ok(Some(c)) => c,
        Ok(None) => return fail(id, -32602, "unknown session_id"),
        Err(e) => return fail(id, -32603, &e),
    };
    let task_id = new_id("task");
    match db.insert_task(&task_id, &session_id, &pinned) {
        Ok(()) => respond(
            id,
            serde_json::json!({"task_id": task_id, "champion_ref": pinned, "session_id": session_id}),
        ),
        Err(e) => fail(id, -32603, &e),
    }
}

// trace:exempt reason=internal-detail
fn task_end(db: &Db, id: &Option<Value>, params: &Value) -> String {
    let Some(task_id) = str_param(params, "task_id") else {
        return fail(id, -32602, "task.end needs task_id");
    };
    let status = str_param(params, "status").unwrap_or_else(|| "done".to_string());
    let result = str_param(params, "result").unwrap_or_default();
    match db.end_task(&task_id, &status, &result) {
        Ok(()) => respond(id, serde_json::json!({"ok": true, "task_id": task_id})),
        Err(e) => fail(id, -32602, &e),
    }
}

// trace:exempt reason=internal-detail
fn telemetry_append(db: &Db, id: &Option<Value>, params: &Value) -> String {
    let event: Result<TelemetryEvent, _> = serde_json::from_value(params.clone());
    let Ok(event) = event else {
        return fail(id, -32602, "telemetry.append needs an event envelope");
    };
    match telemetry::append(db, &event) {
        Ok(()) => respond(id, serde_json::json!({"ok": true})),
        Err(e) => fail(id, -32602, &e),
    }
}

// trace:exempt reason=internal-detail
fn artifact_register(db: &Db, id: &Option<Value>, params: &Value) -> String {
    let (Some(name), Some(sha256)) = (str_param(params, "name"), str_param(params, "sha256"))
    else {
        return fail(id, -32602, "artifact.register needs name and sha256");
    };
    let art_id = str_param(params, "id").unwrap_or_else(|| new_id("art"));
    let task_id = str_param(params, "task_id").unwrap_or_default();
    let session_id = str_param(params, "session_id").unwrap_or_default();
    let bytes = params.get("bytes").and_then(Value::as_i64).unwrap_or(0);
    let media_type =
        str_param(params, "media_type").unwrap_or_else(|| "application/octet-stream".to_string());
    let art = Artifact {
        id: &art_id,
        task_id: &task_id,
        session_id: &session_id,
        name: &name,
        sha256: &sha256,
        bytes,
        media_type: &media_type,
    };
    match db.insert_artifact(art) {
        Ok(()) => respond(id, serde_json::json!({"id": art_id})),
        Err(e) => fail(id, -32603, &e),
    }
}

// trace:exempt reason=internal-detail
fn candidate_submit(db: &Db, id: &Option<Value>, params: &Value) -> String {
    let Some(cid) = str_param(params, "id") else {
        return fail(id, -32602, "candidate.submit needs id");
    };
    let ref_str = str_param(params, "ref").unwrap_or_default();
    let parent_ref = str_param(params, "parent_ref").unwrap_or_default();
    let metrics = params
        .get("metrics")
        .map(Value::to_string)
        .unwrap_or_else(|| "{}".to_string());
    match db.insert_candidate(&cid, &ref_str, &parent_ref, "created", &metrics) {
        Ok(()) => respond(id, serde_json::json!({"id": cid, "status": "created"})),
        Err(e) => fail(id, -32603, &e),
    }
}

// trace:exempt reason=internal-detail
fn experiment_request(db: &Db, id: &Option<Value>, params: &Value) -> String {
    let (Some(eid), Some(candidate_ref)) =
        (str_param(params, "id"), str_param(params, "candidate_ref"))
    else {
        return fail(id, -32602, "experiment.request needs id and candidate_ref");
    };
    match db.insert_experiment(&eid, &candidate_ref) {
        Ok(()) => respond(id, serde_json::json!({"id": eid})),
        Err(e) => fail(id, -32603, &e),
    }
}

// trace:exempt reason=internal-detail
fn capability_propose(db: &Db, id: &Option<Value>, params: &Value) -> String {
    let (Some(name), Some(version)) = (str_param(params, "name"), str_param(params, "version"))
    else {
        return fail(id, -32602, "capability.propose needs name and version");
    };
    match db.propose_capability(&name, &version) {
        Ok(()) => respond(id, serde_json::json!({"ok": true})),
        Err(e) => fail(id, -32603, &e),
    }
}

// trace:exempt reason=internal-detail
fn model_observed(db: &Db, id: &Option<Value>, params: &Value) -> String {
    let Some(model) = str_param(params, "model") else {
        return fail(id, -32602, "model.observed needs model");
    };
    let task_id = str_param(params, "task_id").unwrap_or_default();
    let score = params.get("score").and_then(Value::as_f64).unwrap_or(0.0);
    let latency_ms = params
        .get("latency_ms")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let cost = params.get("cost").and_then(Value::as_f64).unwrap_or(0.0);
    if let Err(e) = db.insert_probe(&model, &task_id, score, latency_ms, cost) {
        return fail(id, -32603, &e);
    }
    match db.model_profile(&model) {
        Ok(Some(_)) => respond(id, serde_json::json!({"ok": true})),
        Ok(None) => {
            let provisional = crate::models::to_json(&crate::models::provisional(&model));
            match db.upsert_model_profile(&model, &provisional) {
                Ok(()) => respond(id, serde_json::json!({"ok": true})),
                Err(e) => fail(id, -32603, &e),
            }
        }
        Err(e) => fail(id, -32603, &e),
    }
}

/// Read-only champion pointer for CLI show (single truth: guardian SQLite).
// trace:v1 id=impl.rpc-champion-show work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
fn champion_show(db: &Db, id: &Option<Value>) -> String {
    match crate::champion::current(db) {
        Ok(current) => respond(id, serde_json::json!({"ref": current.unwrap_or_default()})),
        Err(e) => fail(id, -32603, &e),
    }
}

/// Read-only champion history for CLI history (append-only rows).
// trace:v1 id=impl.rpc-champion-history work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
fn champion_history(db: &Db, id: &Option<Value>) -> String {
    match crate::champion::history(db) {
        Ok(rows) => respond(
            id,
            serde_json::json!({"history": rows.iter().map(|(r, reason, at)| serde_json::json!({"ref": r, "reason": reason, "at": at})).collect::<Vec<_>>()}),
        ),
        Err(e) => fail(id, -32603, &e),
    }
}

/// Bind a Unix socket at `path` (creating parents, replacing stale files)
/// with mode 0600.
// trace:v1 id=impl.rpc-bind-socket work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn bind_socket(path: &Path) -> Result<UnixListener, String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
    }
    let _ = std::fs::remove_file(path);
    let listener = UnixListener::bind(path).map_err(|e| format!("bind {}: {e}", path.display()))?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|e| format!("chmod 0600 {}: {e}", path.display()))?;
    Ok(listener)
}
