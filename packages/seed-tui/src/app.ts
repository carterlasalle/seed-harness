// app.ts — the interactive Seed session.
//
// Purpose: one presentation layer over the same engine — header, transcript,
// composer, status bar — where every menu and command is a projection of the
// live registry.
// Why it exists: `seed` on a TTY should be a product, while `seed run`,
// `--json`, and CI stay headless. This module is the only place a terminal UI
// is constructed; the engine never imports it.
// Responsibilities: build the pi-tui tree, wire registry events to repaints,
// dispatch composer input to registry commands, and run task turns through the
// host callback.
// Invariants:
//   * a registry mutation repaints on the next frame (no restart, no cache);
//   * the slash menu and Ctrl+P palette both read `registry.list("command")`;
//   * every failure renders through the error taxonomy, never a bare throw;
//   * stopping the app restores the terminal and resolves the exit code.
// Public types/functions: TurnEvent, SeedTuiHost, launchTui.

import {
  CombinedAutocompleteProvider,
  Editor,
  ProcessTerminal,
  ScrollView,
  TuiAltScreen,
  TuiMainScreen,
  VStack,
  getImageDimensions,
  isViewportTUI,
  matchesKey,
  renderImage,
} from "@earendil-works/pi-tui";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import type { Component, OverlayHandle, SlashCommand, Terminal } from "@earendil-works/pi-tui";
import { HeaderBar, StatusBar } from "./components/chrome.ts";
import { BOOT_FRAME_MS, BootScreen } from "./components/boot.ts";
import { Transcript } from "./components/transcript.ts";
import type { Card } from "./components/transcript.ts";
import { registerCoreCommands, registerCoreKeybindings } from "./commands/builtin.ts";
import { classifyError } from "./errors.ts";
import {
  buildEvolutionDialog,
  buildModelDialog,
  buildPalette,
  buildRegistryDialog,
  buildSessionsDialog,
  buildSettingsDialog,
  buildSkillsDialog,
  buildToolsDialog,
  dialogFrame,
  selectTheme,
} from "./components/dialogs.ts";
import { createSessionStore, sessionTree } from "./session-store.ts";
import type { SeedRegistry } from "./registry/registry.ts";
import { watchRegistry } from "./registry/watch.ts";
import type { WatchSource } from "./registry/watch.ts";
import type { CommandContext } from "./registry/types.ts";
import { createStyler } from "./theme/theme.ts";
import type { Styler } from "./theme/theme.ts";

/** Events a host emits while running one task turn. */
// trace:v1 id=impl.tui-turn-event work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export type TurnEvent =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; name: string; detail?: string }
  | { kind: "tool-done"; name: string; ok: boolean; durationMs?: number }
  | { kind: "error"; error: unknown };

/** What the `/evolve` dialog renders. Every field is host-supplied fact. */
// trace:exempt reason=internal-detail
export interface EvolutionData {
  champion?: string;
  lineage?: { ref: string; reason: string }[];
  candidates?: { id: string; ref: string; parent: string; status: string }[];
  archive?: { ref: string; novelty: number; tags: string[] }[];
  queued?: string[];
  evals?: { id: string; passed: number; total: number }[];
  friction?: string[];
}

