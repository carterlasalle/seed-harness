/**
 * registry.test.ts — discovery, activation, start/stop, permission and
 * session-safety of the capability registry.
 */
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { parseCapabilityManifest } from "./manifest.ts";
import {
  CapabilityPermissionError,
  CapabilityReloadError,
  CapabilityStartError,
  discoverCapabilities,
  reloadCapabilitySet,
  resolveCapabilitySet,
  startCapability,
  stopCapability,
  type DiscoveredCapability,
} from "./registry.ts";

const JSON_SERVER = `
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line !== "") {
      const request = JSON.parse(line);
      if (request.method === "hello") {
        process.stdout.write(JSON.stringify({ id: request.id, result: "hello" }) + "\\n");
      } else if (request.method === "echo") {
        process.stdout.write(JSON.stringify({ id: request.id, result: request.params }) + "\\n");
      } else {
        process.stdout.write(JSON.stringify({ id: request.id, error: "unknown method: " + request.method }) + "\\n");
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`;

const SILENT_SERVER = "process.stdin.resume();\n";

function tempDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "seed-core-registry-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeCapability(dir: string, manifest: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "capability.json"), JSON.stringify(manifest, null, 2));
}

function processManifest() {
  return parseCapabilityManifest({
    id: "test/echo",
    version: "0.1.0",
    kind: "process",
    entrypoint: "server.js",
    limits: { timeoutMs: 2000 },
  });
}

test("discoverCapabilities finds manifests, sorts by id+version, records invalid", (t) => {
  const root = tempDir(t);
  writeCapability(root, { name: "test/a", version: "0.2.0", kind: "process", entrypoint: "s.js" });
  writeCapability(join(root, "older"), { name: "test/a", version: "0.1.0", kind: "process", entrypoint: "s.js" });
  writeCapability(join(root, "bad"), { name: "test/bad", kind: "process", entrypoint: "s.js" });
  const discovery = discoverCapabilities(root);
  assert.deepEqual(
    discovery.capabilities.map((capability) => `${capability.id}@${capability.version}`),
    ["test/a@0.1.0", "test/a@0.2.0"],
  );
  assert.equal(discovery.skipped.length, 1);
  assert.ok(discovery.skipped[0]?.path.endsWith("bad/capability.json"));
});

test("resolveCapabilitySet applies default/tags/language/repo/model activation", () => {
  const entries: DiscoveredCapability[] = [
    { id: "test/default", version: "0.1.0", dir: "/d", manifest: parseCapabilityManifest({ id: "test/default", version: "0.1.0", kind: "python", entrypoint: "m", activation: { default: true } }) },
    { id: "test/tagged", version: "0.1.0", dir: "/t", manifest: parseCapabilityManifest({ id: "test/tagged", version: "0.1.0", kind: "python", entrypoint: "m", activation: { tags: ["lang"] } }) },
    { id: "test/language", version: "0.1.0", dir: "/l", manifest: parseCapabilityManifest({ id: "test/language", version: "0.1.0", kind: "python", entrypoint: "m", activation: { languages: ["python"] } }) },
    { id: "test/repo", version: "0.1.0", dir: "/r", manifest: parseCapabilityManifest({ id: "test/repo", version: "0.1.0", kind: "python", entrypoint: "m", activation: { repos: ["seed"] } }) },
    { id: "test/model", version: "0.1.0", dir: "/m", manifest: parseCapabilityManifest({ id: "test/model", version: "0.1.0", kind: "python", entrypoint: "m", activation: { models: ["m1"] } }) },
  ];
  const ids = (context: Parameters<typeof resolveCapabilitySet>[1]) =>
    resolveCapabilitySet(entries, context).map((capability) => capability.id);
  assert.deepEqual(ids({}), ["test/default"]);
  assert.deepEqual(ids({ tags: ["lang"] }), ["test/default", "test/tagged"]);
  assert.deepEqual(ids({ language: "python" }), ["test/default", "test/language"]);
  assert.deepEqual(ids({ repo: "seed" }), ["test/default", "test/repo"]);
  assert.deepEqual(ids({ model: "m1" }), ["test/default", "test/model"]);
});

test("startCapability spawns, hello-gates, executes and stops a process capability", async (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, "server.js"), JSON_SERVER);
  const handle = await startCapability(processManifest(), { dir, grantedPermissions: [] });
  assert.equal(handle.hello, "hello acknowledged");
  assert.equal(typeof handle.pid, "number");
  assert.deepEqual(await handle.request("echo", { hello: "world" }), { hello: "world" });
  const pid = handle.pid ?? 0;
  await stopCapability(handle);
  assert.throws(() => process.kill(pid, 0));
});

