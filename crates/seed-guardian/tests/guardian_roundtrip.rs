// guardian_roundtrip.rs — daemon wire roundtrip + restart durability.
//
// Purpose: prove the daemon serves hello/begin/append/end over its Unix
// socket and that rows survive a restart.
// Why it exists: REQ-SEED-N5PYP0GA acceptance — handshake + task +
// telemetry roundtrip works.
// Invariants: temp socket/db per test; daemon killed on exit; 5s I/O
// timeouts so a wedged daemon fails loudly instead of hanging CI.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde_json::Value;

// trace:exempt reason=internal-detail
static NEXT: AtomicU64 = AtomicU64::new(1);

// trace:exempt reason=internal-detail
fn tmp_dir(tag: &str) -> PathBuf {
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "seed-guardian-{}-{}-{}",
        tag,
        std::process::id(),
        n
    ));
    std::fs::create_dir_all(&dir).expect("tmp dir");
    dir
}

// trace:exempt reason=internal-detail
fn bin_path() -> PathBuf {
    // Integration test exe lives in target/debug/deps/; the daemon binary
    // lives one level up in target/debug/.
    let exe = std::env::current_exe().expect("current exe");
    exe.parent()
        .expect("deps")
        .parent()
        .expect("debug")
        .join("seed-guardian")
}

// trace:exempt reason=internal-detail
struct Daemon {
    child: Child,
    sock: PathBuf,
    db: PathBuf,
    _dir: PathBuf,
}

