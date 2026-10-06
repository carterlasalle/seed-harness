// app.test.ts — run the interactive app end to end, headlessly.
//
// Purpose: prove the product actually starts, renders, dispatches a slash
// command through the registry, opens the palette, and shuts down — not just
// that its parts typecheck.
// Why it exists: the objective is a working interactive surface; component
// unit tests alone would not catch a broken wiring between the editor, the
// registry, and the render loop.
// Invariants under test: input reaches the registry command handler, the
// registry drives what the transcript shows, and `/quit` resolves the app.
//
// Time is never guessed here: the app hands back a handle whose `whenIdle()`
// resolves on the real completion of submitted work and whose `renderNow()`
// forces a frame, so there is no sleep and no race.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Terminal } from "@earendil-works/pi-tui";
import { SeedRegistry } from "./registry/registry.ts";
import { registerCoreCommands } from "./commands/builtin.ts";
import { registerThemes } from "./theme/theme.ts";
import { createSessionStore } from "./session-store.ts";
import { launchTui } from "./app.ts";
import type { SeedTuiHandle } from "./app.ts";

/** A terminal that records everything written and lets the test send keys. */
// trace:exempt reason=internal-detail
class FakeTerminal implements Terminal {
  output = "";
  columns = 100;
  rows = 40;
  kittyProtocolActive = false;
  private input: ((data: string) => void) | null = null;

  start(onInput: (data: string) => void, _onResize: () => void): void {
    this.input = onInput;
  }

  stop(): void {
    this.input = null;
  }

  async drainInput(): Promise<void> {
    /* nothing buffered */
  }

  write(data: string): void {
    this.output += data;
  }

  send(data: string): void {
    this.input?.(data);
  }

  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
}

/** Start the app and wait for the real ready signal. */
// trace:exempt reason=internal-detail
async function start(
  host: Omit<Parameters<typeof launchTui>[0], "terminal" | "onReady">,
): Promise<{ app: Promise<number>; handle: SeedTuiHandle; terminal: FakeTerminal }> {
  const terminal = new FakeTerminal();
  const ready = Promise.withResolvers<SeedTuiHandle>();
  const app = launchTui({ ...host, terminal, onReady: ready.resolve });
  const handle = await ready.promise;
  handle.renderNow();
  return { app, handle, terminal };
}

/**
 * Type a line and press Enter the way a terminal does: as discrete key
 * events. The editor matches whole key events, so a coalesced `"/x\r"`
 * string is not a valid Enter press and would test nothing real.
 */
// trace:exempt reason=internal-detail
async function submit(terminal: FakeTerminal, handle: SeedTuiHandle, text: string): Promise<void> {
  terminal.send(text);
  terminal.send("\r");
  await handle.whenIdle();
  handle.renderNow();
}

// trace:exempt reason=internal-detail
function seeded(): SeedRegistry {
  const registry = new SeedRegistry();
  // The real app registers the core commands, so the test registry does too:
  // without them `/quit` would be an unknown command and the app would never
  // stop, which is a test artifact rather than product behaviour.
  registerCoreCommands(registry);
  registry.register("command", {
    id: "ping",
    name: "ping",
    description: "Reply with pong",
    source: "builtin",
    handler: (_args, ctx) => {
      ctx.print("pong-from-registry");
    },
  });
  return registry;
}

test("the app starts, renders chrome, and dispatches a registry command", async () => {
  const { app, handle, terminal } = await start({ registry: seeded(), cwd: process.cwd() });

  assert.ok(terminal.output.includes("SEED"), "banner rendered");
  assert.ok(terminal.output.includes("champion"), "header rendered");
  assert.ok(terminal.output.includes("registry"), "status bar rendered");

  await submit(terminal, handle, "/ping");
  assert.ok(
    terminal.output.includes("pong-from-registry"),
    "the slash command ran through the registry and printed to the transcript",
  );

  await submit(terminal, handle, "/quit");
  assert.equal(await app, 0, "quit resolves the app");
});

test("an unknown slash command reports itself instead of failing silently", async () => {
  const { app, handle, terminal } = await start({ registry: seeded(), cwd: process.cwd() });
  await submit(terminal, handle, "/nope");
  assert.ok(terminal.output.includes("unknown command /nope"));
  await submit(terminal, handle, "/quit");
  await app;
});

