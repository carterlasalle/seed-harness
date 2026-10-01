// seed-cli capabilities: capability-package discovery, display, and live calls.
//
// Purpose: the CLI's view of the capability registry (list/show) plus the one
// live call the CLI needs (echo probe proving install -> execute works). Why
// it exists: REQ-SEED-EZPD6B85 needs `seed capabilities list|show` to read the
// same manifests the router ranks, and `seed run` needs a real execution
// probe without duplicating router logic. Responsibilities: scan
// capabilities/*/capability.json, minimal manifest validation, JSONL-stdio
// echo roundtrip via the echo fixture. Invariants: read-only except spawning
// the fixture process; never exceeds stdlib; manifests sorted by name.
// Public functions/types: CapabilityManifest, discoverCapabilities,
// showCapability, callEcho.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { seedRoot } from "./state.ts";

// trace:exempt reason=internal-detail
export interface CapabilityManifest {
  name: string;
  version: string;
  kind: string;
  entrypoint: string;
  description?: string;
  tools?: string[];
  permissions?: string[];
  limits?: { timeoutMs?: number; maxOutputBytes?: number };
  abi?: string;
  dir: string;
}

// trace:v1 id=impl.cli-caps-discover work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function discoverCapabilities(root?: string): CapabilityManifest[] {
  const base = join(seedRoot(root), "capabilities");
  const found: CapabilityManifest[] = [];
  for (const group of ["builtin", "fixtures"]) {
    const groupDir = join(base, group);
    let entries: string[] = [];
    try {
      entries = readdirSync(groupDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      continue;
    }
    // trace:exempt reason=internal-detail
    for (const entry of entries) {
      // trace:exempt reason=internal-detail
      const manifestPath = join(groupDir, entry, "capability.json");
      if (!existsSync(manifestPath)) continue;
      try {
        // trace:exempt reason=internal-detail
        const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
        if (
          typeof raw.name !== "string" ||
          typeof raw.version !== "string" ||
          typeof raw.kind !== "string" ||
          typeof raw.entrypoint !== "string"
        ) {
          continue;
        }
        found.push({ ...(raw as Omit<CapabilityManifest, "dir">), dir: join(groupDir, entry) });
      } catch {
        continue;
      }
    }
  }
  found.sort((a, b) => (a.name < b.name ? -1 : 1));
  return found;
}

// trace:v1 id=impl.cli-caps-show work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function showCapability(name: string, root?: string): CapabilityManifest | null {
  return discoverCapabilities(root).find((c) => c.name === name) ?? null;
}

// trace:v1 id=impl.cli-caps-echo work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function callEcho(params: unknown, root?: string): unknown {
  const fixture = showCapability("fixtures/echo", root);
  if (!fixture) throw new Error("echo fixture not installed");
  const server = join(fixture.dir, "server.py");
  const request = JSON.stringify({ id: 1, method: "echo", params }) + "\n";
  const timeoutMs = fixture.limits?.timeoutMs ?? 5000;
  // trace:exempt reason=internal-detail
  const child = spawnSync("python3", [server], {
    input: request,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: fixture.limits?.maxOutputBytes ?? 65536,
  });
  // trace:exempt reason=internal-detail
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`echo fixture exited ${child.status}: ${child.stderr}`);
  // trace:exempt reason=unit-test
  const line = String(child.stdout).split("\n").find((l) => l.trim().length > 0) ?? "";
  // trace:exempt reason=internal-detail
  const response = JSON.parse(line) as { id?: unknown; result?: unknown; error?: string };
  if (typeof response.error === "string") throw new Error(`echo fixture error: ${response.error}`);
  return response.result;
}
