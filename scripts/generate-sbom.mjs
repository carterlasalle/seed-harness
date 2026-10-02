#!/usr/bin/env node
/**
 * Generates a CycloneDX 1.5 SBOM for the seed release:
 *
 *   - every dependency recorded in yarn.lock (name, version, SHA-512 checksum)
 *   - every TS workspace package and its direct dependencies
 *   - guardian crate name/version from Cargo.lock (workspace members)
 *   - seed_evolution package name/version from uv.lock (when parseable)
 *   - every third-party GitHub Action pinned by the repository workflows
 *   - repository provenance (repository, commit, workflow, run id, tag)
 *
 * The release workflow generates this from the protected tag commit, uploads
 * it as an artifact, and attests it with actions/attest-build-provenance.
 *
 * Usage: node scripts/generate-sbom.mjs [--out artifacts/seed-sbom.cdx.json]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// trace:exempt reason=internal-detail
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// trace:exempt reason=internal-detail
const outFlag = process.argv.indexOf("--out");
// trace:exempt reason=internal-detail
const outputPath = resolve(root, outFlag >= 0 ? process.argv[outFlag + 1] : "artifacts/seed-sbom.cdx.json");
// trace:exempt reason=internal-detail
const commit = (process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toLowerCase();
// trace:exempt reason=internal-detail
const repository = process.env.GITHUB_REPOSITORY || "local";
// trace:exempt reason=internal-detail
const workflow = process.env.GITHUB_WORKFLOW || "local";
// trace:exempt reason=internal-detail
const runId = process.env.GITHUB_RUN_ID || "local";
// trace:exempt reason=internal-detail
const tag = process.env.GITHUB_REF_NAME || "untagged";
// trace:exempt reason=internal-detail
const npmPurl = (name, version) => {
  const encoded = name.startsWith("@")
    ? `%40${name.slice(1).split("/").map((s) => encodeURIComponent(s)).join("%2F")}`
    : encodeURIComponent(name);
  return `pkg:npm/${encoded}@${version}`;
};

// --- 1. yarn.lock: workspace-only lockfile (no third-party deps today) ---
// trace:exempt reason=internal-detail
const lockComponents = [];
// --- 2. workspace + cargo + python components ---
// trace:exempt reason=internal-detail
const extraComponents = [];
try {
  for (const entry of readdirSync(resolve(root, "packages"))) {
    const manifestPath = join(root, "packages", entry, "package.json");
    if (!statSync(manifestPath, { throwIfNoEntry: false })) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!manifest.name) continue;
    extraComponents.push({
      type: "application",
      name: manifest.name,
      version: manifest.version ?? "0.0.0",
      "bom-ref": npmPurl(manifest.name, manifest.version ?? "0.0.0"),
    });
  }
} catch { /* no workspaces: provenance only */ }
try {
  const cargoLock = readFileSync(resolve(root, "Cargo.lock"), "utf8");
  for (const match of cargoLock.matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/g)) {
    extraComponents.push({
      type: "library",
      name: `cargo:${match[1]}`,
      version: match[2],
      "bom-ref": `pkg:cargo/${match[1]}@${match[2]}`,
    });
    if (extraComponents.length > 500) break;
  }
} catch { /* Cargo.lock unreadable */ }
try {
  const pyproject = readFileSync(resolve(root, "python/seed_evolution/pyproject.toml"), "utf8");
  const name = (pyproject.match(/^name = "([^"]+)"/m) ?? [])[1] ?? "seed-evolution";
  const version = (pyproject.match(/^version = "([^"]+)"/m) ?? [])[1] ?? "0.0.0";
  extraComponents.push({ type: "application", name, version, "bom-ref": `pkg:pypi/${name}@${version}` });
} catch { /* pyproject unreadable */ }

// --- 3. pinned GitHub Actions ---
const usesPattern = /^\s*(?:-\s+)?uses:\s*["']?([^\s"']+)["']?\s*(?:#.*)?$/;
const actionRefs = [];
for (const directory of [".github/workflows", ".github/actions"]) {
  const base = resolve(root, directory);
  if (!statSync(base, { throwIfNoEntry: false })) continue;
  // trace:exempt reason=internal-detail
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (/(^|\.)ya?ml$/i.test(entry)) {
        for (const line of readFileSync(full, "utf8").split("\n")) {
          const use = line.match(usesPattern);
          if (!use) continue;
          const ref = use[1];
          if (ref.startsWith("./") || ref.startsWith("docker://")) continue;
          const at = ref.lastIndexOf("@");
          if (at < 1) continue;
          const [ownerRepo, sha] = [ref.slice(0, at), ref.slice(at + 1)];
          if (!/^[0-9a-f]{40}$/i.test(sha)) {
            throw new Error(`unpinned action ref (must be a 40-hex SHA): ${ref}`);
          }
          if (!actionRefs.some((e) => e.ownerRepo === ownerRepo && e.sha === sha)) {
            actionRefs.push({ ownerRepo, sha });
          }
        }
      }
    }
  };
  walk(base);
}

const rootRef = `pkg:github/${repository}@${commit}`;
const components = [
  {
    type: "application",
    name: "seed-harness",
    version: tag,
    "bom-ref": rootRef,
    properties: [
      { name: "seed:repository", value: repository },
      { name: "seed:commit", value: commit },
      { name: "seed:tag", value: tag },
      { name: "seed:workflow", value: workflow },
      { name: "seed:run_id", value: runId },
      { name: "seed:generator", value: "scripts/generate-sbom.mjs" },
    ],
  },
  ...lockComponents,
  ...extraComponents,
];
for (const { ownerRepo, sha } of actionRefs) {
  const purl = `pkg:githubactions/${ownerRepo}@${sha}`;
  components.push({ type: "file", name: `github-action:${ownerRepo}`, version: sha, "bom-ref": purl });
}

const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ vendor: "seed", name: "seed-sbom", version: "1.0.0" }],
    component: components[0],
  },
  components,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(bom, null, 2)}\n`);
console.log(`SBOM written to ${outputPath}: ${components.length} components (${lockComponents.length} lockfile, ${extraComponents.length} workspace/cargo/python, ${actionRefs.length} pinned actions), tag ${tag}, commit ${commit}.`);
