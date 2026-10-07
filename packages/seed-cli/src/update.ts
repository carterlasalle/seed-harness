// update.ts — upgrade the installed checkout in place.
//
// Purpose: `seed update` acts on the notice the CLI already prints.
// Why it exists: update-check tells you a newer release exists, but the only
// way to take it was to re-run five README commands by hand. Registry users
// upgrade through brew/npm; source users had nothing.
// Responsibilities: decide whether the checkout is a git repository, pull
// (fast-forward only), run the installer, and report the version before and
// after.
// Invariants: never invents a version (an unreadable one stays null); a failed
// pull or install is reported with its exit status, never swallowed; a missing
// installer is an error rather than a silent no-op.
// Public types/functions: UpdateResult, updateCheckout.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { installedVersion } from "./version.ts";

// trace:exempt reason=internal-detail
export interface UpdateResult {
  ok: boolean;
  repo: string;
  before: string | null;
  after: string | null;
  pulled: boolean;
  detail: string;
}

/** Whether `repo` is inside a git working tree, and which toplevel it belongs to. */
// trace:v1 id=impl.cli-update-is-git work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function gitToplevel(repo: string): string | null {
  // trace:exempt reason=internal-detail
  const result = spawnSync("git", ["-C", repo, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    timeout: 15000,
  });
  if (result.status !== 0) return null;
  // trace:exempt reason=unit-test
  const top = String(result.stdout).trim();
  return top.length > 0 ? top : null;
}

/**
 * Pull (when this is a git checkout and `pull` is requested) and re-run the
 * installer. The installer is idempotent, so this is also the repair path.
 */
// trace:v1 id=impl.cli-update-checkout work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function updateCheckout(repo: string, options: { pull: boolean; quiet?: boolean } = { pull: true }): UpdateResult {
  const quiet = options.quiet === true;
  const before = installedVersion();
  const installer = join(repo, "scripts", "install.sh");
  if (!existsSync(installer)) {
    return {
      ok: false,
      repo,
      before,
      after: null,
      pulled: false,
      detail: `no installer at ${installer} — this build has no in-place update path; reinstall from the release you want`,
    };
  }

  let pulled = false;
  const top = options.pull ? gitToplevel(repo) : null;
  if (options.pull && top === null) {
    // Not a git checkout (a tarball or a registry install): upgrading means
    // re-running the installer, which is still worth doing.
    // trace:exempt reason=unit-test
    return runInstaller(repo, installer, before, false, "not a git checkout; reinstalled in place", quiet);
  }
  if (top !== null) {
    // --ff-only: a diverged checkout is the user's to resolve, not something
    // an update command should paper over with a merge.
    // trace:exempt reason=internal-detail
    const pull = spawnSync("git", ["-C", top, "pull", "--ff-only"], { stdio: quiet ? "pipe" : "inherit", timeout: 120000 });
    if (pull.status !== 0) {
      return {
        ok: false,
        repo: top,
        before,
        after: null,
        pulled: false,
        detail: `git pull --ff-only failed (exit ${pull.status ?? "signal"}) — resolve the checkout and re-run`,
      };
    }
    pulled = true;
  }
  return runInstaller(repo, installer, before, pulled, pulled ? "pulled and reinstalled" : "reinstalled in place", quiet);
}

// trace:exempt reason=internal-detail
function runInstaller(repo: string, installer: string, before: string | null, pulled: boolean, detail: string, quiet: boolean): UpdateResult {
  // stdio inherited so the toolchain output is visible while it runs; piped
  // when the caller asked for --json, where interleaved output would corrupt it.
  // trace:exempt reason=internal-detail
  const run = spawnSync("bash", [installer], { stdio: quiet ? "pipe" : "inherit", timeout: 600000 });
  const after = installedVersion();
  if (run.status !== 0) {
    return { ok: false, repo, before, after, pulled, detail: `installer failed (exit ${run.status ?? "signal"})` };
  }
  // trace:exempt reason=unit-test
  const change = before !== null && after !== null && before !== after ? `${before} -> ${after}` : `${after ?? "unknown"} (unchanged)`;
  return { ok: true, repo, before, after, pulled, detail: `${detail}: ${change}` };
}