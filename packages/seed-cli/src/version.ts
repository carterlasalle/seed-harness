// version.ts — the CLI's own version.
//
// Purpose: tell the update reminder which version is installed.
// Why it exists: the reminder was called with a hardcoded literal, so it
// compared the latest release against a stale number and could report the
// wrong thing — or nothing — regardless of what was actually installed.
// Responsibilities: read `package.json` next to this module.
// Invariants: never throws; returns null when the version is unknown so the
// caller can skip the reminder rather than invent a number.
// Public functions: installedVersion.

import { readFileSync } from "node:fs";
import { join } from "node:path";

// trace:v1 id=impl.cli-installed-version work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function installedVersion(): string | null {
  try {
    // Works from both `src/` (unbuilt, node strip-types) and `dist/`, since
    // the manifest sits one level above either.
    const path = join(import.meta.dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : null;
  } catch {
    return null;
  }
}