// trace:exempt reason=internal-detail
export interface SeedTuiHost {
  registry: SeedRegistry;
  cwd: string;
  /**
   * Optional engine hook. `sessionId` is the displayed session the prompt was
   * submitted in (stable across prompts until /new or /sessions resume), or
   * null when persistence is off — so the engine can keep one model-facing
   * session per displayed session instead of starting over every prompt.
   */
  runTask?: (prompt: string, emit: (event: TurnEvent) => void, sessionId: string | null) => Promise<{ ok: boolean; summary: string }>;
  /** Called once the UI has stopped, before launchTui resolves. */
  onQuit?: () => void;
  /** Evolution data for the `/evolve` dialog; the host owns these facts. */
  evolution?: () => EvolutionData | Promise<EvolutionData>;
  /**
   * Directory for saved sessions. When set, the transcript is persisted and
   * `/sessions` can resume one; when absent the app keeps nothing on disk.
   */
  sessionDir?: string;
  model?: string;
  thinking?: string;
  /**
   * Terminal to drive. Defaults to the real process terminal; tests inject a
   * fake so the whole app can be exercised without a TTY.
   */
  terminal?: Terminal;
  /**
   * Play the startup animation. Off by default: it is driven by wall-clock
   * frames, so headless and test hosts must opt out to stay deterministic.
   */
  animate?: boolean;
  /**
   * Called once the app is live. Gives callers deterministic control over
   * frames and completion, so tests never wait on wall-clock time.
   */
  onReady?: (handle: SeedTuiHandle) => void;
  /**
   * Filesystem-backed domains to keep live. The host supplies the discovery
   * functions so there is exactly one discovery path per domain.
   */
  watchSources?: readonly WatchSource[];
  /** Debounce window for watch refreshes, in ms. */
  watchDebounceMs?: number;
  /**
   * Enable mouse reporting. Off by default: mouse is an affordance, not a
   * requirement, and enabling it switches to the alternate screen, which
   * trades terminal scrollback for a clickable viewport.
   */
  mouse?: boolean;
}

/** Deterministic control surface handed to `onReady`. */
// trace:exempt reason=internal-detail
export interface SeedTuiHandle {
  /** Force a synchronous render. */
  renderNow: () => void;
  /** Resolves once every submitted command/turn has finished. */
  whenIdle: () => Promise<void>;
}

/** Mime types the inline image path understands. */
// trace:exempt reason=const-data
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Commands as the slash-autocomplete provider wants them. */
// trace:v1 id=impl.tui-slash-commands work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function slashCommands(registry: SeedRegistry): SlashCommand[] {
  return registry.list("command").map((command) => ({
    name: command.name,
    description: command.description,
    ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
  }));
}

/**
 * The URL to hand the platform opener for a clicked link, or null when it must
 * not be opened. Only http(s) qualifies: prompt drift and tool output can carry
 * any scheme, and `open` on macOS will happily hand `file://` and app-scheme
 * URLs to whatever claims them. Exported so the rule is testable without
 * launching anything.
 */
// trace:v1 id=impl.tui-link-target work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function linkTarget(url: string): string | null {
  // trace:exempt reason=internal-detail
  let scheme: string;
  try {
    scheme = new URL(url).protocol;
  } catch {
    return null;
  }
  return scheme === "http:" || scheme === "https:" ? url : null;
}

/** Open a clicked link through the platform opener. Fire-and-forget: a link that fails must not disturb the session. */
// trace:v1 id=impl.tui-open-url work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
function openExternal(url: string): void {
  // trace:exempt reason=internal-detail
  const target = linkTarget(url);
  if (target === null) return;
  // trace:exempt reason=internal-detail
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  // trace:exempt reason=internal-detail
  const args = process.platform === "win32" ? ["/c", "start", "", target] : [target];
  // trace:exempt reason=internal-detail
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
}

