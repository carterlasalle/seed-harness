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

/// Full guardian configuration (spec section 103 shape: schema_version plus
/// evolution/foreground/capabilities/incubator/promotion/guardian/sandbox/
/// models sections; db/eval are guardian-owned refinements).
/// Config file keys MUST use the exact spec section 103 names: [evolution]
/// enabled/auto_run_idle/normal_cycle_tasks/scientist_cycle_tasks/
/// challenge_cycle_tasks/pareto_archive_limit, [foreground]
/// inline_harness_improvement_seconds, [capabilities] visible_tool_limit/
/// auto_crystallize, [incubator] rolling_budget_ratio/daily_cost_limit_usd/
/// max_cpu_percent_while_foreground_active, [promotion] quality_noninferiority/
/// critical_quality_noninferiority/meaningful_efficiency_improvement/
/// meaningful_complexity_improvement/probation_tasks, [guardian] socket/
/// database, [sandbox] default_network, [models] task/scientist/mutator/
/// judge/challenge.
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.config-record work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct Config {
    /// Config schema version; must equal SCHEMA_VERSION.
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    /// Evolution loop cadences.
    #[serde(default)]
    pub evolution: EvolutionSection,
    /// Foreground inline budget.
    #[serde(default)]
    pub foreground: ForegroundSection,
    /// Capability visibility + crystallization.
    #[serde(default)]
    pub capabilities: CapabilitiesSection,
    /// Incubator spend/CPU budget.
    #[serde(default)]
    pub incubator: IncubatorSection,
    /// Promotion and probation thresholds.
    #[serde(default)]
    pub promotion: PromotionSection,
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
    /// Lab model role assignments.
    #[serde(default)]
    pub models: ModelsSection,
}
/// Guardian daemon section.
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.config-guardian-section work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct GuardianSection {
    /// Unix socket path (spec section 103 key `socket`, default
    /// `~/.seed/run/guardian.sock`, mode 0600).
    #[serde(default = "default_socket_path", alias = "socket")]
    pub socket_path: String,
    /// Guardian SQLite path (spec section 103 key `database`, default
    /// `~/.seed/guardian.sqlite`).
    #[serde(default = "default_db_path", alias = "database")]
    pub database: String,
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
            database: default_db_path(),
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
    /// Enable network (spec section 103 key `default_network`, default false).
    #[serde(default, alias = "default_network")]
    pub network_enabled: bool,
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

/// Promotion safety section (spec section 103 names + guardian refinements).
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.config-promotion-section work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct PromotionSection {
    /// Non-inferiority tolerance (spec: quality_noninferiority, default 0.01).
    #[serde(default = "default_tolerance", alias = "quality_noninferiority")]
    pub tolerance: f64,
    /// Critical-path tolerance (spec: critical_quality_noninferiority, 0.005).
    #[serde(
        default = "default_critical_tolerance",
        alias = "critical_quality_noninferiority"
    )]
    pub critical_tolerance: f64,
    /// Meaningful efficiency gain (spec: meaningful_efficiency_improvement, 0.10).
    #[serde(
        default = "default_efficiency_gain",
        alias = "meaningful_efficiency_improvement"
    )]
    pub efficiency_gain: f64,
    /// Meaningful complexity gain (spec: meaningful_complexity_improvement, 0.20).
    #[serde(
        default = "default_complexity_gain",
        alias = "meaningful_complexity_improvement"
    )]
    pub complexity_gain: f64,
    /// Probation task count (default 10).
    #[serde(default = "default_probation_tasks", alias = "probation_tasks")]
    pub probation_tasks: u32,
    /// Strikes triggering rollback (default 2).
    #[serde(default = "default_rollback_strikes")]
    pub rollback_strikes: u32,
    /// Pareto archive cap (default 64).
    #[serde(default = "default_archive_cap")]
    pub archive_cap: usize,
}

/// Evolution loop cadences (spec section 103).
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.config-evolution-section work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct EvolutionSection {
    /// Master switch for automatic evolution.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Run structural experiments only when idle.
    #[serde(default = "default_true")]
    pub auto_run_idle: bool,
    /// Tasks between normal lab cycles (default 10).
    #[serde(default = "default_normal_cycle_tasks")]
    pub normal_cycle_tasks: u32,
    /// Tasks between scientist cycles (default 50).
    #[serde(default = "default_scientist_cycle_tasks")]
    pub scientist_cycle_tasks: u32,
    /// Tasks between challenge generations (default 20).
    #[serde(default = "default_challenge_cycle_tasks")]
    pub challenge_cycle_tasks: u32,
    /// Pareto archive cap mirror (default 64).
    #[serde(default = "default_archive_cap")]
    pub pareto_archive_limit: usize,
}

/// Foreground inline budget (spec section 103).
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.config-foreground-section work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct ForegroundSection {
    /// Max harness-improvement seconds per foreground task (default 30).
    #[serde(default = "default_inline_secs")]
    pub inline_harness_improvement_seconds: u32,
}