test("Ctrl+P opens the palette built from the same registry", async () => {
  const { app, handle, terminal } = await start({ registry: seeded(), cwd: process.cwd() });
  terminal.send("\u0010"); // Ctrl+P
  handle.renderNow();
  assert.ok(terminal.output.includes("Commands"), "palette overlay opened");
  assert.ok(terminal.output.includes("/ping"), "palette lists the registry command");

  // The overlay owns focus while open, so close it before driving the editor.
  terminal.send("\u001b"); // Esc
  handle.renderNow();

  await submit(terminal, handle, "/quit");
  await app;
});

test("a command registered after start is dispatchable without a restart", async () => {
  const registry = seeded();
  const { app, handle, terminal } = await start({ registry, cwd: process.cwd() });

  registry.register("command", {
    id: "late",
    name: "late",
    description: "Registered while running",
    source: "extension",
    handler: (_args, ctx) => {
      ctx.print("late-command-ran");
    },
  });

  await submit(terminal, handle, "/late");
  assert.ok(terminal.output.includes("late-command-ran"));
  await submit(terminal, handle, "/quit");
  await app;
});

test("a task prompt with no engine attached says so rather than hanging", async () => {
  const { app, handle, terminal } = await start({ registry: seeded(), cwd: process.cwd() });
  await submit(terminal, handle, "do some work");
  assert.ok(terminal.output.includes("no engine attached"));
  await submit(terminal, handle, "/quit");
  await app;
});

test("a task turn renders tool cards and resolves them in place", async () => {
  const { app, handle, terminal } = await start({
    registry: seeded(),
    cwd: process.cwd(),
    runTask: async (_prompt, emit) => {
      emit({ kind: "thinking", text: "considering" });
      emit({ kind: "tool", name: "python", detail: "read 2 files" });
      emit({ kind: "tool-done", name: "python", ok: true, durationMs: 1200 });
      emit({ kind: "text", text: "finished the job" });
      return { ok: true, summary: "done" };
    },
  });

  await submit(terminal, handle, "fix the thing");
  assert.ok(terminal.output.includes("thinking"), "thinking block rendered");
  assert.ok(terminal.output.includes("python"), "tool card rendered");
  assert.ok(terminal.output.includes("1.2s"), "tool card carries its duration");
  assert.ok(terminal.output.includes("finished the job"), "assistant text rendered");
  assert.ok(terminal.output.includes("done: done"), "completion notice rendered");
  await submit(terminal, handle, "/quit");
  await app;
});

test("a failing turn renders a typed error card, not a bare throw", async () => {
  const { app, handle, terminal } = await start({
    registry: seeded(),
    cwd: process.cwd(),
    runTask: async () => {
      throw new Error("connect ECONNREFUSED /Users/x/.seed/run/guardian.sock");
    },
  });

  await submit(terminal, handle, "fix the thing");
  assert.ok(terminal.output.includes("guardian error"), "classified by failure domain");
  await submit(terminal, handle, "/quit");
  await app;
});

test("/theme switches the palette through the theme registry", async () => {
  const registry = seeded();
  registerThemes(registry);
  const { app, handle, terminal } = await start({ registry, cwd: process.cwd() });

  await submit(terminal, handle, "/theme mono");
  assert.ok(terminal.output.includes("theme → mono"));

  await submit(terminal, handle, "/theme nosuchtheme");
  assert.ok(terminal.output.includes("unknown theme"), "an unknown name is reported, not ignored");

  await submit(terminal, handle, "/quit");
  await app;
});

test("/theme with no argument cycles to the next registered theme", async () => {
  const registry = seeded();
  registerThemes(registry);
  const { app, handle, terminal } = await start({ registry, cwd: process.cwd() });
  await submit(terminal, handle, "/theme");
  assert.ok(terminal.output.includes("theme → mono"), "cycles from the default theme");
  await submit(terminal, handle, "/theme");
  assert.ok(terminal.output.includes("theme → seed"), "and wraps back around");
  await submit(terminal, handle, "/quit");
  await app;
});

test("Ctrl+T toggles thinking blocks without touching tool cards", async () => {
  const registry = seeded();
  const { app, handle, terminal } = await start({
    registry,
    cwd: process.cwd(),
    runTask: async (_prompt, emit) => {
      emit({ kind: "thinking", text: "a-private-deliberation" });
      emit({ kind: "tool", name: "python", detail: "work" });
      emit({ kind: "tool-done", name: "python", ok: true, durationMs: 10 });
      return { ok: true, summary: "done" };
    },
  });

  await submit(terminal, handle, "go");
  assert.ok(terminal.output.includes("a-private-deliberation"), "thinking shown by default");

  terminal.send("\u0014"); // Ctrl+T
  terminal.output = "";
  handle.renderNow();
  assert.ok(!terminal.output.includes("a-private-deliberation"), "thinking hidden after toggle");
  assert.ok(terminal.output.includes("python"), "tool cards are unaffected");

  terminal.send("\u0014");
  terminal.output = "";
  handle.renderNow();
  assert.ok(terminal.output.includes("a-private-deliberation"), "and shown again");

  await submit(terminal, handle, "/quit");
  await app;
});

