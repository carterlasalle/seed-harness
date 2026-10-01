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

const GUARDIAN_IMPORT = /seed-guardian|seed_guardian/;

// Guardian-only RPC methods: promotion, rollback, archive eviction, gate
// override, worktree lifecycle. The organism client must never name these;
// it may only call hello/task/telemetry.
const GUARDIAN_ONLY_RPC: string[] = [
  "champion.promote",
  "champion.rollback",
  "archive.evict",
  "gate.override",
  "worktree.destroy",
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
    if (file.includes("packages/seed-runtime/src")) {
      for (const method of GUARDIAN_ONLY_RPC) {
        if (text.includes(method)) violations.push(`${file}: guardian-only RPC ${method}`);
      }
    }
  }
  if (violations.length > 0) {
    for (const v of violations) console.error(`boundary violation: ${v}`);
    process.exit(1);
  }
  console.log(`boundaries ok (${files.length} files checked)`);
}

main();