test("hello tolerance: a server without a hello method still starts", async (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, "server.js"), JSON_SERVER.replace('if (request.method === "hello") {\n        process.stdout.write(JSON.stringify({ id: request.id, result: "hello" }) + "\\n");\n      } else ', "if (false) { } else "));
  const handle = await startCapability(processManifest(), { dir, grantedPermissions: [] });
  assert.ok(handle.hello?.startsWith("hello not implemented"));
  await stopCapability(handle);
});

test("a silent capability fails the hello gate with a timeout", async (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, "server.js"), SILENT_SERVER);
  const manifest = parseCapabilityManifest({
    id: "test/silent",
    version: "0.1.0",
    kind: "process",
    entrypoint: "server.js",
    limits: { timeoutMs: 200 },
  });
  await assert.rejects(
    startCapability(manifest, { dir, grantedPermissions: [] }),
    (error: unknown) => error instanceof CapabilityStartError && /timed out/.test(error.message),
  );
});

test("startCapability enforces the granted permission allowlist", async (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, "server.js"), JSON_SERVER);
  const manifest = parseCapabilityManifest({
    id: "test/net",
    version: "0.1.0",
    kind: "process",
    entrypoint: "server.js",
    permissions: ["net"],
  });
  await assert.rejects(
    startCapability(manifest, { dir, grantedPermissions: ["fs.read"] }),
    (error: unknown) =>
      error instanceof CapabilityPermissionError && error.missing.includes("net"),
  );
});

test("a missing entrypoint and a non-executable entrypoint both fail fast", async (t) => {
  const dir = tempDir(t);
  const missing = parseCapabilityManifest({
    id: "test/missing",
    version: "0.1.0",
    kind: "process",
    entrypoint: "missing.js",
  });
  await assert.rejects(
    startCapability(missing, { dir, grantedPermissions: [] }),
    (error: unknown) => error instanceof CapabilityStartError && /not found/.test(error.message),
  );

  writeFileSync(join(dir, "server.sh"), "#!/bin/sh\necho hi\n");
  const notExecutable = parseCapabilityManifest({
    id: "test/bad-exec",
    version: "0.1.0",
    kind: "process",
    entrypoint: "server.sh",
    limits: { timeoutMs: 500 },
  });
  await assert.rejects(
    startCapability(notExecutable, { dir, grantedPermissions: [] }),
    (error: unknown) =>
      error instanceof CapabilityStartError && /capability process error|EACCES/.test(error.message),
  );
});

test("python capabilities register without spawning and route to the python primitive", async () => {
  const manifest = parseCapabilityManifest({
    id: "builtin/python",
    version: "0.1.0",
    kind: "python",
    entrypoint: "seed_runtime.python_tool",
  });
  const handle = await startCapability(manifest, { dir: "/nonexistent" });
  assert.equal(handle.pid, null);
  assert.equal(handle.hello, null);
  await assert.rejects(handle.request("anything"), CapabilityStartError);
  await stopCapability(handle);
});

test("reloadCapabilitySet is session-safe and swaps only changed capabilities", async (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, "server.js"), JSON_SERVER);
  const manifest = processManifest();
  const discovered: DiscoveredCapability = { id: manifest.id, version: manifest.version, dir, manifest };
  const handle = await startCapability(manifest, { dir, grantedPermissions: [] });
  t.after(async () => {
    await handle.stop();
  });

  await assert.rejects(
    reloadCapabilitySet([handle], [discovered], { activeSessions: 1 }),
    CapabilityReloadError,
  );

  const python = parseCapabilityManifest({
    id: "builtin/python",
    version: "0.1.0",
    kind: "python",
    entrypoint: "seed_runtime.python_tool",
  });
  const result = await reloadCapabilitySet([handle], [discovered, { id: python.id, version: python.version, dir, manifest: python }], {
    activeSessions: 0,
  });
  assert.deepEqual(result.kept, ["test/echo@0.1.0"]);
  assert.deepEqual(result.started, ["builtin/python@0.1.0"]);
  assert.deepEqual(result.stopped, []);
  const startedPython = result.handles.find((candidate) => candidate.manifest.id === "builtin/python");
  assert.ok(startedPython);
  await stopCapability(startedPython);
});
