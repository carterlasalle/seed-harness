/**
 * seed-core capability manifest parsing.
 *
 * Purpose: validate and normalize a `capability.json` manifest into the single
 * canonical shape consumed by the registry, router and lifecycle modules.
 * Why it exists: capability packages cross an input trust boundary (spec
 * section 23), so validation happens once, here, instead of in every consumer.
 * Responsibilities: enforce schema_version 1, kind/runtime compatibility,
 * and the entrypoint/tools/permissions/limits/activation/contributions/
 * evaluation/provenance shapes; require unique contribution ids; reject path
 * traversal (`..`) in id, path and entrypoint.
 * Invariants: pure (no I/O, no globals); accepts the on-disk schema field
 * names (`name`, `kind`, ...) plus the v1 registry fields (`id`, `runtime`,
 * `contributions`); unknown top-level keys are rejected except `$comment` and
 * `x-*`; output is normalized (defaults filled, arrays de-duplicated, order
 * stable) and independent of input key order.
 * Public: parseCapabilityManifest, CapabilityManifest, CapabilityManifestError,
 * CapabilityKind/Runtime/Permission, DEFAULT_CAPABILITY_LIMITS, CAPABILITY_ABI.
 */

// trace:exempt reason=internal-detail
export type CapabilityKind = "python" | "process";
// trace:exempt reason=internal-detail
export type CapabilityRuntime = "python" | "process" | "mcp";
// trace:exempt reason=internal-detail
export type CapabilityPermission = "fs.read" | "fs.write" | "net" | "exec";

// trace:exempt reason=internal-detail
export const CAPABILITY_PERMISSIONS: readonly CapabilityPermission[] = [
  "fs.read",
  "fs.write",
  "net",
  "exec",
];

// trace:exempt reason=internal-detail
export const CAPABILITY_ABI = "jsonl-stdio";

// trace:exempt reason=internal-detail
export const DEFAULT_CAPABILITY_LIMITS: CapabilityLimits = { timeoutMs: 5000, maxOutputBytes: 65536 };

// trace:exempt reason=internal-detail
export interface CapabilityLimits {
  timeoutMs: number;
  maxOutputBytes: number;
}

// trace:exempt reason=internal-detail
export interface CapabilityActivation {
  default: boolean;
  tags: string[];
  languages: string[];
  repos: string[];
  models: string[];
}

// trace:exempt reason=internal-detail
export interface CapabilityContribution {
  id: string;
  description: string;
}

// trace:exempt reason=internal-detail
export interface CapabilityEvaluation {
  tasks: string[];
  oracles: string[];
}

// trace:exempt reason=internal-detail
export interface CapabilityProvenance {
  origin: string;
  source: string;
}

// trace:exempt reason=internal-detail
export interface CapabilityManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  kind: CapabilityKind;
  runtime: CapabilityRuntime;
  entrypoint: string;
  path: string;
  description: string;
  tools: string[];
  permissions: CapabilityPermission[];
  limits: CapabilityLimits;
  abi: typeof CAPABILITY_ABI;
  activation: CapabilityActivation;
  contributions: CapabilityContribution[];
  evaluation: CapabilityEvaluation;
  provenance: CapabilityProvenance;
}

// trace:v1 id=impl.sc-capability-manifest-error work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export class CapabilityManifestError extends Error {
  readonly issues: string[];

  // trace:exempt reason=internal-detail
  constructor(issues: string[]) {
    super(`invalid capability manifest: ${issues.join("; ")}`);
    this.name = "CapabilityManifestError";
    this.issues = issues;
  }
}

// trace:exempt reason=internal-detail
const NAME_PATTERN = /^[a-z0-9-]+(\/[a-z0-9-]+)?$/;
// trace:exempt reason=internal-detail
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
// trace:exempt reason=internal-detail
const TRAVERSAL_PATTERN = /(^|[\\/])\.\.([\\/]|$)/;

