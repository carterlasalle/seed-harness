// db.rs — SQLite WAL store and migrations.
//
// Purpose: durable record for sessions, tasks, telemetry, artifacts,
// candidates, evals, archive, promotions, and model profiles.
// Why it exists: REQ-SEED-N5PYP0GA — every state change persists through
// gated RPC so restarts lose nothing.
// Responsibilities: open with WAL+FK+NORMAL pragmas, create all 25 tables,
// typed insert/query helpers.
// Invariants: journal_mode=WAL, foreign_keys=ON, synchronous=NORMAL;
// every table carries created timestamps; migrations are idempotent.
// Public types/functions: Db, open, and insert/query helpers below.

use rusqlite::{params, Connection};
use std::path::Path;

/// Artifact blob reference for `Db::insert_artifact`.
// trace:v1 id=impl.db-artifact work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct Artifact<'a> {
    /// Artifact id (primary key).
    pub id: &'a str,
    /// Owning task id.
    pub task_id: &'a str,
    /// Owning session id.
    pub session_id: &'a str,
    /// Display name.
    pub name: &'a str,
    /// Content sha256.
    pub sha256: &'a str,
    /// Byte size.
    pub bytes: i64,
    /// MIME type.
    pub media_type: &'a str,
}

/// One candidate as stored, for read-only listing over RPC.
// trace:v1 id=impl.db-candidate-row work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct CandidateRow {
    /// Candidate id.
    pub id: String,
    /// Git ref the candidate evaluates.
    pub ref_str: String,
    /// Parent ref it branched from.
    pub parent_ref: String,
    /// Lifecycle status.
    pub status: String,
    /// Metrics JSON as stored.
    pub metrics_json: String,
}

/// Open SQLite handle. Call `migrate` once before use.
// trace:v1 id=impl.db-handle work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct Db {
    conn: Connection,
}

/// Open `path` (creating parents) with WAL + foreign-keys + NORMAL sync.
// trace:v1 id=impl.db-open work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn open(path: &Path) -> Result<Db, String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
    }
    let conn = Connection::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("pragma journal_mode: {e}"))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("pragma foreign_keys: {e}"))?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| format!("pragma synchronous: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_millis(5000))
        .map_err(|e| format!("busy_timeout: {e}"))?;
    Ok(Db { conn })
}

// trace:exempt reason=internal-detail
const MIGRATIONS: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE IF NOT EXISTS champions (id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_ref TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', set_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, champion_ref TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT)",
    "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), champion_ref TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'running', result TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT)",
    "CREATE TABLE IF NOT EXISTS task_metrics (task_id TEXT NOT NULL REFERENCES tasks(id), name TEXT NOT NULL, value REAL NOT NULL, PRIMARY KEY (task_id, name))",
    "CREATE TABLE IF NOT EXISTS spans (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL DEFAULT '', task_id TEXT NOT NULL DEFAULT '', type TEXT NOT NULL, timestamp TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', candidate TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, task_id TEXT NOT NULL DEFAULT '', tool TEXT NOT NULL, ok INTEGER NOT NULL DEFAULT 1, output TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT)",
    "CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL DEFAULT '', session_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL DEFAULT 0, media_type TEXT NOT NULL DEFAULT 'application/octet-stream', created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE IF NOT EXISTS capabilities (name TEXT NOT NULL, version TEXT NOT NULL, manifest TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (name, version))",
    "CREATE TABLE IF NOT EXISTS capability_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, capability_name TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed', created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, ref_str TEXT NOT NULL DEFAULT '', parent_ref TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'created', metrics TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE IF NOT EXISTS candidate_parents (candidate_id TEXT NOT NULL REFERENCES candidates(id), parent_id TEXT NOT NULL, PRIMARY KEY (candidate_id, parent_id))",
    "CREATE TABLE IF NOT EXISTS hypotheses (id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL DEFAULT '', statement TEXT NOT NULL, prediction TEXT NOT NULL DEFAULT '', falsification TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE IF NOT EXISTS friction_signals (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL DEFAULT '', task_id TEXT NOT NULL DEFAULT '', rule TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE IF NOT EXISTS friction_clusters (id TEXT PRIMARY KEY, label TEXT NOT NULL, member_count INTEGER NOT NULL DEFAULT 0, members TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE IF NOT EXISTS experiments (id TEXT PRIMARY KEY, candidate_ref TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', scores TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE IF NOT EXISTS eval_suites (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE IF NOT EXISTS eval_cases (id TEXT PRIMARY KEY, suite_id TEXT NOT NULL REFERENCES eval_suites(id), name TEXT NOT NULL, oracle TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE IF NOT EXISTS eval_runs (id TEXT PRIMARY KEY, candidate_ref TEXT NOT NULL DEFAULT '', suite_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', started_at TEXT NOT NULL DEFAULT (datetime('now')), ended_at TEXT)",
    "CREATE TABLE IF NOT EXISTS eval_metrics (run_id TEXT NOT NULL, case_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, value REAL NOT NULL, PRIMARY KEY (run_id, case_id, name))",
    "CREATE TABLE IF NOT EXISTS archive_members (candidate_ref TEXT PRIMARY KEY, metrics TEXT NOT NULL DEFAULT '{}', novelty REAL NOT NULL DEFAULT 0.0, added_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE IF NOT EXISTS promotions (id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_ref TEXT NOT NULL, from_ref TEXT NOT NULL, to_ref TEXT NOT NULL, record TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE IF NOT EXISTS model_profiles (model TEXT PRIMARY KEY, profile TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE IF NOT EXISTS model_probe_results (id INTEGER PRIMARY KEY AUTOINCREMENT, model TEXT NOT NULL, task_id TEXT NOT NULL DEFAULT '', score REAL NOT NULL DEFAULT 0.0, latency_ms REAL NOT NULL DEFAULT 0.0, cost REAL NOT NULL DEFAULT 0.0, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE IF NOT EXISTS human_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL DEFAULT '', verdict TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))",
];

