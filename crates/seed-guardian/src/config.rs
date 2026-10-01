// config.rs — guardian configuration.
//
// Purpose: load `~/.seed/config.toml` with compiled defaults for every
// section; reject mismatched schema versions before the daemon binds.
// Why it exists: the guardian must boot deterministically on a fresh
// checkout (defaults) yet honor operator overrides (file).
// Responsibilities: default config, file load with per-key fallback,
// schema_version gate.
// Invariants: SCHEMA_VERSION is the only accepted schema_version; missing
// file yields defaults; unknown keys are ignored; a present file may omit
// any section or key and still load.
// Public types/functions: Config, GuardianSection, DbSection,
// SandboxSection, EvalSection, PromotionSection, SCHEMA_VERSION,
// default_path, load, load_from_path, check_schema.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Accepted `schema_version` in config.toml.
// trace:exempt reason=internal-detail
pub const SCHEMA_VERSION: u32 = 1;

/// Full guardian configuration (all sections).
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.config-record work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct Config {
    /// Config schema version; must equal SCHEMA_VERSION.
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    /// Daemon socket/db/logging.
    #[serde(default)]
    pub guardian: GuardianSection,
    /// SQLite store tuning.
    #[serde(default)]
    pub db: DbSection,
    /// Sandboxed candidate runs.
    #[serde(default)]
    pub sandbox: SandboxSection,
    /// Gate pipeline + corpus.
    #[serde(default)]
    pub eval: EvalSection,
    /// Promotion and probation thresholds.
    #[serde(default)]
    pub promotion: PromotionSection,
}
/// Guardian daemon section.
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.config-guardian-section work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct GuardianSection {
    /// Unix socket path (0600).
    #[serde(default = "default_socket_path")]
    pub socket_path: String,
    /// Log level (error|warn|info|debug).
    #[serde(default = "default_log_level")]
    pub log_level: String,
    /// Max JSON-RPC line bytes (default 1MiB).
    #[serde(default = "default_max_message_bytes")]
    pub max_message_bytes: usize,
}

// trace:exempt reason=internal-detail
impl Default for GuardianSection {
    // trace:exempt reason=internal-detail
    fn default() -> Self {
        Self {
            socket_path: default_socket_path(),
            log_level: default_log_level(),
            max_message_bytes: default_max_message_bytes(),
        }
    }
}

/// SQLite store section.
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.config-db-section work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct DbSection {
    /// SQLite file path.
    #[serde(default = "default_db_path")]
    pub path: String,
    /// busy_timeout in ms.
    #[serde(default = "default_busy_timeout_ms")]
    pub busy_timeout_ms: u32,
}

// trace:exempt reason=internal-detail
impl Default for DbSection {
    // trace:exempt reason=internal-detail
    fn default() -> Self {
        Self {
            path: default_db_path(),
            busy_timeout_ms: default_busy_timeout_ms(),
        }
    }
}

/// Sandbox section (docker confinement for candidate runs).
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.config-sandbox-section work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct SandboxSection {
    /// Container image for candidate runs.
    #[serde(default = "default_image")]
    pub image: String,
    /// CPUs per run.
    #[serde(default = "default_cpus")]
    pub cpus: u32,
    /// Memory per run (docker flag value).
    #[serde(default = "default_memory")]
    pub memory: String,
    /// PID limit per run.
    #[serde(default = "default_pids_limit")]
    pub pids_limit: u32,
    /// Enable network (default false).
    #[serde(default)]
    pub network_enabled: bool,
    /// Kill timeout in seconds.
    #[serde(default = "default_timeout_secs")]
    pub timeout_secs: u64,
}

// trace:exempt reason=internal-detail
impl Default for SandboxSection {
    // trace:exempt reason=internal-detail
    fn default() -> Self {
        Self {
            image: default_image(),
            cpus: default_cpus(),
            memory: default_memory(),
            pids_limit: default_pids_limit(),
            network_enabled: false,
            timeout_secs: default_timeout_secs(),
        }
    }
}

/// Evaluation gate section.
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.config-eval-section work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct EvalSection {
    /// Deterministic corpus size (default 60 tasks).
    #[serde(default = "default_corpus_tasks")]
    pub corpus_tasks: u32,
    /// Worktree scratch root.
    #[serde(default = "default_scratch_root")]
    pub scratch_root: String,
    /// Fixture dir mounted read-only into candidates.
    #[serde(default = "default_fixture_dir")]
    pub fixture_dir: String,
}

// trace:exempt reason=internal-detail
impl Default for EvalSection {
    // trace:exempt reason=internal-detail
    fn default() -> Self {
        Self {
            corpus_tasks: default_corpus_tasks(),
            scratch_root: default_scratch_root(),
            fixture_dir: default_fixture_dir(),
        }
    }
}