// trace:exempt reason=internal-detail
const ALLOWED_KEYS: Record<string, true> = {
  $comment: true,
  schema_version: true,
  id: true,
  name: true,
  version: true,
  kind: true,
  runtime: true,
  entrypoint: true,
  path: true,
  description: true,
  tools: true,
  permissions: true,
  limits: true,
  abi: true,
  activation: true,
  contributions: true,
  evaluation: true,
  provenance: true,
};

// trace:exempt reason=internal-detail
const PERMISSION_MEMBERSHIP: Record<string, true> = {
  "fs.read": true,
  "fs.write": true,
  net: true,
  exec: true,
};

// trace:exempt reason=internal-detail
function readString(
  source: Record<string, unknown>,
  key: string,
  issues: string[],
  required: boolean,
): string | null {
  // trace:exempt reason=internal-detail
  const value = source[key];
  if (value === undefined) {
    if (required) issues.push(`missing required field "${key}"`);
    return null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`field "${key}" must be a non-empty string`);
    return null;
  }
  return value.trim();
}

// trace:exempt reason=internal-detail
function readStringArray(
  source: Record<string, unknown>,
  key: string,
  issues: string[],
): string[] | null {
  // trace:exempt reason=internal-detail
  const value = source[key];
  if (value === undefined) return null;
  if (!Array.isArray(value)) {
    issues.push(`field "${key}" must be an array of strings`);
    return null;
  }
  // trace:exempt reason=internal-detail
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      issues.push(`field "${key}" must contain only non-empty strings`);
      return null;
    }
    // trace:exempt reason=internal-detail
    const text = item.trim();
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

// trace:exempt reason=internal-detail
function rejectUnknownKeys(
  source: Record<string, unknown>,
  allowed: Record<string, true>,
  scope: string,
  issues: string[],
): void {
  for (const key of Object.keys(source)) {
    if (Object.hasOwn(allowed, key) || key.startsWith("x-")) continue;
    issues.push(`unknown field "${key}" in ${scope}`);
  }
}

// trace:exempt reason=internal-detail
function parseActivation(source: Record<string, unknown> | null, issues: string[]): CapabilityActivation {
  // trace:exempt reason=internal-detail
  const out: CapabilityActivation = { default: false, tags: [], languages: [], repos: [], models: [] };
  if (source === null) return out;
  // trace:exempt reason=internal-detail
  rejectUnknownKeys(source, { default: true, tags: true, languages: true, repos: true, models: true }, '"activation"', issues);
  // trace:exempt reason=internal-detail
  const def = source["default"];
  if (def !== undefined) {
    if (typeof def !== "boolean") issues.push('field "activation.default" must be a boolean');
    else out.default = def;
  }
  for (const key of ["tags", "languages", "repos", "models"] as const) {
    // trace:exempt reason=internal-detail
    const values = readStringArray(source, key, issues);
    if (values !== null) out[key] = values;
  }
  return out;
}

// trace:exempt reason=internal-detail
function parseLimits(source: Record<string, unknown> | null, issues: string[]): CapabilityLimits {
  // trace:exempt reason=internal-detail
  const out: CapabilityLimits = { ...DEFAULT_CAPABILITY_LIMITS };
  if (source === null) return out;
  // trace:exempt reason=internal-detail
  rejectUnknownKeys(source, { timeoutMs: true, maxOutputBytes: true }, '"limits"', issues);
  for (const key of ["timeoutMs", "maxOutputBytes"] as const) {
    // trace:exempt reason=internal-detail
    const value = source[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      issues.push(`field "limits.${key}" must be an integer >= 1`);
      continue;
    }
    out[key] = value;
  }
  return out;
}

// trace:exempt reason=internal-detail
function parsePermissions(source: Record<string, unknown>, issues: string[]): CapabilityPermission[] {
  // trace:exempt reason=internal-detail
  const values = readStringArray(source, "permissions", issues) ?? [];
  // trace:exempt reason=internal-detail
  const out: CapabilityPermission[] = [];
  for (const value of values) {
    if (!Object.hasOwn(PERMISSION_MEMBERSHIP, value)) {
      issues.push(`unknown permission "${value}" (expected one of ${CAPABILITY_PERMISSIONS.join(", ")})`);
      continue;
    }
    out.push(value as CapabilityPermission);
  }
  return out;
}

