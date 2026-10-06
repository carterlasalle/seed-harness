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
import type { Terminal } from "@earendil-works/pi-tui";
import { SeedRegistry } from "./registry/registry.ts";
import { registerCoreCommands } from "./commands/builtin.ts";
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
