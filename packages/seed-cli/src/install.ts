// install.ts — where this CLI was installed from, and where its user config lives.
//
// Purpose: resolve paths from the CLI's own location rather than the caller's
// working directory.
// Why it exists: `seed` is installed globally and then run from other
// projects. Resolving the checkout or the `.env` from cwd made `seed update`
// fail (or, worse, run an unrelated repository's installer) and made a
// registry install read whatever `.env` happened to be nearby.
// Responsibilities: identify a source checkout by layout, not by name, and
// name the user config directory that works for every install mode.
// Invariants: never throws; returns null rather than guessing when the layout
// does not match; the checkout test looks for markers a Seed checkout has, so
// an unrelated repository above a node_modules tree is not mistaken for one.
// Public functions: installRoot, userConfigDir.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The Seed checkout this CLI runs from, or null for a registry install.
 *
 * Unbuilt, this module sits in `packages/seed-cli/src`; built, in
 * `packages/seed-cli/dist`. Either way the package root is one level up and
 * the checkout is two above that. Both markers must be present, so walking up
 * from `node_modules` cannot land on some other project that merely has an
 * installer script.
 */
// trace:v1 id=impl.cli-install-root work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function installRoot(): string | null {
  // trace:exempt reason=internal-detail
  const packageRoot = dirname(import.meta.dirname);
  // trace:exempt reason=internal-detail
  const candidate = join(packageRoot, "..", "..");
  if (!existsSync(join(candidate, "scripts", "install.sh"))) return null;
  if (!existsSync(join(candidate, "crates", "seed-guardian"))) return null;
  return candidate;
}

/**
 * Per-user configuration directory. Registry installs have no checkout, so
 * this is the one location that works for every install mode.
 */
// trace:v1 id=impl.cli-user-config-dir work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function userConfigDir(): string {
  // trace:exempt reason=internal-detail
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg !== undefined && xdg.length > 0) return join(xdg, "seed");
  return join(homedir(), ".seed");
}