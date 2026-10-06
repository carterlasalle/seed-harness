// scripts/verify-boundaries.ts — guardian/organism boundary gate.
//
// Purpose: fail loudly if the evolvable organism imports the immutable
// guardian, or if guardian-only RPC methods leak into the organism client.
// Why it exists: REQ-SEED-EZPD6B85 — the guardian/organism split is a
// security invariant enforced as code, not convention.
// Checks: (1) no file under packages/*/src mentions seed-guardian /
// seed_guardian; (2) no file under packages/seed-runtime/src names a
// guardian-only RPC method from GUARDIAN_ONLY_RPC.
// Usage: node scripts/verify-boundaries.ts (also `yarn verify`).
// Invariants: stdlib only (node:fs, node:path); erasable TS syntax so plain
// `node` runs it with no build step.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// trace:exempt reason=internal-detail
const GUARDIAN_IMPORT = /seed-guardian|seed_guardian/;

// Guardian-only RPC methods: promotion, archive eviction, gate override,
// worktree lifecycle. The organism client must never name these; it may
// call hello/task/telemetry plus champion reads and guardian-owned
// rollback (the CLI drives champion.rollback through the same client, but
// the organism loop itself never calls it).
// trace:exempt reason=internal-detail
const GUARDIAN_ONLY_RPC: string[] = [
  "candidate.promote",
  "champion.promote",
  "champion.set",
  "eval.expected",
  "guardian.db.query",
  "archive.evict",
  "gate.override",
  "worktree.destroy",
];

// Pi is a UI foundation, never a runtime dependency. The interactive
// frontend may depend on the Pi TUI package; every other package stays
// Pi-free so the execution architecture can never drift back into a fork.
// Matches import syntax (static, side-effect, dynamic, require) rather than
// bare prose, so documentation may name the package without tripping the gate.
// trace:exempt reason=internal-detail
const PI_IMPORT = /(?:import|from|require)\s*\(?\s*["']@earendil-works\/pi-tui/;
// trace:exempt reason=internal-detail
const PI_ALLOWED_PREFIX = "packages/seed-tui/";

// The registry subpath is imported by headless callers (the CLI builds a
// registry without opening a terminal), so it must stay free of terminal-UI
// imports — otherwise `seed doctor` would drag a TUI in behind it.
// trace:exempt reason=internal-detail
const REGISTRY_PREFIX = "packages/seed-tui/src/registry/";

// Roots that must never name a Pi package, across all three languages.
// trace:exempt reason=internal-detail
const PI_FORBIDDEN_ROOTS: string[] = [
  "packages/seed-core/src",
  "packages/seed-runtime/src",
  "packages/seed-lab/src",
  "packages/seed-cli/src",
  "python/seed_evolution",
  "crates/seed-guardian/src",
];

// trace:exempt reason=internal-detail
function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|js|py|rs)$/.test(name)) out.push(full);
  }
  return out;
}

// trace:exempt reason=internal-detail
function main(): void {
  const roots: string[] = [
    "packages/seed-core/src",
    "packages/seed-runtime/src",
    "packages/seed-lab/src",
    "packages/seed-cli/src",
  ];
  const files: string[] = roots.flatMap((d) => walk(d));
  const violations: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (GUARDIAN_IMPORT.test(text)) violations.push(`${file}: references guardian`);
    if (file.includes("packages/seed-runtime/src") && !file.endsWith(".test.ts")) {
      for (const method of GUARDIAN_ONLY_RPC) {
        if (text.includes(method)) violations.push(`${file}: guardian-only RPC ${method}`);
      }
    }
  }
  // Pi boundary: the frontend may import it, nothing else may; and the
  // registry subpath stays terminal-UI-free for headless callers.
  const piFiles: string[] = PI_FORBIDDEN_ROOTS.flatMap((d) => walk(d));
  for (const file of piFiles) {
    const text = readFileSync(file, "utf8");
    if (PI_IMPORT.test(text)) violations.push(`${file}: Pi import outside ${PI_ALLOWED_PREFIX}`);
  }
  const tuiFiles: string[] = walk("packages/seed-tui/src");
  for (const file of tuiFiles) {
    if (!file.startsWith(REGISTRY_PREFIX)) continue;
    const text = readFileSync(file, "utf8");
    if (PI_IMPORT.test(text)) violations.push(`${file}: registry must stay free of pi-tui imports`);
  }

  if (violations.length > 0) {
    for (const v of violations) console.error(`boundary violation: ${v}`);
    process.exit(1);
  }
  console.log(
    `boundaries ok (${files.length} organism files + ${piFiles.length} Pi-forbidden + ${tuiFiles.length} tui files checked)`,
  );
}

main();
