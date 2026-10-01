// seed-cli schema: `seed schema validate` over schemas/ plus manifests.
//
// Purpose: the static gate for capability manifests (spec section 67) —
// validate every JSON schema parses and every discovered capability
// manifest satisfies the required fields. Why it exists: REQ-SEED-EZPD6B85
// needs `yarn seed schema validate` to pass in CI; doctor reports it, this
// command enforces it with a nonzero exit. Responsibilities: schema parse
// check, manifest required-field check, human-readable report.
// Invariants: stdlib only; read-only; exit 0 only when everything passes.
// Public functions/types: SchemaReport, validateSchemas.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { seedRoot } from "./state.ts";
import { discoverCapabilities } from "./capabilities.ts";

// trace:exempt reason=internal-detail
export interface SchemaReport {
  ok: boolean;
  schemas: string[];
  badSchemas: string[];
  manifests: number;
  badManifests: string[];
}

// trace:v1 id=impl.cli-schema-validate work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function validateSchemas(root?: string): SchemaReport {
  const repo = seedRoot(root);
  const schemaFiles = [
    "capability.schema.json",
    "event.schema.json",
    "experiment.schema.json",
    "hypothesis.schema.json",
    "model-profile.schema.json",
  ];
  // trace:exempt reason=internal-detail
  const badSchemas: string[] = [];
  for (const file of schemaFiles) {
    try {
      // trace:exempt reason=internal-detail
      const raw = JSON.parse(readFileSync(join(repo, "schemas", file), "utf8")) as {
        title?: unknown;
        type?: unknown;
      };
      if (raw.type !== "object" || typeof raw.title !== "string") badSchemas.push(file);
    } catch {
      badSchemas.push(file);
    }
  }
  const caps = discoverCapabilities(repo);
  // trace:exempt reason=internal-detail
  const badManifests = caps
    .filter((c) => typeof c.name !== "string" || typeof c.entrypoint !== "string")
    .map((c) => String(c.name));
  return {
    ok: badSchemas.length === 0 && badManifests.length === 0 && caps.length > 0,
    schemas: schemaFiles,
    badSchemas,
    manifests: caps.length,
    badManifests,
  };
}
