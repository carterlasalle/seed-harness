// seed-cli doctor: dependency and state checks for a fresh checkout.
//
// Purpose: `seed doctor` answers "can this machine run Seed?" in one command.
// Why it exists: REQ-SEED-EZPD6B85 acceptance is literally `seed doctor`
// runs, and CI plus every other command assumes the toolchain it verifies.
// Responsibilities: probe Node/Yarn/uv/Python/Rust/Docker/socket/SQLite,
// champion pointer, schemas, and guardian address config. Invariants: never
// throws (every probe catches); never touches the network; exit nonzero when
// any check fails. Public functions/types: DoctorCheck, DoctorReport,
// runDoctor.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadChampion, seedRoot, stateDir } from "./state.ts";
import { validateSchemas } from "./schema.ts";
// trace:exempt reason=internal-detail
export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

// trace:exempt reason=internal-detail
export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

// trace:v1 id=impl.cli-doctor-probe work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
function probeVersion(name: string, command: string, args: string[]): DoctorCheck {
  try {
    const child = spawnSync(command, args, { encoding: "utf8", timeout: 15000 });
    if (child.error) throw child.error;
    if (child.status !== 0) {
      return { name, ok: false, detail: `${command} exited ${child.status}` };
    }
    // trace:exempt reason=unit-test
    const firstLine = String(child.stdout).split("\n")[0].trim();
    return { name, ok: true, detail: firstLine.slice(0, 80) || "present" };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

// trace:v1 id=impl.cli-doctor-run work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export async function runDoctor(root?: string): Promise<DoctorReport> {
  const repo = seedRoot(root);
  const checks: DoctorCheck[] = [];
  const node = probeVersion("node", "node", ["--version"]);
  node.ok = node.ok && /^v(2[2-9]|[3-9][0-9])\./.test(node.detail);
  if (node.ok && !/^v(2[2-9]|[3-9][0-9])\./.test(node.detail)) node.detail += " (need >=22)";
  checks.push(node);
  checks.push(probeVersion("yarn", "yarn", ["--version"]));
  checks.push(probeVersion("uv", "uv", ["--version"]));
  checks.push(probeVersion("python", "python3", ["--version"]));
  checks.push(probeVersion("rust", "cargo", ["--version"]));
  checks.push(probeVersion("docker-cli", "docker", ["--version"]));
  try {
    // trace:exempt reason=internal-detail
    const child = spawnSync("docker", ["info"], { encoding: "utf8", timeout: 15000 });
    checks.push(
      child.status === 0
        ? { name: "docker-socket", ok: true, detail: "daemon reachable" }
        : { name: "docker-socket", ok: false, detail: String(child.stderr).split("\n")[0] || "daemon unreachable" },
    );
  } catch (error) {
    checks.push({
      name: "docker-socket",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  // Dynamic import is load-bearing here: doctor must report a missing
  // node:sqlite as a failed check, which a static import cannot do (the
  // module would fail to load at all).
  try {
    await import("node:sqlite");
    checks.push({ name: "sqlite", ok: true, detail: "node:sqlite loads" });
  } catch (error) {
    checks.push({
      name: "sqlite",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  try {
    // No root argument: runtime state lives in ~/.seed (ADR-0002), so doctor
    // must report the directory the rest of the CLI actually uses. Passing the
    // repo root would read and resurrect a stale <repo>/.seed-state.
    // trace:exempt reason=internal-detail
    const champion = loadChampion();
    checks.push({
      name: "champion",
      ok: typeof champion.ref === "string" && champion.ref.length > 0,
      detail: `ref=${champion.ref} (${champion.history.length} history entries in ${stateDir()})`,
    });
  } catch (error) {
    checks.push({
      name: "champion",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  // trace:exempt reason=internal-detail
  const schemaReport = validateSchemas(repo);
  checks.push(
    schemaReport.ok
      ? { name: "schemas", ok: true, detail: `${schemaReport.schemas.length} schemas parse with object titles` }
      : { name: "schemas", ok: false, detail: `invalid: ${schemaReport.badSchemas.join(", ")}` },
  );
  checks.push(
    schemaReport.manifests > 0 && schemaReport.badManifests.length === 0
      ? { name: "capability-manifests", ok: true, detail: `${schemaReport.manifests} manifests match schemas/capability.schema.json required fields` }
      : { name: "capability-manifests", ok: false, detail: schemaReport.badManifests.length > 0 ? `invalid: ${schemaReport.badManifests.join(", ")}` : "no manifests discovered" },
  );
  // trace:exempt reason=internal-detail
  let guardianUrl = process.env.SEED_GUARDIAN_URL ?? "";
  // trace:exempt reason=internal-detail
  const envFile = join(repo, ".env");
  if (!guardianUrl && existsSync(envFile)) {
    // trace:exempt reason=internal-detail
    const match = /^SEED_GUARDIAN_URL=(.+)$/m.exec(readFileSync(envFile, "utf8"));
    if (match) guardianUrl = match[1].trim();
  }
  checks.push(
    guardianUrl.length > 0
      ? { name: "credentials", ok: true, detail: `SEED_GUARDIAN_URL=${guardianUrl}` }
      : {
          name: "credentials",
          ok: false,
          detail: "SEED_GUARDIAN_URL unset (doctor exits 1 by design); copy .env.example to .env",
        },
  );
  return { ok: checks.every((c) => c.ok), checks };
}