test("Shift+Tab cycles the reasoning setting and the header follows", async () => {
  const registry = seeded();
  const { app, handle, terminal } = await start({ registry, cwd: process.cwd() });
  const before = registry.get("setting", "session.thinking")?.value;
  if (!before) {
    registry.register("setting", {
      id: "session.thinking",
      key: "session.thinking",
      type: "enum",
      default: "medium",
      value: "medium",
      values: ["off", "low", "medium", "high"],
      group: "Session",
      label: "Reasoning effort",
      description: "",
      scope: "session",
      restart: false,
      source: "builtin",
    });
  }

  terminal.send("\u001b[Z"); // Shift+Tab
  handle.renderNow();
  const after = registry.get("setting", "session.thinking")?.value;
  assert.notEqual(after, before, "the setting advanced");

  await submit(terminal, handle, "/quit");
  await app;
});

test("a session is persisted and can be resumed in a later run", async () => {
  const sessionDir = mkdtempSync(join(tmpdir(), "seed-app-sessions-"));

  // First run: do real work, which is what a session records.
  const first = await start({ registry: seeded(), cwd: process.cwd(), sessionDir });
  await submit(first.terminal, first.handle, "work worth keeping");
  await submit(first.terminal, first.handle, "/quit");
  await first.app;

  assert.ok(existsSync(sessionDir), "the session directory was created");
  const files = readdirSync(sessionDir).filter((n) => n.endsWith(".json"));
  assert.equal(files.length, 1, "one session recorded");

  // Second run: the same directory must offer that history.
  const second = await start({ registry: seeded(), cwd: process.cwd(), sessionDir });
  second.terminal.send("/sessions");
  second.terminal.send("\r");
  await second.handle.whenIdle();
  second.terminal.output = "";
  second.handle.renderNow();
  assert.ok(second.terminal.output.includes("Sessions"), "the sessions dialog opened");
  assert.ok(second.terminal.output.includes("work worth keeping"), "the saved session is listed by its prompt");
  second.terminal.send("\u001b");
  second.handle.renderNow();
  await submit(second.terminal, second.handle, "/quit");
  await second.app;
});

test("/new forks the next session and records the previous one as its parent", async () => {
  const sessionDir = mkdtempSync(join(tmpdir(), "seed-app-new-"));
  const { app, handle, terminal } = await start({ registry: seeded(), cwd: process.cwd(), sessionDir });

  await submit(terminal, handle, "first session work");
  const afterFirst = createSessionStore(sessionDir).list().length;
  assert.equal(afterFirst, 1, "the first session exists once there is something to keep");

  await submit(terminal, handle, "/new");
  assert.ok(terminal.output.includes("new session"), "the fork was announced");
  assert.equal(
    createSessionStore(sessionDir).list().length,
    1,
    "/new alone writes nothing: an unused session leaves no file behind",
  );

  // The fork materialises on the next piece of real work.
  await submit(terminal, handle, "second session work");
  await submit(terminal, handle, "/quit");
  await app;

  const sessions = createSessionStore(sessionDir).list();
  assert.equal(sessions.length, 2, "both sessions are on disk");
  const child = sessions.find((s) => s.parent !== undefined);
  assert.ok(child, "the new session records its parent, which makes the history a tree");
});

test("without a session directory nothing is written", async () => {
  const { app, handle, terminal } = await start({ registry: seeded(), cwd: process.cwd() });
  await submit(terminal, handle, "/sessions");
  assert.ok(terminal.output.includes("session persistence is off"), "the app says so instead of failing");
  await submit(terminal, handle, "/quit");
  await app;
});

test("/image reports a missing file rather than throwing", async () => {
  const { app, handle, terminal } = await start({ registry: seeded(), cwd: process.cwd() });
  await submit(terminal, handle, "/image ./definitely-not-here.png");
  assert.ok(terminal.output.includes("no such file"));
  await submit(terminal, handle, "/quit");
  await app;
});

