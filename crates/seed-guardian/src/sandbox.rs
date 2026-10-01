// sandbox.rs — docker confinement arg builder for candidate runs.
//
// Purpose: construct (never execute here) the `docker run` argv that
// confines untrusted candidate code.
// Why it exists: the guardian never executes organism code outside a
// locked-down container (docs/SECURITY.md).
// Responsibilities: SandboxOpts, validated argv builder.
// Invariants: /candidate rw, /workspace rw, /seed-fixture ro; the db file,
// hidden paths, and guardian sources are never mounted; network off by
// default; cpu 4, mem 8g, pids 512 defaults; callers kill the child tree
// on timeout.
// Public types/functions: SandboxOpts, build_args.

/// Confinement options for one candidate run.
#[derive(Debug, Clone)]
// trace:v1 id=impl.sandbox-opts work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub struct SandboxOpts {
    /// Container image.
    pub image: String,
    /// Host dir mounted at /candidate (rw).
    pub candidate_dir: String,
    /// Host dir mounted at /workspace (rw).
    pub workspace_dir: String,
    /// Host dir mounted at /seed-fixture (ro).
    pub fixture_dir: String,
    /// Command to run inside (default: seed eval harness entry).
    pub command: Vec<String>,
    /// Enable container network (default false).
    pub network_enabled: bool,
    /// CPU count (default 4).
    pub cpus: u32,
    /// Memory limit (default "8g").
    pub memory: String,
    /// PID limit (default 512).
    pub pids_limit: u32,
    /// Timeout seconds for the caller-side kill (default 600).
    pub timeout_secs: u64,
}

// trace:exempt reason=internal-detail
impl Default for SandboxOpts {
    // trace:exempt reason=internal-detail
    fn default() -> Self {
        Self {
            image: "seed-candidate:latest".to_string(),
            candidate_dir: String::new(),
            workspace_dir: String::new(),
            fixture_dir: String::new(),
            command: vec!["seed-eval".to_string()],
            network_enabled: false,
            cpus: 4,
            memory: "8g".to_string(),
            pids_limit: 512,
            timeout_secs: 600,
        }
    }
}

// trace:exempt reason=internal-detail
fn forbidden_mount(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.contains("guardian.sqlite")
        || lower.contains("guardian-source")
        || path
            .split('/')
            .any(|seg| seg.starts_with('.') && seg.len() > 1)
}

/// Build `docker run --rm ...` argv; errors on forbidden mounts or empty dirs.
// trace:v1 id=impl.sandbox-build-args work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn build_args(opts: &SandboxOpts) -> Result<Vec<String>, String> {
    for dir in [&opts.candidate_dir, &opts.workspace_dir, &opts.fixture_dir] {
        if dir.is_empty() {
            return Err("sandbox mount dir must not be empty".to_string());
        }
        if forbidden_mount(dir) {
            return Err(format!("sandbox refuses to mount {dir}"));
        }
    }
    let mut args = vec!["run".to_string(), "--rm".to_string()];
    args.push("--cpus".to_string());
    args.push(opts.cpus.to_string());
    args.push("--memory".to_string());
    args.push(opts.memory.clone());
    args.push("--pids-limit".to_string());
    args.push(opts.pids_limit.to_string());
    if opts.network_enabled {
        args.push("--network".to_string());
        args.push("bridge".to_string());
    } else {
        args.push("--network".to_string());
        args.push("none".to_string());
    }
    args.push("--read-only".to_string());
    args.extend([
        "-v".to_string(),
        format!("{}:/candidate:rw", opts.candidate_dir),
    ]);
    args.extend([
        "-v".to_string(),
        format!("{}:/workspace:rw", opts.workspace_dir),
    ]);
    args.extend([
        "-v".to_string(),
        format!("{}:/seed-fixture:ro", opts.fixture_dir),
    ]);
    args.push(opts.image.clone());
    args.extend(opts.command.clone());
    Ok(args)
}