// trace:v1 id=impl.tui-launch work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export async function launchTui(host: SeedTuiHost): Promise<number> {
  const { registry } = host;
  let style: Styler = createStyler();
  let activeTheme = "seed";
  const terminal = host.terminal ?? new ProcessTerminal();
  // Mouse reporting only exists on the alternate screen, so it is opt-in:
  // the default keeps the terminal's own scrollback, which matters more than
  // clicking for most sessions. Transcript search is part of the same bundle —
  // it lives in the alternate screen — so this branch decides both.
  const tui =
    host.mouse === true
      ? new TuiAltScreen(terminal, undefined, undefined, {
          mouse: true,
          // Links already render as OSC 8; without this a click does nothing.
          openUrl: openExternal,
          // Shown while a follow-end view is scrolled away from its end.
          scrollToEndIndicator: () => style("dim", "↓ end"),
        })
      : new TuiMainScreen(terminal);
  const header = new HeaderBar(style);
  const status = new StatusBar(style);
  const transcript = new Transcript(style);
  // Session persistence is optional: with no sessionDir the app keeps nothing
  // on disk, which is what tests and throwaway runs want.
  const store = host.sessionDir ? createSessionStore(host.sessionDir) : null;
  // A session file is created lazily, on the first *substantive* card. Booting
  // and quitting without doing anything therefore leaves no empty file behind,
  // and resuming continues the resumed session rather than a fresh one.
  let currentSession: string | null = null;
  // Set by /new so the next session records the one it was forked from.
  let pendingParent: string | undefined;
  const SUBSTANTIVE: ReadonlySet<Card["kind"]> = new Set(["user", "assistant", "tool", "error", "image"]);
  // trace:exempt reason=internal-detail
  if (store) {
    transcript.setObserver(({ type, card }) => {
      // trace:exempt reason=internal-detail
      if (!currentSession) {
        if (!SUBSTANTIVE.has(card.kind)) return;
        currentSession = store.create({ parent: pendingParent, cwd: host.cwd, model: host.model });
        pendingParent = undefined;
      }
      if (type === "append") store.append(currentSession, card);
      else store.patch(currentSession, card.id, card);
    });
  }
  const scroll = new ScrollView(transcript, { follow: "end", primary: true, scrollbar: "auto" });
  const editor = new Editor(tui, {
    borderColor: (text: string) => style("border", text),
    selectList: selectTheme(style),
  });

  let overlay: OverlayHandle | null = null;
  let stopped = false;
  // trace:exempt reason=internal-detail
  let removeListener: () => void = () => undefined;
  const { promise: exited, resolve: resolveExit } = Promise.withResolvers<number>();
  // Serializes dispatched work so callers (and tests) can await "everything
  // submitted so far has finished" instead of guessing at a delay.
  let pending: Promise<void> = Promise.resolve();
  // Filesystem-backed domains stay live: drop in a skill or capability and
  // the registry republishes it, so the next frame shows it.
  const watcher =
    host.watchSources && host.watchSources.length > 0
      ? watchRegistry(registry, host.watchSources, { debounceMs: host.watchDebounceMs })
      : null;

  // trace:exempt reason=internal-detail
  const repaint = (): void => {
    tui.requestRender();
  };

  // One subscription: every registry mutation repaints and re-stamps the
  // revision, which is the whole point of a live registry.
  // trace:exempt reason=internal-detail
  const unsubscribe = registry.on(() => {
    status.update({ revision: registry.revision });
    repaint();
  });

  // trace:exempt reason=internal-detail
  const closeOverlay = (): void => {
    overlay?.hide();
    overlay = null;
    tui.setFocus(editor);
    repaint();
  };

  // trace:exempt reason=internal-detail
  const openOverlay = (title: string, inner: Component, onCancel?: () => void): void => {
    const framed = dialogFrame(title, inner, style);
    overlay?.hide();
    overlay = tui.showOverlay(framed, { width: "80%", maxHeight: "70%", anchor: "center" });
    // A cancel inside the dialog closes it; Esc is handled by the list itself.
    // trace:exempt reason=internal-detail
    if (onCancel) {
      // trace:exempt reason=internal-detail
      const original = inner as { onCancel?: () => void };
      original.onCancel = () => {
        onCancel();
        closeOverlay();
      };
    }
    repaint();
  };

  // trace:exempt reason=internal-detail
  const print = (text: string): void => {
    for (const line of text.split("\n")) transcript.append({ kind: "notice", title: line, body: [] });
    repaint();
  };

  // trace:exempt reason=internal-detail
  let stopAutocompleteRefresh: () => void = () => undefined;
  const shutdown = (): void => {
    if (stopped) return;
    stopped = true;
    watcher?.stop();
    unsubscribe();
    stopAutocompleteRefresh();
    removeListener();
    overlay?.hide();
    overlay = null;
    tui.stop();
    host.onQuit?.();
    resolveExit(0);
  };

  // trace:exempt reason=internal-detail
  const openDialog = async (name: string, args?: string): Promise<void> => {
    // trace:exempt reason=internal-detail
    switch (name) {
      case "model":
        openOverlay(
          "Models",
          buildModelDialog(
            registry,
            style,
            (model) => {
              // trace:exempt reason=internal-detail
              if (model) {
                const setting = registry.get("setting", "session.model");
                if (setting) registry.register("setting", { ...setting, value: model });
                header.update({ model });
                print(`model → ${model}`);
              }
              closeOverlay();
            },
            closeOverlay,
          ),
          closeOverlay,
        );
        return;
      case "settings":
        openOverlay(
          "Settings",
          buildSettingsDialog(
            registry,
            style,
            (key, value) => {
              const setting = registry.get("setting", key);
              print(`${key} = ${value}${setting?.restart ? " (takes effect next session)" : ""}`);
            },
            closeOverlay,
          ),
          closeOverlay,
        );
        return;
      case "skills":
        openOverlay(
          "Skills",
          // trace:exempt reason=internal-detail
          buildSkillsDialog(registry, style, (id) => {
            const skill = registry.get("skill", id);
            if (skill) print(`${skill.name} · ${skill.origin} · ${skill.enabled ? "enabled" : `shadowed by ${skill.shadowedBy}`}`);
          }, closeOverlay),
          closeOverlay,
        );
        return;
      case "tools":
        openOverlay("Tools", buildToolsDialog(registry, style, () => undefined, closeOverlay), closeOverlay);
        return;
      case "registry":
        openOverlay("Registry", buildRegistryDialog(registry, style, closeOverlay), closeOverlay);
        return;
      case "sessions": {
        // trace:exempt reason=internal-detail
        if (!store) {
          print("session persistence is off for this run");
          return;
        }
        openOverlay(
          "Sessions",
          buildSessionsDialog(
            sessionTree(store.list()),
            style,
            (id) => {
              const session = id ? store.load(id) : null;
              // trace:exempt reason=internal-detail
              if (session) {
                transcript.setCards(session.cards);
                currentSession = session.id;
                // Resuming continues that session; it is not a fork.
                pendingParent = undefined;
                print(`resumed ${session.id} (${session.cards.length} cards)`);
              }
              closeOverlay();
              repaint();
            },
            closeOverlay,
          ),
          closeOverlay,
        );
        return;
      }
      case "evolution": {
        // Awaiting here is what lets `whenIdle()` reflect that the dialog is
        // ready; a floating promise would render an empty dialog and leave
        // callers unable to observe completion.
        const data = (await host.evolution?.()) ?? {};
        openOverlay("Evolution", buildEvolutionDialog(data, style, closeOverlay), closeOverlay);
        return;
      }
      default:
        print(`no dialog named ${JSON.stringify(name)}${args ? ` (args: ${args})` : ""}`);
    }
  };

  const ctx: CommandContext = {
    args: "",
    quit: shutdown,
    open: (dialog, dialogArgs) => openDialog(dialog, dialogArgs),
    print,
  };

  /** Write a setting through the registry so the UI repaints from the event. */
  // trace:exempt reason=internal-detail
  const setSetting = (key: string, value: unknown): void => {
    const setting = registry.get("setting", key);
    if (!setting || setting.readOnly) return;
    registry.register("setting", { ...setting, value });
  };

  /** Cycle reasoning effort. Meaningless values are still shown as chosen. */
  // trace:exempt reason=internal-detail
  const cycleThinking = (): void => {
    const setting = registry.get("setting", "session.thinking");
    const values = setting?.values ?? ["off", "low", "medium", "high"];
    const current = String(setting?.value ?? "medium");
    const index = values.indexOf(current);
    const next = values[(index + 1) % values.length] ?? "off";
    setSetting("session.thinking", next);
    header.update({ thinking: next });
    print(`thinking → ${next}`);
  };

  // The app owns this display toggle, and mirrors it into the registry when the
  // setting exists. Reading state back from a setting the host may not have
  // registered would make the second press a no-op.
  let thinkingShown = registry.get("setting", "session.showThinking")?.value !== false;
  // trace:exempt reason=internal-detail
  const toggleThinking = (): void => {
    thinkingShown = !thinkingShown;
    setSetting("session.showThinking", thinkingShown);
    transcript.setShowThinking(thinkingShown);
    print(`thinking blocks ${thinkingShown ? "shown" : "hidden"}`);
  };

  /** Switch palette. Themes are registry entries like everything else. */
  // trace:exempt reason=internal-detail
  const applyTheme = (requested: string): void => {
    const themes = registry.list("theme");
    const chosen =
      themes.find((t) => t.name === requested) ??
      (requested.length === 0
        ? themes[(themes.findIndex((t) => t.name === activeTheme) + 1) % Math.max(1, themes.length)]
        : undefined);
    // trace:exempt reason=internal-detail
    if (!chosen) {
      print(`unknown theme ${JSON.stringify(requested)} — available: ${themes.map((t) => t.name).join(", ")}`);
      return;
    }
    activeTheme = chosen.name;
    style = createStyler({ name: chosen.name, description: chosen.description, colors: chosen.colors });
    header.setStyle(style);
    status.setStyle(style);
    transcript.setStyle(style);
    editor.borderColor = (text: string) => style("border", text);
    repaint();
    print(`theme → ${chosen.name}`);
  };

  /**
   * Show an image file inline when the terminal can, and say plainly what it
   * is when it cannot. Images are an affordance: nothing in the session
   * depends on being able to see them.
   */
  // trace:v1 id=impl.tui-show-image work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
  const showImage = (requested: string): void => {
    // trace:exempt reason=internal-detail
    if (requested.length === 0) {
      print("usage: /image <path>");
      return;
    }
    const path = resolve(host.cwd, requested);
    // trace:exempt reason=internal-detail
    if (!existsSync(path)) {
      print(`no such file: ${path}`);
      return;
    }
    // Check the type before reading: there is no point slurping a large
    // non-image file just to reject it.
    const mime = MIME_BY_EXT[extname(path).toLowerCase()];
    // trace:exempt reason=internal-detail
    if (!mime) {
      print(`${path} is not an image (expected ${Object.keys(MIME_BY_EXT).join(", ")})`);
      return;
    }
    let base64 = "";
    try {
      base64 = readFileSync(path).toString("base64");
    } catch (error) {
      print(`could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    const dimensions = getImageDimensions(base64, mime);
    const drawn = dimensions ? renderImage(base64, dimensions, { maxWidthCells: 48, maxHeightCells: 24 }) : null;
    const body: string[] = [];
    let summary: string;
    // trace:exempt reason=internal-detail
    if (drawn) {
      body.push(drawn.sequence);
      summary = `${drawn.columns}x${drawn.rows} cells`;
    } else {
      const size = dimensions ? `${dimensions.widthPx}x${dimensions.heightPx}px · ` : "";
      summary = `${size}${mime} · not rendered inline by this terminal`;
    }
    transcript.append({ kind: "image", title: path.replace(host.cwd, "."), body, summary });
  };

  // The app drives these commands, so it binds the real handlers here rather
  // than relying on whatever a headless builder registered. Re-registering the
  // same ids replaces them, and every replacement publishes an event.
  // trace:exempt reason=internal-detail
  registerCoreCommands(registry, {
    onReload: () => {
      watcher?.flush();
      print("rediscovered capabilities, skills, and models");
    },
    onQuit: shutdown,
    onTheme: (args) => applyTheme(args.trim()),
    onNew: () => {
      // trace:exempt reason=internal-detail
      if (!store) {
        print("session persistence is off for this run");
        return;
      }
      // The next session records the current one as parent, which is what
      // gives /sessions its tree shape. Nothing is written until the first
      // substantive card, so an unused /new leaves no file behind.
      pendingParent = currentSession ?? undefined;
      currentSession = null;
      transcript.setCards([]);
      print(`new session${pendingParent ? ` from ${pendingParent}` : ""}`);
    },
    onImage: (args) => showImage(args.trim()),
  });
  registerCoreKeybindings(registry);

  /** Keybindings are read from the registry, so editing one changes the key. */
  // trace:exempt reason=internal-detail
  const bindingMatches = (data: string, action: string): boolean =>
    registry
      .list("keybinding")
      .filter((binding) => binding.action === action)
      .some((binding) => binding.keys.some((key) => matchesKey(data, key as Parameters<typeof matchesKey>[1])));

  // trace:exempt reason=internal-detail
  const dispatch = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    // trace:exempt reason=internal-detail
    if (trimmed === "/" || trimmed.startsWith("/")) {
      const [rawName, ...rest] = trimmed.slice(1).split(/\s+/);
      const name = rawName ?? "";
      const command = registry.get("command", name);
      // trace:exempt reason=internal-detail
      if (!command) {
        print(`unknown command /${name} — try /help`);
        return;
      }
      // A slash command is an operation, not conversation: it produces its own
      // output and must not enter the transcript as a user turn. Persisting it
      // would also create a session just from opening a dialog such as
      // /sessions, which then shadows the history you meant to pick.
      try {
        await command.handler(rest.join(" "), { ...ctx, args: rest.join(" ") });
      } catch (error) {
        transcript.append({ kind: "error", title: "command failed", body: [], error: classifyError(error) });
      }
      repaint();
      return;
    }
    transcript.append({ kind: "user", title: trimmed, body: [] });
    // trace:exempt reason=internal-detail
    if (!host.runTask) {
      transcript.append({
        kind: "notice",
        title: "no engine attached — this session has no task runner (start via `seed`)",
        body: [],
      });
      repaint();
      return;
    }
    let toolCard: string | null = null;
    let toolStartedAt = 0;
    try {
      // The user card above already ran through the persistence observer, so
      // currentSession is set for stored sessions and null otherwise. Passing
      // it lets the engine keep one model-facing session per displayed one.
      const result = await host.runTask(trimmed, (event) => {
        if (event.kind === "text") transcript.append({ kind: "assistant", title: event.text, body: [] });
        else if (event.kind === "thinking") transcript.append({ kind: "thinking", title: event.text, body: [] });
        else if (event.kind === "tool") {
          toolStartedAt = Date.now();
          toolCard = transcript.append({ kind: "tool", title: event.name, body: [], state: "running", summary: event.detail ?? "" });
        } else if (event.kind === "tool-done") {
          // trace:exempt reason=internal-detail
          if (toolCard) {
            transcript.update(toolCard, {
              state: event.ok ? "ok" : "error",
              durationMs: event.durationMs ?? Date.now() - toolStartedAt,
            });
          }
        } else if (event.kind === "error") {
          transcript.append({ kind: "error", title: "turn failed", body: [], error: classifyError(event.error) });
        }
        repaint();
      }, currentSession);
      transcript.append({ kind: "notice", title: result.ok ? `done: ${result.summary}` : `failed: ${result.summary}`, body: [] });
    } catch (error) {
      transcript.append({ kind: "error", title: "turn failed", body: [], error: classifyError(error) });
    }
    repaint();
  };

  editor.onSubmit = (text: string) => {
    editor.addToHistory(text);
    pending = pending.then(() => dispatch(text));
  };
  // The provider snapshots the command list at construction, so rebuild it
  // whenever the command domain changes. Otherwise a newly registered
  // command appears in /help and the palette but not in slash completion.
  // trace:v1 id=impl.tui-autocomplete-refresh work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
  const refreshAutocomplete = (): void => {
    editor.setAutocompleteProvider(
      new CombinedAutocompleteProvider(slashCommands(registry), host.cwd, null),
    );
  };
  refreshAutocomplete();
  stopAutocompleteRefresh = registry.on((event) => {
    if (event.domain === "command") refreshAutocomplete();
  });
  // The startup animation, when the host asked for it. It owns the screen for
  // about a second, then hands off to the session layout. Frames are driven by
  // the host (not the component) so tests get the same code path without a clock.
  // trace:exempt reason=internal-detail
  let boot: BootScreen | null = host.animate === true ? new BootScreen(style) : null;
  // trace:exempt reason=internal-detail
  let bootTimer: ReturnType<typeof setInterval> | null = null;
  // trace:exempt reason=internal-detail
  const mountSession = (): void => {
    // trace:exempt reason=internal-detail
    if (isViewportTUI(tui)) {
      // The alternate screen renders one layout root rather than a child list.
      tui.setLayoutRoot(new VStack([header, scroll, editor, status]));
    } else {
      tui.addChild(header);
      tui.addChild(scroll);
      tui.addChild(editor);
      tui.addChild(status);
    }
    tui.setFocus(editor);
  };
  // trace:exempt reason=internal-detail
  const endBoot = (): void => {
    if (bootTimer !== null) {
      clearInterval(bootTimer);
      bootTimer = null;
    }
    if (boot === null) return;
    const finished = boot;
    boot = null;
    // The alternate screen swaps its single root; the main screen must drop
    // the boot child explicitly.
    if (!isViewportTUI(tui)) tui.removeChild(finished);
    mountSession();
    tui.requestRender(true);
  };

  // Ctrl+P and the reasoning controls read their keys from the registry, so
  // editing a keybinding entry changes which keys respond.
  removeListener = tui.addInputListener((data: string) => {
    // Any key during the boot ends it rather than being swallowed: nobody
    // should have to wait out an animation to type.
    if (boot !== null) {
      endBoot();
      return undefined;
    }
    // trace:exempt reason=internal-detail
    if (bindingMatches(data, "seed.palette")) {
      openOverlay(
        "Commands",
        // trace:exempt reason=internal-detail
        buildPalette(registry, style, (value) => {
          closeOverlay();
          if (value) void dispatch(value);
        }, closeOverlay),
        closeOverlay,
      );
      return { consume: true };
    }
    // trace:exempt reason=internal-detail
    if (bindingMatches(data, "seed.thinking.cycle")) {
      cycleThinking();
      return { consume: true };
    }
    // trace:exempt reason=internal-detail
    if (bindingMatches(data, "seed.thinking.toggle")) {
      toggleThinking();
      return { consume: true };
    }
    return undefined;
  });

  header.update({
    model: host.model ?? process.env.SEED_MODEL ?? "—",
    thinking: host.thinking ?? "—",
    guardian: "unknown",
  });
  status.update({ revision: registry.revision, queueDepth: 0 });

  // trace:exempt reason=internal-detail
  if (boot !== null) {
    if (isViewportTUI(tui)) tui.setLayoutRoot(boot);
    else tui.addChild(boot);
  } else {
    mountSession();
  }

  transcript.append({
    kind: "notice",
    title: "Seed interactive session — /help for commands, Ctrl+P for the palette, /quit to exit",
    body: [],
  });

  process.once("SIGINT", shutdown);
  tui.start();
  if (boot !== null) {
    bootTimer = setInterval(() => {
      if (boot === null) return;
      if (!boot.advance()) endBoot();
      else tui.requestRender(true);
    }, BOOT_FRAME_MS);
    // An animation must never be the reason the process stays alive; the
    // session itself decides when to exit.
    (bootTimer as { unref?: () => void }).unref?.();
  }
  host.onReady?.({ renderNow: () => tui.renderNow(true), whenIdle: () => pending });
  return exited;
}
