// seed-cli research: revalidate the research catalogs on demand.
//
// Purpose: `seed research refresh` reruns the catalog validator so researchers
// see hashline/snapcompact errors without remembering the script path. Why it
// exists: research/*.yaml entries carry hashline + snapcompact refs enforced
// by scripts/seed-research-catalog.py; the CLI surfaces that gate.
// Responsibilities: spawn the validator, capture output, report pass/fail.
// Invariants: read-only (validator never writes); never throws.
// Public functions/types: ResearchReport, refreshResearch.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { seedRoot } from "./state.ts";

// trace:exempt reason=internal-detail
export interface ResearchReport {
  ok: boolean;
  output: string;
}

// trace:v1 id=impl.cli-research-refresh work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function refreshResearch(dir?: string, root?: string): ResearchReport {
  const repo = seedRoot(root);
  const args = [join(repo, "scripts", "seed-research-catalog.py")];
  if (dir) args.push("--dir", dir);
  try {
    const child = spawnSync("python3", args, { encoding: "utf8", timeout: 60000 });
    // trace:exempt reason=internal-detail
    const output = `${child.stdout ?? ""}${child.stderr ?? ""}`.trim();
    return { ok: child.status === 0, output: output || "(no output)" };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  }
}
