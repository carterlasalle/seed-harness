// main.rs — guardian daemon entrypoint.
//
// Purpose: bind the Unix socket, open the WAL store, and serve gated
// JSON-RPC to organism agents.
// Why it exists: REQ-SEED-N5PYP0GA — the daemon is the only writer to the
// store and the only path to promotion.
// Responsibilities: config load, db open+migrate, socket bind, per-line
// dispatch with protocol-mismatch termination.
// Invariants: one request line, one response line; oversize or malformed
// lines terminate the connection, never the daemon.
// Public functions: main (run/serve_one are private helpers).

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use seed_guardian::{config, db, rpc};

/// Serve a single connection: one response line per request line; `None`
/// from `handle_line` (oversize, malformed, wrong version) ends the session.
// trace:v1 id=impl.guardian-serve-one work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
fn serve_one(
    db: &db::Db,
    reader: &mut BufReader<&std::os::unix::net::UnixStream>,
    stream: &std::os::unix::net::UnixStream,
) -> Result<(), String> {
    let mut line = String::new();
    loop {
        line.clear();
        let n = reader
            .read_line(&mut line)
            .map_err(|e| format!("read: {e}"))?;
        if n == 0 {
            return Ok(());
        }
        if line.trim().is_empty() {
            continue;
        }
        if line.len() > rpc::MAX_MESSAGE_BYTES {
            return Ok(());
        }
        match rpc::handle_line(db, &line) {
            Some(resp) => {
                let mut w = stream
                    .try_clone()
                    .map_err(|e| format!("clone stream: {e}"))?;
                w.write_all(resp.as_bytes())
                    .map_err(|e| format!("write: {e}"))?;
                w.write_all(b"\n").map_err(|e| format!("write: {e}"))?;
                w.flush().map_err(|e| format!("flush: {e}"))?;
            }
            None => return Ok(()),
        }
    }
}

// trace:exempt reason=internal-detail
fn socket_path(cfg: &config::Config) -> PathBuf {
    std::env::var("SEED_GUARDIAN_SOCKET")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(&cfg.guardian.socket_path))
}

// trace:exempt reason=internal-detail
fn db_path(cfg: &config::Config) -> PathBuf {
    std::env::var("SEED_GUARDIAN_DB")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(&cfg.db.path))
}

/// Daemon entrypoint: load config, open+migrate the store, bind the 0600
/// socket, and serve connections sequentially.
// trace:v1 id=impl.guardian-main work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
fn main() {
    if let Err(e) = run() {
        eprintln!("seed-guardian: {e}");
        std::process::exit(1);
    }
}

// trace:exempt reason=internal-detail
fn run() -> Result<(), String> {
    let cfg = config::load()?;
    let db_path = db_path(&cfg);
    let db = db::open(Path::new(&db_path))?;
    db.migrate()?;
    let sock = socket_path(&cfg);
    let listener = rpc::bind_socket(Path::new(&sock))?;
    for stream in listener.incoming() {
        let stream = stream.map_err(|e| format!("accept: {e}"))?;
        let mut reader = BufReader::new(&stream);
        // A bad connection ends the session, never the daemon.
        let _ = serve_one(&db, &mut reader, &stream);
    }
    Ok(())
}