// trace:exempt reason=internal-detail
function parseContributions(source: Record<string, unknown>, issues: string[]): CapabilityContribution[] {
  // trace:exempt reason=internal-detail
  const value = source["contributions"];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push('field "contributions" must be an array');
    return [];
  }
  // trace:exempt reason=internal-detail
  const out: CapabilityContribution[] = [];
  // trace:exempt reason=internal-detail
  const seen: Record<string, true> = {};
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      issues.push('each "contributions" entry must be an object');
      continue;
    }
    // trace:exempt reason=internal-detail
    const entry = item as Record<string, unknown>;
    // trace:exempt reason=internal-detail
    rejectUnknownKeys(entry, { id: true, description: true }, '"contributions" entry', issues);
    // trace:exempt reason=internal-detail
    const id = readString(entry, "id", issues, true);
    if (id === null) continue;
    if (Object.hasOwn(seen, id)) {
      issues.push(`duplicate contribution id "${id}"`);
      continue;
    }
    seen[id] = true;
    out.push({ id, description: readString(entry, "description", issues, false) ?? "" });
  }
  return out;
}

// trace:exempt reason=internal-detail
function parseEvaluation(source: Record<string, unknown> | null, issues: string[]): CapabilityEvaluation {
  if (source === null) return { tasks: [], oracles: [] };
  // trace:exempt reason=internal-detail
  rejectUnknownKeys(source, { tasks: true, oracles: true }, '"evaluation"', issues);
  return {
    tasks: readStringArray(source, "tasks", issues) ?? [],
    oracles: readStringArray(source, "oracles", issues) ?? [],
  };
}

// trace:exempt reason=internal-detail
function parseProvenance(source: Record<string, unknown> | null, issues: string[]): CapabilityProvenance {
  if (source === null) return { origin: "", source: "" };
  // trace:exempt reason=internal-detail
  rejectUnknownKeys(source, { origin: true, source: true }, '"provenance"', issues);
  return {
    origin: readString(source, "origin", issues, false) ?? "",
    source: readString(source, "source", issues, false) ?? "",
  };
}

