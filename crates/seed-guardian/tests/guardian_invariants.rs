// guardian_invariants.rs — invariants I1-I12 as individual tests.
//
// Purpose: executable form of the guardian safety invariants; if any of
// these break, the guardian is no longer trustworthy.
// Why it exists: REQ-SEED-N5PYP0GA + REQ-SEED-JJ5Q1072 — invariants as tests.
// Invariants: I1 hello shape; I2 guardian-only methods rejected; I3
// protocol mismatch terminates; I4 tasks pin the session champion; I5
// unknown task.end errors; I6 bad telemetry rejected; I7 rollback targets
// the previous valid ref only; I8 archive capped at 64; I9 promotion needs
// a Champion-terminal state; I10 tolerance boundary; I11 sandbox refuses
// forbidden mounts; I12 schema_version mismatch rejected.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::Value;

use seed_guardian::{
    archive, champion, config, db, metrics, models, pareto, promotion, rpc, sandbox,
};

// trace:exempt reason=internal-detail
static NEXT: AtomicU64 = AtomicU64::new(1);

// trace:exempt reason=internal-detail
fn tmp_db(tag: &str) -> db::Db {
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    let dir: PathBuf =
        std::env::temp_dir().join(format!("seed-inv-{tag}-{}-{n}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db = db::open(&dir.join("g.sqlite")).expect("open");
    db.migrate().expect("migrate");
    db
}

// trace:exempt reason=internal-detail
fn call(db: &db::Db, method: &str, params: Value) -> Value {
    let line = serde_json::json!({"jsonrpc": "2.0", "method": method, "params": params, "id": 1})
        .to_string();
    let resp = rpc::handle_line(db, &line).expect("connection must stay up");
    serde_json::from_str(&resp).expect("response json")
}

// trace:exempt reason=internal-detail
fn metrics() -> metrics::Metrics {
    metrics::Metrics {
        quality: 0.8,
        latency_ms: 100.0,
        tokens: 1000.0,
        cost: 0.01,
        reliability: 0.99,
        complexity: 10.0,
    }
}

#[test]
// trace:v1 id=impl.inv-i1 work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
// trace:exempt reason=unit-test
fn i1_hello_returns_exact_shape() {
    let db = tmp_db("i1");
    let hello = call(&db, "guardian.hello", Value::Null);
    let r = hello.get("result").expect("result");
    assert_eq!(r.get("version").and_then(Value::as_str), Some("0.1.0"));
    assert_eq!(r.get("schema_version").and_then(Value::as_u64), Some(1));
    assert!(r.get("champion_ref").and_then(Value::as_str).is_some());
    assert!(!r
        .get("session_id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .is_empty());
}

#[test]
// trace:v1 id=impl.inv-i2 work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
// trace:exempt reason=unit-test
fn i2_guardian_only_methods_are_method_not_found() {
    let db = tmp_db("i2");
    for method in [
        "candidate.promote",
        "champion.set",
        "eval.expected",
        "guardian.db.query",
        "nope.unknown",
    ] {
        let resp = call(&db, method, Value::Null);
        assert_eq!(
            resp.get("error")
                .and_then(|e| e.get("code"))
                .and_then(Value::as_i64),
            Some(-32601),
            "{method}"
        );
    }
}

#[test]
// trace:v1 id=impl.inv-i3 work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
// trace:exempt reason=unit-test
fn i3_protocol_mismatch_terminates() {
    let db = tmp_db("i3");
    assert!(rpc::handle_line(&db, "garbage{{{").is_none());
    assert!(
        rpc::handle_line(&db, r#"{"jsonrpc":"1.0","method":"guardian.hello","id":1}"#).is_none()
    );
    assert!(rpc::handle_line(&db, &"x".repeat(rpc::MAX_MESSAGE_BYTES + 1)).is_none());
}

#[test]
// trace:v1 id=impl.inv-i4 work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
// trace:exempt reason=unit-test
fn i4_tasks_pin_session_champion() {
    let db = tmp_db("i4");
    champion::set(&db, "champ-a", "baseline").unwrap();
    let hello = call(&db, "guardian.hello", Value::Null);
    let session = hello
        .get("result")
        .and_then(|r| r.get("session_id"))
        .and_then(Value::as_str)
        .unwrap()
        .to_string();
    champion::set(&db, "champ-b", "mid-run promotion").unwrap();
    let begin = call(
        &db,
        "task.begin",
        serde_json::json!({"session_id": session}),
    );
    // In-flight session still sees the champion it started with.
    assert_eq!(
        begin
            .get("result")
            .and_then(|r| r.get("champion_ref"))
            .and_then(Value::as_str),
        Some("champ-a")
    );
}

#[test]
// trace:v1 id=impl.inv-i5 work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
// trace:exempt reason=unit-test
fn i5_unknown_task_end_errors() {
    let db = tmp_db("i5");
    let resp = call(
        &db,
        "task.end",
        serde_json::json!({"task_id": "task-nope", "status": "done"}),
    );
    assert!(resp.get("error").is_some());
    let resp = call(
        &db,
        "task.begin",
        serde_json::json!({"session_id": "sess-nope"}),
    );
    assert!(resp.get("error").is_some());
}

#[test]
// trace:v1 id=impl.inv-i6 work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
// trace:exempt reason=unit-test
fn i6_bad_telemetry_rejected() {
    let db = tmp_db("i6");
    for params in [
        serde_json::json!({"type": "BAD TYPE", "timestamp": "2026-10-01T00:00:00Z", "session": "s"}),
        serde_json::json!({"type": "task.start", "timestamp": "", "session": "s"}),
        serde_json::json!({"type": "task.start", "timestamp": "2026-10-01T00:00:00Z", "session": ""}),
    ] {
        let resp = call(&db, "telemetry.append", params);
        assert!(resp.get("error").is_some());
    }
}

#[test]
// trace:v1 id=impl.inv-i7 work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
// trace:exempt reason=unit-test
fn i7_rollback_targets_previous_valid_only() {
    let db = tmp_db("i7");
    assert!(
        champion::rollback(&db).is_err(),
        "empty history cannot roll back"
    );
    champion::set(&db, "champ-a", "baseline").unwrap();
    assert!(
        champion::rollback(&db).is_err(),
        "single row cannot roll back"
    );
    champion::set(&db, "champ-b", "promoted").unwrap();
    assert_eq!(champion::rollback(&db).unwrap(), "champ-a");
    assert_eq!(champion::current(&db).unwrap(), Some("champ-a".to_string()));
}

#[test]
// trace:v1 id=impl.inv-i8 work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
// trace:exempt reason=unit-test
fn i8_archive_capped_at_64() {
    let db = tmp_db("i8");
    for i in 0..70 {
        let m = metrics::Metrics {
            quality: 0.5 + i as f64 * 0.001,
            ..metrics()
        };
        archive::insert(
            &db,
            &archive::ArchiveEntry {
                candidate_ref: format!("cand-{i:03}"),
                metrics: m,
                tags: vec![format!("tag-{i}")],
                novelty: 0.0,
            },
        )
        .unwrap();
    }
    let members = archive::list(&db).unwrap();
    assert!(
        members.len() <= pareto::ARCHIVE_CAP,
        "len={}",
        members.len()
    );
}

#[test]
// trace:v1 id=impl.inv-i9 work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
// trace:exempt reason=unit-test
fn i9_promotion_needs_champion_terminal_state() {
    let better = metrics::Metrics {
        quality: 0.9,
        ..metrics()
    };
    for state in [
        seed_guardian::evaluation::State::Created,
        seed_guardian::evaluation::State::HoldoutPassed,
        seed_guardian::evaluation::State::Rejected,
        seed_guardian::evaluation::State::Probation,
    ] {
        assert!(
            promotion::can_promote(&better, &metrics(), state, false).is_err(),
            "{state:?}"
        );
    }
    assert!(promotion::can_promote(
        &better,
        &metrics(),
        seed_guardian::evaluation::State::Champion,
        false
    )
    .is_ok());
}

#[test]
// trace:v1 id=impl.inv-i10 work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-JJ5Q1072
// trace:exempt reason=unit-test
fn i10_tolerance_boundary() {
    let champ = metrics();
    // 0.005 inside the default 0.01 tolerance: still non-inferior.
    let inside = metrics::Metrics {
        quality: champ.quality - 0.005,
        ..champ.clone()
    };
    assert!(metrics::non_inferior(&inside, &champ, false));
    // 0.02 outside it: inferior.
    let outside = metrics::Metrics {
        quality: champ.quality - 0.02,
        ..champ.clone()
    };
    assert!(!metrics::non_inferior(&outside, &champ, false));
    // Critical tolerance is stricter: 0.005 slip fails at 0.005.
    let tight = metrics::Metrics {
        quality: champ.quality - 0.008,
        ..champ.clone()
    };
    assert!(metrics::non_inferior(&tight, &champ, false));
    assert!(!metrics::non_inferior(&tight, &champ, true));
}

#[test]
// trace:v1 id=impl.inv-i11 work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
// trace:exempt reason=unit-test
fn i11_sandbox_refuses_forbidden_mounts() {
    let base = sandbox::SandboxOpts {
        candidate_dir: "/tmp/cand".to_string(),
        workspace_dir: "/tmp/ws".to_string(),
        fixture_dir: "/tmp/fix".to_string(),
        ..sandbox::SandboxOpts::default()
    };
    let args = sandbox::build_args(&base).expect("valid opts");
    for flag in [
        "--network",
        "none",
        "--cpus",
        "4",
        "--memory",
        "8g",
        "--pids-limit",
        "512",
    ] {
        assert!(args.iter().any(|a| a == flag), "missing {flag}");
    }
    assert!(args.iter().any(|a| a == "/tmp/cand:/candidate:rw"));
    assert!(args.iter().any(|a| a == "/tmp/fix:/seed-fixture:ro"));
    for bad in [
        "/data/guardian.sqlite",
        "/tmp/.hidden/ws",
        "/srv/guardian-source/x",
    ] {
        let mut opts = base.clone();
        opts.workspace_dir = bad.to_string();
        assert!(sandbox::build_args(&opts).is_err(), "must refuse {bad}");
    }
}

#[test]
// trace:v1 id=impl.inv-i12 work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
// trace:exempt reason=unit-test
fn i12_schema_version_mismatch_rejected() {
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    let path: PathBuf =
        std::env::temp_dir().join(format!("seed-inv-i12-{}-{n}.toml", std::process::id()));
    std::fs::write(&path, "schema_version = 99\n").unwrap();
    assert!(config::load_from_path(&path).is_err());
    let missing: PathBuf = std::env::temp_dir().join(format!(
        "seed-inv-i12-missing-{}-{n}.toml",
        std::process::id()
    ));
    let cfg = config::load_from_path(&missing).expect("missing file yields defaults");
    assert_eq!(cfg.schema_version, config::SCHEMA_VERSION);
    assert!(models::provisional("unseen-model").strengths.is_empty());
}