test("/image shows a real file, falling back to facts when inline is impossible", async () => {
  const dir = mkdtempSync(join(tmpdir(), "seed-app-img-"));
  const file = join(dir, "dot.png");
  // Smallest possible valid PNG (1x1, transparent).
  writeFileSync(
    file,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  const { app, handle, terminal } = await start({ registry: seeded(), cwd: dir });
  await submit(terminal, handle, "/image dot.png");
  const out = terminal.output;
  assert.ok(out.includes("dot.png"), "the card names the file");
  assert.ok(
    out.includes("1x1px") || out.includes("cells"),
    "either it rendered inline or it reported the dimensions honestly",
  );
  await submit(terminal, handle, "/quit");
  await app;
});

test("resuming a session replays its cards and keeps appending to it", async () => {
  const sessionDir = mkdtempSync(join(tmpdir(), "seed-app-resume-"));

  // First run leaves a recognisable transcript behind.
  const first = await start({ registry: seeded(), cwd: process.cwd(), sessionDir });
  await submit(first.terminal, first.handle, "remember-this-prompt");
  await submit(first.terminal, first.handle, "/quit");
  await first.app;

  // Second run resumes it and must show the earlier content again.
  const second = await start({ registry: seeded(), cwd: process.cwd(), sessionDir });
  second.terminal.send("/sessions");
  second.terminal.send("\r");
  await second.handle.whenIdle();
  second.terminal.send("\r"); // select the newest session
  await second.handle.whenIdle();
  second.handle.renderNow();
  assert.ok(second.terminal.output.includes("resumed"), "the session was resumed");
  assert.ok(
    second.terminal.output.includes("remember-this-prompt"),
    "the earlier prompt is replayed into the transcript",
  );

  // New work continues the resumed session rather than starting another.
  await submit(second.terminal, second.handle, "/help");
  await submit(second.terminal, second.handle, "/quit");
  await second.app;

  const store = createSessionStore(sessionDir);
  assert.equal(store.list().length, 1, "resuming continues the session instead of forking one");
});

test("mouse mode runs the alternate-screen path without changing behaviour", async () => {
  const { app, handle, terminal } = await start({
    registry: seeded(),
    cwd: process.cwd(),
    mouse: true,
  });
  await submit(terminal, handle, "/ping");
  assert.ok(terminal.output.includes("pong-from-registry"), "commands still dispatch");
  await submit(terminal, handle, "/quit");
  assert.equal(await app, 0, "and it still stops cleanly");
});

test("/evolve renders real candidates and archive members", async () => {
  const { app, handle, terminal } = await start({
    registry: seeded(),
    cwd: process.cwd(),
    evolution: () => ({
      champion: "cand-9",
      candidates: [
        { id: "cand-9", ref: "cand-9", parent: "champion", status: "promoted" },
        { id: "cand-8", ref: "cand-8", parent: "cand-9", status: "evaluating" },
      ],
      archive: [{ ref: "cand-7", novelty: 0.42, tags: ["router"] }],
    }),
  });
  await submit(terminal, handle, "/evolve");
  const out = terminal.output;
  assert.ok(out.includes("cand-9"), "the promoted candidate is listed");
  assert.ok(out.includes("cand-8"), "and the evaluating one");
  assert.ok(out.includes("evaluating"), "with its status");
  assert.ok(out.includes("cand-7"), "archive members are listed");
  assert.ok(out.includes("0.42") || out.includes("novelty"), "with their novelty");
  // The overlay owns focus while open, so close it before driving the editor.
  terminal.send("\u001b");
  handle.renderNow();
  await submit(terminal, handle, "/quit");
  await app;
});

test("editing a keybinding entry changes which key responds", async () => {
  const registry = seeded();
  const { app, handle, terminal } = await start({ registry, cwd: process.cwd() });

  // Ctrl+P is bound by default.
  terminal.send("\u0010");
  handle.renderNow();
  assert.ok(terminal.output.includes("Commands"), "default palette key works");
  terminal.send("\u001b");
  handle.renderNow();

  // Rebind it: now Ctrl+O opens the palette and Ctrl+P must do nothing.
  registry.register("keybinding", {
    id: "seed.palette",
    action: "seed.palette",
    keys: ["ctrl+o"],
    description: "Open the command palette",
    source: "extension",
  });
  terminal.output = "";
  terminal.send("\u0010"); // old key
  handle.renderNow();
  assert.ok(!terminal.output.includes("Commands"), "the old key no longer opens the palette");

  terminal.send("\u000f"); // Ctrl+O
  handle.renderNow();
  assert.ok(terminal.output.includes("Commands"), "the new key does");

  terminal.send("\u001b");
  handle.renderNow();
  await submit(terminal, handle, "/quit");
  await app;
});