// trace:v1 id=impl.sc-capability-manifest-parse work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-AJZXZFBN
export function parseCapabilityManifest(input: unknown): CapabilityManifest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new CapabilityManifestError(["manifest must be a JSON object"]);
  }
  const source = input as Record<string, unknown>;
  const issues: string[] = [];
  // trace:exempt reason=internal-detail
  rejectUnknownKeys(source, ALLOWED_KEYS, "manifest", issues);

  // trace:exempt reason=internal-detail
  const version = readString(source, "version", issues, true);
  if (version !== null && !VERSION_PATTERN.test(version)) {
    issues.push(`field "version" must be semver x.y.z: ${JSON.stringify(version)}`);
  }

  // trace:exempt reason=internal-detail
  const named = readString(source, "id", issues, false);
  // trace:exempt reason=internal-detail
  const legacyName = readString(source, "name", issues, false);
  if (named !== null && legacyName !== null && named !== legacyName) {
    issues.push(`fields "id" and "name" must agree when both are present (${named} != ${legacyName})`);
  }
  // trace:exempt reason=internal-detail
  const id = named ?? legacyName;
  if (id === null) issues.push('missing required field "id" (or "name")');
  else if (!NAME_PATTERN.test(id)) {
    issues.push(`field "id" must match ${NAME_PATTERN}: ${JSON.stringify(id)}`);
  }
  if (id !== null && TRAVERSAL_PATTERN.test(id)) {
    issues.push(`field "id" must not contain path traversal (".."): ${JSON.stringify(id)}`);
  }

  // trace:exempt reason=internal-detail
  const schemaVersion = source["schema_version"];
  if (schemaVersion !== undefined && schemaVersion !== 1) {
    issues.push(`field "schema_version" must be 1 (got ${JSON.stringify(schemaVersion)})`);
  }

  // trace:exempt reason=internal-detail
  const entrypoint = readString(source, "entrypoint", issues, true);
  if (entrypoint !== null && TRAVERSAL_PATTERN.test(entrypoint)) {
    issues.push(`field "entrypoint" must not contain path traversal (".."): ${JSON.stringify(entrypoint)}`);
  }
  // trace:exempt reason=internal-detail
  const path = readString(source, "path", issues, false) ?? "";
  if (path !== "" && TRAVERSAL_PATTERN.test(path)) {
    issues.push(`field "path" must not contain path traversal (".."): ${JSON.stringify(path)}`);
  }

  // trace:exempt reason=internal-detail
  const kind = readString(source, "kind", issues, false);
  // trace:exempt reason=internal-detail
  const runtime = readString(source, "runtime", issues, false);
  if (kind === null && runtime === null) {
    issues.push('missing required field "kind" (or "runtime")');
  }
  if (kind !== null && kind !== "python" && kind !== "process") {
    issues.push(`field "kind" must be "python" or "process" (got ${JSON.stringify(kind)})`);
  }
  if (runtime !== null && runtime !== "python" && runtime !== "process" && runtime !== "mcp") {
    issues.push(`field "runtime" must be "python", "process" or "mcp" (got ${JSON.stringify(runtime)})`);
  }
  if (kind !== null && runtime !== null) {
    // trace:exempt reason=internal-detail
    const compatible = kind === "python" ? runtime === "python" : runtime === "process" || runtime === "mcp";
    if (!compatible) issues.push(`fields "kind" and "runtime" disagree (${kind} vs ${runtime})`);
  }

  // trace:exempt reason=internal-detail
  const abiValue = source["abi"];
  if (abiValue !== undefined && abiValue !== CAPABILITY_ABI) {
    issues.push(`field "abi" must be ${JSON.stringify(CAPABILITY_ABI)} (got ${JSON.stringify(abiValue)})`);
  }

  // trace:exempt reason=internal-detail
  const tools = readStringArray(source, "tools", issues) ?? [];
  // trace:exempt reason=internal-detail
  const description = readString(source, "description", issues, false) ?? "";
  // trace:exempt reason=internal-detail
  const permissions = parsePermissions(source, issues);
  // trace:exempt reason=internal-detail
  const limits = parseLimits(readOptionalObject(source, "limits", issues), issues);
  // trace:exempt reason=internal-detail
  const activation = parseActivation(readOptionalObject(source, "activation", issues), issues);
  // trace:exempt reason=internal-detail
  const contributions = parseContributions(source, issues);
  // trace:exempt reason=internal-detail
  const evaluation = parseEvaluation(readOptionalObject(source, "evaluation", issues), issues);
  // trace:exempt reason=internal-detail
  const provenance = parseProvenance(readOptionalObject(source, "provenance", issues), issues);

  if (issues.length > 0) throw new CapabilityManifestError(issues);

  // trace:exempt reason=internal-detail
  const normalizedKind: CapabilityKind =
    kind === "python" || kind === "process" ? kind : runtime === "python" ? "python" : "process";
  // trace:exempt reason=internal-detail
  const normalizedRuntime: CapabilityRuntime =
    runtime === "python" || runtime === "process" || runtime === "mcp" ? runtime : normalizedKind;

  return {
    schemaVersion: 1,
    id: id ?? "",
    version: version ?? "",
    kind: normalizedKind,
    runtime: normalizedRuntime,
    entrypoint: entrypoint ?? "",
    path,
    description,
    tools,
    permissions,
    limits,
    abi: CAPABILITY_ABI,
    activation,
    contributions,
    evaluation,
    provenance,
  };
}

// trace:exempt reason=internal-detail
function readOptionalObject(
  source: Record<string, unknown>,
  key: string,
  issues: string[],
): Record<string, unknown> | null {
  // trace:exempt reason=internal-detail
  const value = source[key];
  if (value === undefined) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push(`field "${key}" must be an object`);
    return null;
  }
  return value as Record<string, unknown>;
}