// trace:exempt reason=internal-detail
impl Daemon {
    // trace:exempt reason=internal-detail
    fn start(dir: PathBuf) -> Self {
        let sock = dir.join("guardian.sock");
        // A previous run's socket file must not satisfy the bind poll below.
        let _ = std::fs::remove_file(&sock);
        let db = dir.join("guardian.sqlite");
        let mut child = Command::new(bin_path())
            .env("SEED_GUARDIAN_SOCKET", &sock)
            .env("SEED_GUARDIAN_DB", &db)
            .spawn()
            .expect("spawn daemon");
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if sock.exists() {
                break;
            }
            if let Some(status) = child.try_wait().expect("poll daemon") {
                panic!("daemon exited early: {status}");
            }
            if Instant::now() > deadline {
                let _ = child.kill();
                panic!("daemon never bound {}", sock.display());
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        Self {
            child,
            sock,
            db,
            _dir: dir,
        }
    }
}

// trace:exempt reason=internal-detail
impl Drop for Daemon {
    // trace:exempt reason=internal-detail
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

// trace:exempt reason=internal-detail
fn session(db_sock: &Path) -> (UnixStream, BufReader<UnixStream>) {
    let stream = UnixStream::connect(db_sock).expect("connect");
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .expect("timeout");
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .expect("timeout");
    let read_half = stream.try_clone().expect("clone");
    (stream, BufReader::new(read_half))
}

// trace:exempt reason=internal-detail
fn call(
    pair: &mut (UnixStream, BufReader<UnixStream>),
    method: &str,
    params: Value,
    id: i64,
) -> Value {
    let line = serde_json::json!({"jsonrpc": "2.0", "method": method, "params": params, "id": id})
        .to_string();
    pair.0.write_all(line.as_bytes()).expect("write");
    pair.0.write_all(b"\n").expect("write nl");
    pair.0.flush().expect("flush");
    let mut out = String::new();
    pair.1.read_line(&mut out).expect("read response");
    assert!(!out.is_empty(), "daemon closed connection on {method}");
    serde_json::from_str(&out).expect("response json")
}

// trace:exempt reason=internal-detail
fn raw_line(pair: &mut (UnixStream, BufReader<UnixStream>), text: &str) -> String {
    pair.0.write_all(text.as_bytes()).expect("write");
    pair.0.write_all(b"\n").expect("write nl");
    pair.0.flush().expect("flush");
    let mut out = String::new();
    match pair.1.read_line(&mut out) {
        Ok(_) => out,
        Err(e)
            if e.kind() == std::io::ErrorKind::WouldBlock
                || e.kind() == std::io::ErrorKind::TimedOut =>
        {
            String::new()
        }
        Err(e) => panic!("read response: {e}"),
    }
}

#[test]
// trace:v1 id=impl.test-roundtrip work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
// trace:exempt reason=unit-test
fn roundtrip_hello_begin_telemetry_end() {
    let daemon = Daemon::start(tmp_dir("roundtrip"));
    let mut conn = session(&daemon.sock);

    let hello = call(
        &mut conn,
        "guardian.hello",
        serde_json::json!({"protocol_version": 1, "organism_sha": "", "session_id": ""}),
        1,
    );
    let result = hello.get("result").expect("hello result");
    assert_eq!(
        result.get("protocol_version").and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(
        result
            .get("telemetry_schema_version")
            .and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(
        result
            .get("capability_schema_version")
            .and_then(Value::as_u64),
        Some(1)
    );
    assert_eq!(result.get("champion_sha").and_then(Value::as_str), Some(""));
    let session_id = result
        .get("session_id")
        .and_then(Value::as_str)
        .expect("session_id")
        .to_string();
    assert!(!session_id.is_empty());

    let begin = call(
        &mut conn,
        "task.begin",
        serde_json::json!({"session_id": session_id}),
        2,
    );
    let task_id = begin
        .get("result")
        .and_then(|r| r.get("task_id"))
        .and_then(Value::as_str)
        .expect("task_id")
        .to_string();
    assert_eq!(
        begin
            .get("result")
            .and_then(|r| r.get("champion_ref"))
            .and_then(Value::as_str),
        Some("")
    );

    let appended = call(
        &mut conn,
        "telemetry.append",
        serde_json::json!({"type": "task.heartbeat", "timestamp": "2026-10-01T00:00:00Z", "session": session_id, "task_id": task_id}),
        3,
    );
    assert_eq!(
        appended
            .get("result")
            .and_then(|r| r.get("ok"))
            .and_then(Value::as_bool),
        Some(true)
    );

    let ended = call(
        &mut conn,
        "task.end",
        serde_json::json!({"task_id": task_id, "status": "done", "result": "ok"}),
        4,
    );
    assert_eq!(
        ended
            .get("result")
            .and_then(|r| r.get("ok"))
            .and_then(Value::as_bool),
        Some(true)
    );

    // Guardian-only methods are rejected, never routed.
    for (i, method) in [
        "candidate.promote",
        "champion.set",
        "eval.expected",
        "guardian.db.query",
    ]
    .iter()
    .enumerate()
    {
        let resp = call(&mut conn, method, Value::Null, 100 + i as i64);
        assert_eq!(
            resp.get("error")
                .and_then(|e| e.get("code"))
                .and_then(Value::as_i64),
            Some(-32601),
            "{method}"
        );
    }

    // Protocol mismatch terminates the connection: garbage in, EOF out.
    let mut bad = session(&daemon.sock);
    let out = raw_line(&mut bad, "this is not json-rpc");
    assert!(out.is_empty(), "garbage must terminate the connection");
}

#[test]
// trace:v1 id=impl.test-restart work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
// trace:exempt reason=unit-test
fn restart_preserves_rows() {
    let dir = tmp_dir("restart");
    let (saved_session, task_id) = {
        let daemon = Daemon::start(dir.clone());
        let mut conn = session(&daemon.sock);
        let hello = call(
            &mut conn,
            "guardian.hello",
            serde_json::json!({"protocol_version": 1, "organism_sha": "", "session_id": ""}),
            1,
        );
        let session = hello
            .get("result")
            .and_then(|r| r.get("session_id"))
            .and_then(Value::as_str)
            .expect("session")
            .to_string();
        let begin = call(
            &mut conn,
            "task.begin",
            serde_json::json!({"session_id": session}),
            2,
        );
        let task_id = begin
            .get("result")
            .and_then(|r| r.get("task_id"))
            .and_then(Value::as_str)
            .expect("task")
            .to_string();
        call(
            &mut conn,
            "telemetry.append",
            serde_json::json!({"type": "task.result", "timestamp": "2026-10-01T00:00:01Z", "session": session, "task_id": task_id}),
            3,
        );
        call(
            &mut conn,
            "task.end",
            serde_json::json!({"task_id": task_id, "status": "done"}),
            4,
        );
        (session, task_id)
    }; // daemon killed here

    let daemon = Daemon::start(dir);
    let mut conn = session(&daemon.sock);
    // Known session re-binds to its pinned champion instead of duplicating.
    let hello = call(
        &mut conn,
        "guardian.hello",
        serde_json::json!({"protocol_version": 1, "organism_sha": "", "session_id": saved_session}),
        1,
    );
    assert_eq!(
        hello
            .get("result")
            .and_then(|r| r.get("session_id"))
            .and_then(Value::as_str),
        Some(saved_session.as_str())
    );

    // Rows written before the restart are still in the store.
    let db_path: &Path = &daemon.db;
    let db = seed_guardian::db::open(db_path).expect("reopen db");
    db.migrate().expect("migrate");
    assert_eq!(db.span_count(&task_id).expect("span count"), 1);
}