// trace:exempt reason=internal-detail
impl Db {
    /// Apply all migrations idempotently; records schema version 1.
    // trace:v1 id=impl.db-migrate work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn migrate(&self) -> Result<(), String> {
        for stmt in MIGRATIONS {
            self.conn
                .execute(stmt, [])
                .map_err(|e| format!("migrate: {e}"))?;
        }
        self.conn
            .execute(
                "INSERT OR IGNORE INTO schema_migrations (version) VALUES (1)",
                [],
            )
            .map_err(|e| format!("migrate version: {e}"))?;
        Ok(())
    }

    /// Insert a session pinned to `champion_ref`.
    // trace:v1 id=impl.db-session-insert work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn insert_session(&self, id: &str, champion_ref: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO sessions (id, champion_ref) VALUES (?1, ?2)",
                params![id, champion_ref],
            )
            .map_err(|e| format!("insert_session: {e}"))?;
        Ok(())
    }

    /// Fetch a session's pinned champion; None when unknown.
    // trace:v1 id=impl.db-session-get work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn session_champion(&self, id: &str) -> Result<Option<String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT champion_ref FROM sessions WHERE id = ?1")
            .map_err(|e| format!("session_champion: {e}"))?;
        let mut rows = stmt
            .query(params![id])
            .map_err(|e| format!("session_champion: {e}"))?;
        match rows.next().map_err(|e| format!("session_champion: {e}"))? {
            Some(row) => Ok(Some(
                row.get(0).map_err(|e| format!("session_champion: {e}"))?,
            )),
            None => Ok(None),
        }
    }

    /// Insert a task under a session, pinned to the session champion.
    // trace:v1 id=impl.db-task-insert work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn insert_task(
        &self,
        id: &str,
        session_id: &str,
        champion_ref: &str,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO tasks (id, session_id, champion_ref) VALUES (?1, ?2, ?3)",
                params![id, session_id, champion_ref],
            )
            .map_err(|e| format!("insert_task: {e}"))?;
        Ok(())
    }

    /// Mark a task finished with a result string.
    // trace:v1 id=impl.db-task-end work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn end_task(&self, id: &str, status: &str, result: &str) -> Result<(), String> {
        let n = self
            .conn
            .execute(
                "UPDATE tasks SET status = ?1, result = ?2, ended_at = datetime('now') WHERE id = ?3",
                params![status, result, id],
            )
            .map_err(|e| format!("end_task: {e}"))?;
        if n == 0 {
            return Err(format!("end_task: unknown task {id}"));
        }
        Ok(())
    }

    /// Persist one telemetry event as a span row.
    // trace:v1 id=impl.db-span-insert work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn insert_span(
        &self,
        session_id: &str,
        task_id: &str,
        typ: &str,
        timestamp: &str,
        payload: &str,
        candidate: &str,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO spans (session_id, task_id, type, timestamp, payload, candidate) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![session_id, task_id, typ, timestamp, payload, candidate],
            )
            .map_err(|e| format!("insert_span: {e}"))?;
        Ok(())
    }

    /// Count spans for a task (roundtrip proof).
    // trace:v1 id=impl.db-span-count work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn span_count(&self, task_id: &str) -> Result<i64, String> {
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM spans WHERE task_id = ?1",
                params![task_id],
                |r| r.get(0),
            )
            .map_err(|e| format!("span_count: {e}"))
    }

    /// Register an artifact blob reference.
    // trace:v1 id=impl.db-artifact-insert work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn insert_artifact(&self, art: Artifact<'_>) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO artifacts (id, task_id, session_id, name, sha256, bytes, media_type) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![art.id, art.task_id, art.session_id, art.name, art.sha256, art.bytes, art.media_type],
            )
            .map_err(|e| format!("insert_artifact: {e}"))?;
        Ok(())
    }

    /// Insert a candidate with parent ref and JSON metrics.
    // trace:v1 id=impl.db-candidate-insert work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn insert_candidate(
        &self,
        id: &str,
        ref_str: &str,
        parent_ref: &str,
        status: &str,
        metrics_json: &str,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO candidates (id, ref_str, parent_ref, status, metrics) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, ref_str, parent_ref, status, metrics_json],
            )
            .map_err(|e| format!("insert_candidate: {e}"))?;
        if !parent_ref.is_empty() {
            let _ = self.conn.execute(
                "INSERT OR IGNORE INTO candidate_parents (candidate_id, parent_id) VALUES (?1, ?2)",
                params![id, parent_ref],
            );
        }
        Ok(())
    }

    /// Update candidate status.
    // trace:v1 id=impl.db-candidate-status work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn set_candidate_status(&self, id: &str, status: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE candidates SET status = ?1, updated_at = datetime('now') WHERE id = ?2",
                params![status, id],
            )
            .map_err(|e| format!("set_candidate_status: {e}"))?;
        Ok(())
    }

    /// Candidates newest-first.
    ///
    /// Read-only projection of candidate metadata: the organism may see that a
    /// candidate exists and what status it reached, never the hidden oracle
    /// outputs that promotion depends on.
    // trace:v1 id=impl.db-candidate-list work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn list_candidates(&self) -> Result<Vec<CandidateRow>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, ref_str, parent_ref, status, metrics FROM candidates ORDER BY created_at DESC, id DESC")
            .map_err(|e| format!("list_candidates: {e}"))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(CandidateRow {
                    id: r.get(0)?,
                    ref_str: r.get(1)?,
                    parent_ref: r.get(2)?,
                    status: r.get(3)?,
                    metrics_json: r.get(4)?,
                })
            })
            .map_err(|e| format!("list_candidates: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("list_candidates: {e}"))?);
        }
        Ok(out)
    }

    /// Append a champion pointer row.
    // trace:v1 id=impl.db-champion-set work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn push_champion(&self, candidate_ref: &str, reason: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO champions (candidate_ref, reason) VALUES (?1, ?2)",
                params![candidate_ref, reason],
            )
            .map_err(|e| format!("push_champion: {e}"))?;
        Ok(())
    }

    /// Latest champion ref; None when never set.
    // trace:v1 id=impl.db-champion-get work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn current_champion(&self) -> Result<Option<String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT candidate_ref FROM champions ORDER BY id DESC LIMIT 1")
            .map_err(|e| format!("current_champion: {e}"))?;
        let mut rows = stmt
            .query([])
            .map_err(|e| format!("current_champion: {e}"))?;
        match rows.next().map_err(|e| format!("current_champion: {e}"))? {
            Some(row) => Ok(Some(
                row.get(0).map_err(|e| format!("current_champion: {e}"))?,
            )),
            None => Ok(None),
        }
    }

    /// Champion history newest-first as (ref, reason, set_at).
    // trace:v1 id=impl.db-champion-history work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn champion_history(&self) -> Result<Vec<(String, String, String)>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT candidate_ref, reason, set_at FROM champions ORDER BY id DESC")
            .map_err(|e| format!("champion_history: {e}"))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| format!("champion_history: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("champion_history: {e}"))?);
        }
        Ok(out)
    }

    /// Upsert an archive member.
    // trace:v1 id=impl.db-archive-upsert work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn archive_upsert(
        &self,
        candidate_ref: &str,
        metrics_json: &str,
        novelty: f64,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO archive_members (candidate_ref, metrics, novelty) VALUES (?1, ?2, ?3) ON CONFLICT(candidate_ref) DO UPDATE SET metrics = ?2, novelty = ?3",
                params![candidate_ref, metrics_json, novelty],
            )
            .map_err(|e| format!("archive_upsert: {e}"))?;
        Ok(())
    }

    /// List archive members as (ref, metrics_json, novelty).
    // trace:v1 id=impl.db-archive-list work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn archive_list(&self) -> Result<Vec<(String, String, f64)>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT candidate_ref, metrics, novelty FROM archive_members")
            .map_err(|e| format!("archive_list: {e}"))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| format!("archive_list: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("archive_list: {e}"))?);
        }
        Ok(out)
    }

    /// Remove an archive member.
    // trace:v1 id=impl.db-archive-evict work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn archive_evict(&self, candidate_ref: &str) -> Result<(), String> {
        self.conn
            .execute(
                "DELETE FROM archive_members WHERE candidate_ref = ?1",
                params![candidate_ref],
            )
            .map_err(|e| format!("archive_evict: {e}"))?;
        Ok(())
    }

    /// Record a promotion with its JSON record.
    // trace:v1 id=impl.db-promotion-insert work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn insert_promotion(
        &self,
        candidate_ref: &str,
        from_ref: &str,
        to_ref: &str,
        record_json: &str,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO promotions (candidate_ref, from_ref, to_ref, record) VALUES (?1, ?2, ?3, ?4)",
                params![candidate_ref, from_ref, to_ref, record_json],
            )
            .map_err(|e| format!("insert_promotion: {e}"))?;
        Ok(())
    }

    /// Upsert a model profile JSON blob.
    // trace:v1 id=impl.db-model-upsert work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn upsert_model_profile(&self, model: &str, profile_json: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO model_profiles (model, profile) VALUES (?1, ?2) ON CONFLICT(model) DO UPDATE SET profile = ?2, updated_at = datetime('now')",
                params![model, profile_json],
            )
            .map_err(|e| format!("upsert_model_profile: {e}"))?;
        Ok(())
    }

    /// Fetch a model profile JSON blob; None when unknown.
    // trace:v1 id=impl.db-model-get work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn model_profile(&self, model: &str) -> Result<Option<String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT profile FROM model_profiles WHERE model = ?1")
            .map_err(|e| format!("model_profile: {e}"))?;
        let mut rows = stmt
            .query(params![model])
            .map_err(|e| format!("model_profile: {e}"))?;
        match rows.next().map_err(|e| format!("model_profile: {e}"))? {
            Some(row) => Ok(Some(row.get(0).map_err(|e| format!("model_profile: {e}"))?)),
            None => Ok(None),
        }
    }

    /// Record one model probe observation.
    // trace:v1 id=impl.db-probe-insert work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn insert_probe(
        &self,
        model: &str,
        task_id: &str,
        score: f64,
        latency_ms: f64,
        cost: f64,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO model_probe_results (model, task_id, score, latency_ms, cost) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![model, task_id, score, latency_ms, cost],
            )
            .map_err(|e| format!("insert_probe: {e}"))?;
        Ok(())
    }

    /// Insert an experiment request row.
    // trace:v1 id=impl.db-experiment-insert work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn insert_experiment(&self, id: &str, candidate_ref: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO experiments (id, candidate_ref) VALUES (?1, ?2)",
                params![id, candidate_ref],
            )
            .map_err(|e| format!("insert_experiment: {e}"))?;
        Ok(())
    }

    /// Record a capability proposal version row.
    // trace:v1 id=impl.db-capability-propose work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn propose_capability(&self, name: &str, version: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO capability_versions (capability_name, version) VALUES (?1, ?2)",
                params![name, version],
            )
            .map_err(|e| format!("propose_capability: {e}"))?;
        Ok(())
    }

    /// Insert an eval run and its scalar metrics.
    // trace:v1 id=impl.db-eval-run work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
    pub fn insert_eval_run(
        &self,
        id: &str,
        candidate_ref: &str,
        suite_id: &str,
        status: &str,
        metrics: &[(&str, &str, f64)],
    ) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO eval_runs (id, candidate_ref, suite_id, status) VALUES (?1, ?2, ?3, ?4)",
                params![id, candidate_ref, suite_id, status],
            )
            .map_err(|e| format!("insert_eval_run: {e}"))?;
        for (case_id, name, value) in metrics {
            self.conn
                .execute(
                    "INSERT INTO eval_metrics (run_id, case_id, name, value) VALUES (?1, ?2, ?3, ?4)",
                    params![id, case_id, name, value],
                )
                .map_err(|e| format!("insert_eval_metric: {e}"))?;
        }
        Ok(())
    }
}