/// Promotion safety section.
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.config-promotion-section work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct PromotionSection {
    /// Non-inferiority tolerance (default 0.01).
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
    /// Critical-path tolerance (default 0.005).
    #[serde(default = "default_critical_tolerance")]
    pub critical_tolerance: f64,
    /// Probation task count (default 10).
    #[serde(default = "default_probation_tasks")]
    pub probation_tasks: u32,
    /// Strikes triggering rollback (default 2).
    #[serde(default = "default_rollback_strikes")]
    pub rollback_strikes: u32,
    /// Pareto archive cap (default 64).
    #[serde(default = "default_archive_cap")]
    pub archive_cap: usize,
}

// trace:exempt reason=internal-detail
impl Default for PromotionSection {
    // trace:exempt reason=internal-detail
    fn default() -> Self {
        Self {
            tolerance: default_tolerance(),
            critical_tolerance: default_critical_tolerance(),
            probation_tasks: default_probation_tasks(),
            rollback_strikes: default_rollback_strikes(),
            archive_cap: default_archive_cap(),
        }
    }
}

// trace:exempt reason=internal-detail
impl Default for Config {
    // trace:exempt reason=internal-detail
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            guardian: GuardianSection::default(),
            db: DbSection::default(),
            sandbox: SandboxSection::default(),
            eval: EvalSection::default(),
            promotion: PromotionSection::default(),
        }
    }
}

// trace:exempt reason=internal-detail
fn default_schema_version() -> u32 {
    SCHEMA_VERSION
}

// trace:exempt reason=internal-detail
fn seed_home() -> PathBuf {
    std::env::var("HOME")
        .map(|h| PathBuf::from(h).join(".seed"))
        .unwrap_or_else(|_| PathBuf::from(".seed"))
}

// trace:exempt reason=internal-detail
fn default_socket_path() -> String {
    seed_home()
        .join("guardian.sock")
        .to_string_lossy()
        .into_owned()
}

// trace:exempt reason=internal-detail
fn default_log_level() -> String {
    "info".to_string()
}

// trace:exempt reason=internal-detail
fn default_max_message_bytes() -> usize {
    1024 * 1024
}

// trace:exempt reason=internal-detail
fn default_db_path() -> String {
    seed_home()
        .join("guardian.sqlite")
        .to_string_lossy()
        .into_owned()
}

// trace:exempt reason=internal-detail
fn default_busy_timeout_ms() -> u32 {
    5000
}

// trace:exempt reason=internal-detail
fn default_image() -> String {
    "seed-candidate:latest".to_string()
}

// trace:exempt reason=internal-detail
fn default_cpus() -> u32 {
    4
}

// trace:exempt reason=internal-detail
fn default_memory() -> String {
    "8g".to_string()
}

// trace:exempt reason=internal-detail
fn default_pids_limit() -> u32 {
    512
}

// trace:exempt reason=internal-detail
fn default_timeout_secs() -> u64 {
    600
}

// trace:exempt reason=internal-detail
fn default_corpus_tasks() -> u32 {
    60
}

// trace:exempt reason=internal-detail
fn default_scratch_root() -> String {
    std::env::var("SEED_SCRATCH")
        .unwrap_or_else(|_| seed_home().join("scratch").to_string_lossy().into_owned())
}

// trace:exempt reason=internal-detail
fn default_fixture_dir() -> String {
    seed_home().join("fixture").to_string_lossy().into_owned()
}

// trace:exempt reason=internal-detail
fn default_tolerance() -> f64 {
    0.01
}

// trace:exempt reason=internal-detail
fn default_critical_tolerance() -> f64 {
    0.005
}

// trace:exempt reason=internal-detail
fn default_probation_tasks() -> u32 {
    10
}

// trace:exempt reason=internal-detail
fn default_rollback_strikes() -> u32 {
    2
}

// trace:exempt reason=internal-detail
fn default_archive_cap() -> usize {
    64
}

/// Default config path: `~/.seed/config.toml`.
// trace:v1 id=impl.config-default-path work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn default_path() -> PathBuf {
    seed_home().join("config.toml")
}

/// Load config from the default path; missing file yields defaults.
// trace:v1 id=impl.config-load work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn load() -> Result<Config, String> {
    load_from_path(&default_path())
}

/// Load config from `path`; missing file yields defaults, present file is
/// parsed as TOML with per-key fallback to defaults, then schema-checked.
// trace:v1 id=impl.config-load-path work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn load_from_path(path: &std::path::Path) -> Result<Config, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Config::default()),
        Err(e) => return Err(format!("read {}: {e}", path.display())),
    };
    let cfg: Config =
        toml::from_str(&text).map_err(|e| format!("parse {}: {e}", path.display()))?;
    check_schema(&cfg)?;
    Ok(cfg)
}

/// Reject configs whose schema_version differs from SCHEMA_VERSION.
// trace:v1 id=impl.config-schema-check work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn check_schema(cfg: &Config) -> Result<(), String> {
    if cfg.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "schema_version {} != supported {SCHEMA_VERSION}",
            cfg.schema_version
        ));
    }
    Ok(())
}