/// Capability visibility + crystallization (spec section 103).
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.config-capabilities-section work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct CapabilitiesSection {
    /// Max visible tools (default 8, python pinned).
    #[serde(default = "default_visible_tool_limit")]
    pub visible_tool_limit: u32,
    /// Crystallize repeated helpers automatically.
    #[serde(default = "default_true")]
    pub auto_crystallize: bool,
}

/// Incubator spend/CPU budget (spec section 103).
#[derive(Debug, Clone, Serialize, Deserialize)]
// trace:v1 id=impl.config-incubator-section work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct IncubatorSection {
    /// Rolling spend ratio (default 0.10).
    #[serde(default = "default_budget_ratio")]
    pub rolling_budget_ratio: f64,
    /// Daily cost cap USD (default 10.0).
    #[serde(default = "default_daily_cost_cap")]
    pub daily_cost_limit_usd: f64,
    /// Max CPU % while a foreground task is active (default 25).
    #[serde(default = "default_foreground_cpu_cap")]
    pub max_cpu_percent_while_foreground_active: u32,
}

/// Lab model role assignments (spec section 103).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
// trace:v1 id=impl.config-models-section work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct ModelsSection {
    /// Foreground task model ("" = task model).
    #[serde(default)]
    pub task: String,
    /// Scientist model override.
    #[serde(default)]
    pub scientist: String,
    /// Mutator model override.
    #[serde(default)]
    pub mutator: String,
    /// Judge model override.
    #[serde(default)]
    pub judge: String,
    /// Challenge-generator model override.
    #[serde(default)]
    pub challenge: String,
}

// trace:exempt reason=internal-detail
impl Default for PromotionSection {
    // trace:exempt reason=internal-detail
    fn default() -> Self {
        Self {
            tolerance: default_tolerance(),
            critical_tolerance: default_critical_tolerance(),
            efficiency_gain: default_efficiency_gain(),
            complexity_gain: default_complexity_gain(),
            probation_tasks: default_probation_tasks(),
            rollback_strikes: default_rollback_strikes(),
            archive_cap: default_archive_cap(),
        }
    }
}

// trace:exempt reason=internal-detail
impl Default for EvolutionSection {
    // trace:exempt reason=internal-detail
    fn default() -> Self {
        Self {
            enabled: true,
            auto_run_idle: true,
            normal_cycle_tasks: default_normal_cycle_tasks(),
            scientist_cycle_tasks: default_scientist_cycle_tasks(),
            challenge_cycle_tasks: default_challenge_cycle_tasks(),
            pareto_archive_limit: default_archive_cap(),
        }
    }
}

// trace:exempt reason=internal-detail
impl Default for ForegroundSection {
    // trace:exempt reason=internal-detail
    fn default() -> Self {
        Self {
            inline_harness_improvement_seconds: default_inline_secs(),
        }
    }
}

// trace:exempt reason=internal-detail
impl Default for CapabilitiesSection {
    // trace:exempt reason=internal-detail
    fn default() -> Self {
        Self {
            visible_tool_limit: default_visible_tool_limit(),
            auto_crystallize: true,
        }
    }
}

// trace:exempt reason=internal-detail
impl Default for IncubatorSection {
    // trace:exempt reason=internal-detail
    fn default() -> Self {
        Self {
            rolling_budget_ratio: default_budget_ratio(),
            daily_cost_limit_usd: default_daily_cost_cap(),
            max_cpu_percent_while_foreground_active: default_foreground_cpu_cap(),
        }
    }
}

// trace:exempt reason=internal-detail
impl Default for Config {
    // trace:exempt reason=internal-detail
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            evolution: EvolutionSection::default(),
            foreground: ForegroundSection::default(),
            capabilities: CapabilitiesSection::default(),
            incubator: IncubatorSection::default(),
            promotion: PromotionSection::default(),
            guardian: GuardianSection::default(),
            db: DbSection::default(),
            sandbox: SandboxSection::default(),
            eval: EvalSection::default(),
            models: ModelsSection::default(),
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
        .join("run")
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
pub fn default_image() -> String {
    "seed-eval-runner".to_string()
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

// trace:exempt reason=internal-detail
fn default_true() -> bool {
    true
}

// trace:exempt reason=internal-detail
fn default_efficiency_gain() -> f64 {
    0.10
}

// trace:exempt reason=internal-detail
fn default_complexity_gain() -> f64 {
    0.20
}

// trace:exempt reason=internal-detail
fn default_normal_cycle_tasks() -> u32 {
    10
}

// trace:exempt reason=internal-detail
fn default_scientist_cycle_tasks() -> u32 {
    50
}

// trace:exempt reason=internal-detail
fn default_challenge_cycle_tasks() -> u32 {
    20
}

// trace:exempt reason=internal-detail
fn default_inline_secs() -> u32 {
    30
}

// trace:exempt reason=internal-detail
fn default_visible_tool_limit() -> u32 {
    8
}

// trace:exempt reason=internal-detail
fn default_budget_ratio() -> f64 {
    0.10
}

// trace:exempt reason=internal-detail
fn default_daily_cost_cap() -> f64 {
    10.0
}

// trace:exempt reason=internal-detail
fn default_foreground_cpu_cap() -> u32 {
    25
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
