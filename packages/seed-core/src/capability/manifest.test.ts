/**
 * manifest.test.ts — parseCapabilityManifest: valid/invalid/traversal/dup-id.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CapabilityManifestError, parseCapabilityManifest } from "./manifest.ts";

const validManifest = {
  schema_version: 1,
  id: "test/echo",
  version: "0.1.0",
  runtime: "process",
  entrypoint: "server.py",
  description: "echo server",
  tools: ["echo", "echo"],
  permissions: ["fs.read"],
  limits: { timeoutMs: 1000 },
  activation: { default: true, tags: ["fixture"] },
  contributions: [{ id: "echo", description: "echoes params" }],
  evaluation: { tasks: ["t1"], oracles: ["o1"] },
  provenance: { origin: "crystallizer", source: "task-7" },
};

test("parses and normalizes a full manifest", () => {
  const manifest = parseCapabilityManifest(validManifest);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.id, "test/echo");
  assert.equal(manifest.kind, "process");
  assert.equal(manifest.runtime, "process");
  assert.deepEqual(manifest.tools, ["echo"]);
  assert.deepEqual(manifest.permissions, ["fs.read"]);
  assert.deepEqual(manifest.limits, { timeoutMs: 1000, maxOutputBytes: 65536 });
  assert.equal(manifest.activation.default, true);
  assert.deepEqual(manifest.activation.tags, ["fixture"]);
  assert.equal(manifest.contributions[0]?.id, "echo");
  assert.deepEqual(manifest.evaluation.tasks, ["t1"]);
  assert.equal(manifest.provenance.origin, "crystallizer");
});

test("accepts the on-disk schema field names with defaults", () => {
  const manifest = parseCapabilityManifest({
    name: "fixtures/echo",
    version: "0.1.0",
    kind: "process",
    entrypoint: "server.py",
  });
  assert.equal(manifest.kind, "process");
  assert.equal(manifest.runtime, "process");
  assert.deepEqual(manifest.tools, []);
  assert.deepEqual(manifest.permissions, []);
  assert.equal(manifest.activation.default, false);
});

test("rejects missing required fields", () => {
  assert.throws(
    () => parseCapabilityManifest({ id: "test/x", kind: "process", entrypoint: "s.py" }),
    (error: unknown) => error instanceof CapabilityManifestError && error.issues.some((issue) => issue.includes('"version"')),
  );
});

test("rejects wrong schema_version and unknown runtime", () => {
  assert.throws(
    () => parseCapabilityManifest({ ...validManifest, schema_version: 2 }),
    CapabilityManifestError,
  );
  assert.throws(
    () => parseCapabilityManifest({ ...validManifest, runtime: "wasm" }),
    CapabilityManifestError,
  );
});

test("rejects unknown top-level fields", () => {
  assert.throws(
    () => parseCapabilityManifest({ ...validManifest, surprise: true }),
    (error: unknown) => error instanceof CapabilityManifestError && error.issues.some((issue) => issue.includes("surprise")),
  );
});

test("rejects a non-string description and a malformed version", () => {
  assert.throws(
    () => parseCapabilityManifest({ ...validManifest, description: 42 }),
    (error: unknown) => error instanceof CapabilityManifestError && error.issues.some((issue) => issue.includes("description")),
  );
  assert.throws(
    () => parseCapabilityManifest({ ...validManifest, version: "1.0" }),
    (error: unknown) => error instanceof CapabilityManifestError && error.issues.some((issue) => issue.includes("semver")),
  );
});

test("rejects path traversal in id, path and entrypoint", () => {
  for (const payload of [
    { ...validManifest, id: "../evil" },
    { ...validManifest, path: "a/../b" },
    { ...validManifest, entrypoint: "../server.py" },
    { ...validManifest, entrypoint: ".." },
  ]) {
    assert.throws(() => parseCapabilityManifest(payload), CapabilityManifestError);
  }
});

test("rejects duplicate contribution ids", () => {
  assert.throws(
    () => parseCapabilityManifest({ ...validManifest, contributions: [{ id: "echo" }, { id: "echo" }] }),
    (error: unknown) =>
      error instanceof CapabilityManifestError && error.issues.some((issue) => issue.includes("duplicate contribution id")),
  );
});

test("contribution kinds default to tool and cover skills hooks mcp lsp", () => {
  const manifest = parseCapabilityManifest({
    ...validManifest,
    contributions: [
      { id: "t", description: "tool" },
      { id: "s", description: "skill", kind: "skill" },
      { id: "h", description: "hook", kind: "hook" },
      { id: "m", description: "mcp", kind: "mcp" },
      { id: "l", description: "lsp", kind: "lsp" },
    ],
  });
  assert.deepEqual(manifest.contributions.map((c) => c.kind), ["tool", "skill", "hook", "mcp", "lsp"]);
  assert.throws(
    () => parseCapabilityManifest({ ...validManifest, contributions: [{ id: "x", kind: "wizard" }] }),
    CapabilityManifestError,
  );
});
test("rejects kind/runtime disagreement and bad permissions", () => {
  assert.throws(
    () => parseCapabilityManifest({ ...validManifest, kind: "python", runtime: "mcp" }),
    CapabilityManifestError,
  );
  assert.throws(
    () => parseCapabilityManifest({ ...validManifest, permissions: ["root"] }),
    CapabilityManifestError,
  );
});
