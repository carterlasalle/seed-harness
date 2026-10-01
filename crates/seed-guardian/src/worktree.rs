// worktree.rs — git worktree lifecycle helpers.
//
// Purpose: isolate every task in its own git worktree under the scratch
// root so results are reproducible and failures contained.
// Why it exists: REQ-SEED-N5PYP0GA — the guardian owns worktree lifecycle;
// the organism never merges directly.
// Responsibilities: build `git worktree add` commands, read commit SHAs,
// list/remove worktrees via `git worktree`.
// Invariants: all paths stay under the scratch root (callers pass absolute
// paths); git failures surface as Err, never panics.
// Public functions: add_args, commit_sha, list, remove.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Argv for `git -C <repo> worktree add <path> [<branch>]`.
// trace:v1 id=impl.worktree-add-args work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn add_args(repo: &Path, path: &Path, branch: Option<&str>) -> Vec<String> {
    let mut args = vec![
        "-C".to_string(),
        repo.to_string_lossy().into_owned(),
        "worktree".to_string(),
        "add".to_string(),
        path.to_string_lossy().into_owned(),
    ];
    if let Some(b) = branch {
        args.push("-b".to_string());
        args.push(b.to_string());
    }
    args
}

/// Create a worktree; errors when git fails.
// trace:v1 id=impl.worktree-add work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn add(repo: &Path, path: &Path, branch: Option<&str>) -> Result<(), String> {
    let args = add_args(repo, path, branch);
    let out = Command::new("git")
        .args(&args)
        .output()
        .map_err(|e| format!("git worktree add: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "git worktree add failed for {}: {}",
            path.display(),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

/// HEAD commit SHA of the repo at `path` (`git rev-parse HEAD`).
// trace:v1 id=impl.worktree-commit-sha work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn commit_sha(path: &Path) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("rev-parse")
        .arg("HEAD")
        .output()
        .map_err(|e| format!("git rev-parse: {e}"))?;
    if !out.status.success() {
        return Err(format!("git rev-parse failed in {}", path.display()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Porcelain worktree paths for the repo at `path`.
// trace:v1 id=impl.worktree-list work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn list(path: &Path) -> Result<Vec<PathBuf>, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("worktree")
        .arg("list")
        .arg("--porcelain")
        .output()
        .map_err(|e| format!("git worktree list: {e}"))?;
    if !out.status.success() {
        return Err(format!("git worktree list failed in {}", path.display()));
    }
    let mut paths = Vec::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        if let Some(rest) = line.strip_prefix("worktree ") {
            paths.push(PathBuf::from(rest));
        }
    }
    Ok(paths)
}

/// Force-remove the worktree at `path` from `repo`.
// trace:v1 id=impl.worktree-remove work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-N5PYP0GA
pub fn remove(repo: &Path, path: &Path) -> Result<(), String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .arg("worktree")
        .arg("remove")
        .arg("--force")
        .arg(path)
        .output()
        .map_err(|e| format!("git worktree remove: {e}"))?;
    if !out.status.success() {
        return Err(format!("git worktree remove failed for {}", path.display()));
    }
    Ok(())
}
