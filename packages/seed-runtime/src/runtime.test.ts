/**
 * runtime.test.ts — python primitive, sessions, ephemeral, host, router, telemetry.
 */
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runPython, resolveToolCwd } from "./python-tool.ts";
import { helloShape, GuardianClient } from "./guardian-client.ts";
import { createSession, openSession, resumeSession } from "./session.ts";
import { createEphemeralStore, hashArgs } from "./ephemeral.ts";
import { selectVisibleTools, selectTools } from "./tool-router.ts";
import { createTaskTelemetry, recordToolCall, finishTask, toEvent } from "./telemetry.ts";
import { startCapabilityHost } from "./capability-host.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "seed-rt-"));
}

test("python tool reads and writes files in the workspace", async () => {
  const ws = tempDir();
  try {
    await runPython({ code: "open('hello.txt', 'w').write('hi')", workspace: ws });
    const read = await runPython({ code: "print(open('hello.txt').read())", workspace: ws });
    assert.equal(read.stdout.trim(), "hi");
    assert.equal(read.exit_code, 0);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("python tool sees SEED_SCRATCH/SEED_SESSION_ID/SEED_WORKSPACE", async () => {
  const ws = tempDir();
  try {
    const out = await runPython({
      code: "import os; print(os.environ['SEED_WORKSPACE']); print(os.environ['SEED_SESSION_ID']); print(os.environ['SEED_SCRATCH'])",
      workspace: ws,
      sessionId: "sess-env",
      scratchDir: "/tmp/seed-scratch-env",
    });
    assert.ok(out.stdout.includes(ws));
    assert.ok(out.stdout.includes("sess-env"));
    assert.ok(out.stdout.includes("/tmp/seed-scratch-env"));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("python tool runs git status in a scratch repo", async () => {
  const ws = tempDir();
  try {
    const out = await runPython({ code: "import subprocess; print(subprocess.run(['git','init','-q'],capture_output=True,text=True).returncode); print(subprocess.run(['git','status','--short'],capture_output=True,text=True).returncode)", workspace: ws });
    assert.equal(out.stdout.trim().split("\n").at(-1), "0");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("python timeout fires with null exit code", async () => {
  const out = await runPython({ code: "import time; time.sleep(30)", workspace: tmpdir(), timeout_ms: 500 });
  assert.equal(out.timed_out, true);
  assert.equal(out.exit_code, null);
});

test("large stdout is middle-truncated with head and tail", async () => {
  const out = await runPython({ code: "for i in range(20000): print(f'row-{i:05d}-' + 'z'*50)", workspace: tmpdir() });
  assert.equal(out.stdout_truncated, true);
  assert.ok(out.stdout.includes("row-00000"));
  assert.ok(out.stdout.includes("truncated"));
  assert.ok(out.stdout.includes("row-19999"));
});

test("cwd escape is rejected with budget+limit+requested", () => {
  assert.throws(() => resolveToolCwd("..", "/tmp/ws"), /budget.*limit.*requested/);
  assert.throws(() => resolveToolCwd("../../etc", "/tmp/ws"), /budget/);
});

test("hello shape validates protocol/champion/telemetry/capability/session", () => {
  const hello = helloShape({ protocol_version: 1, champion_sha: "abc", telemetry_schema_version: 1, capability_schema_version: 1, session_id: "sess-1" });
  assert.equal(hello.protocol_version, 1);
  assert.equal(hello.champion_sha, "abc");
  assert.equal(hello.session_id, "sess-1");
  assert.throws(() => helloShape({ protocol_version: 2, champion_sha: "abc", telemetry_schema_version: 1, capability_schema_version: 1, session_id: "s" }), /protocol mismatch/);
  assert.throws(() => helloShape({ protocol_version: 1 }), /protocol mismatch/);
  assert.throws(() => helloShape(null), /protocol mismatch/);
});

test("guardian client refuses guardian-only methods without a socket", async () => {
  const fake = { write: () => true } as unknown as Socket;
  const client = new GuardianClient(fake);
  await assert.rejects(
    // @ts-expect-error testing client-side refusal of a forbidden method
    client.call("champion.set", {}),
    /refusing guardian-only method/,
  );
  client.close();
});

test("session create/open/resume pins the champion sha", () => {
  const root = tempDir();
  try {
    const created = createSession({ championRef: "sha-aaa", scratchRoot: root });
    assert.ok(created.scratchDir.includes(created.id));
    const opened = openSession(created.id, root);
    assert.equal(opened.championRef, "sha-aaa");
    assert.equal(resumeSession(created.id, "sha-aaa", root).id, created.id);
    assert.throws(() => resumeSession(created.id, "sha-bbb", root), /no silent switch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ephemeral create/exec tracked with args-hash/status/elapsed", () => {
  const root = tempDir();
  try {
    const store = createEphemeralStore(join(root, "scratch"));
    store.create("probe", "print(1)", "probe tool");
    const argsHash = hashArgs({ q: 1 });
    const meta = store.recordExecution("probe", { argsHash, status: "succeeded", elapsedMs: 12 });
    assert.equal(meta.executions.length, 1);
    assert.equal(meta.lastArgsHash, argsHash);
    assert.equal(meta.status, "succeeded");
    assert.equal(meta.totalElapsedMs, 12);
    assert.ok(store.list().some((entry) => entry.id === "probe"));
    assert.equal(store.read("probe").code, "print(1)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("router pins python and never exceeds the cap", () => {
  const cards = [
    { id: "python", name: "python", description: "run python", capability: "builtin/python", languages: ["python"] as string[] },
    { id: "extra", name: "extra", description: "unvetted tool", capability: "x/y", languages: [] as string[] },
  ];
  const selected = selectVisibleTools("run python code", cards, 8);
  assert.ok(selected.some((tool) => tool.id === "python"));
  assert.ok(!selected.some((tool) => tool.id === "extra"));
  assert.ok(selected.length <= 8);
  assert.deepEqual(selectTools({ task: "t", cards: [], maxVisibleTools: 8 }), []);
});

test("telemetry defaults oracleAccuracy null and tracks tool calls", () => {
  const task = createTaskTelemetry({ taskId: "task-1", session: "sess-1", championRef: "sha" });
  assert.equal(task.oracleAccuracy, null);
  assert.equal(task.status, "running");
  recordToolCall(task, {
    tool: "python", session: "sess-1", taskId: "task-1", ok: true,
    elapsedMs: 5, outputBytes: 10, truncated: false, evidence: "observed",
    timestamp: new Date().toISOString(),
  });
  finishTask(task, "done");
  const event = toEvent(task, "task.result");
  assert.equal(event.session, "sess-1");
  assert.equal(task.toolCalls.length, 1);
});

test("capability host runs the echo fixture over JSONL", async () => {
  const host = startCapabilityHost({
    command: "python3",
    args: ["capabilities/fixtures/echo/server.py"],
    cwd: process.cwd(),
    defaultTimeoutMs: 5000,
  });
  try {
    assert.deepEqual(await host.invoke({ method: "echo", params: { hello: "world" } }), { hello: "world" });
    await assert.rejects(host.invoke({ method: "nope", params: null }), /unknown method/);
  } finally {
    host.stop();
  }
});

test("ephemeral tool executes through the python primitive", async () => {
  const root = tempDir();
  try {
    const store = createEphemeralStore(join(root, "scratch"));
    mkdirSync(join(root, "ws"), { recursive: true });
    writeFileSync(join(root, "ws", "input.txt"), "7");
    store.create("doubler", "print(int(open('input.txt').read()) * 2)");
    const { code } = store.read("doubler");
    const out = await runPython({ code, workspace: join(root, "ws") });
    store.recordExecution("doubler", { argsHash: hashArgs({}), status: out.exit_code === 0 ? "succeeded" : "failed", elapsedMs: out.elapsed_ms });
    assert.equal(out.stdout.trim(), "14");
    assert.equal(store.list()[0]?.status, "succeeded");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
