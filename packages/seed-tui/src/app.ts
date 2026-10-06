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
  TuiMainScreen,
  matchesKey,
} from "@earendil-works/pi-tui";
import type { Component, OverlayHandle, SlashCommand, Terminal } from "@earendil-works/pi-tui";
import { HeaderBar, StatusBar } from "./components/chrome.ts";
import { Transcript } from "./components/transcript.ts";
import { registerCoreCommands, registerCoreKeybindings } from "./commands/builtin.ts";
import { classifyError } from "./errors.ts";
import {
  buildEvolutionDialog,
  buildModelDialog,
  buildPalette,
  buildRegistryDialog,
  buildSettingsDialog,
  buildSkillsDialog,
  buildToolsDialog,
  dialogFrame,
  selectTheme,
} from "./components/dialogs.ts";
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

// trace:exempt reason=internal-detail
export interface SeedTuiHost {
  registry: SeedRegistry;
  cwd: string;
  /** Optional engine hook. Absent → the composer reports that no engine is attached. */
  runTask?: (prompt: string, emit: (event: TurnEvent) => void) => Promise<{ ok: boolean; summary: string }>;
  /** Called once the UI has stopped, before launchTui resolves. */
  onQuit?: () => void;
  /** Evolution data for the `/evolve` dialog; the host owns these facts. */
  evolution?: () => {
    champion?: string;
    candidates?: { ref: string; note: string }[];
    friction?: string[];
  } | Promise<{
    champion?: string;
    candidates?: { ref: string; note: string }[];
    friction?: string[];
  }>;
  model?: string;
  thinking?: string;
  /**
   * Terminal to drive. Defaults to the real process terminal; tests inject a
   * fake so the whole app can be exercised without a TTY.
   */
  terminal?: Terminal;
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
}

/** Deterministic control surface handed to `onReady`. */
// trace:exempt reason=internal-detail
export interface SeedTuiHandle {
  /** Force a synchronous render. */
  renderNow: () => void;
  /** Resolves once every submitted command/turn has finished. */
  whenIdle: () => Promise<void>;
}

/** Commands as the slash-autocomplete provider wants them. */
// trace:v1 id=impl.tui-slash-commands work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function slashCommands(registry: SeedRegistry): SlashCommand[] {
  return registry.list("command").map((command) => ({
    name: command.name,
    description: command.description,
    ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
  }));
}

// trace:v1 id=impl.tui-launch work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export async function launchTui(host: SeedTuiHost): Promise<number> {
  const { registry } = host;
  let style: Styler = createStyler();
  let activeTheme = "seed";
  const terminal = host.terminal ?? new ProcessTerminal();
  const tui = new TuiMainScreen(terminal);
  const header = new HeaderBar(style);
  const status = new StatusBar(style);
  const transcript = new Transcript(style);
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
  const shutdown = (): void => {
    if (stopped) return;
    stopped = true;
    watcher?.stop();
    unsubscribe();
    removeListener();
    overlay?.hide();
    overlay = null;
    tui.stop();
    host.onQuit?.();
    resolveExit(0);
  };

  // trace:exempt reason=internal-detail
  const openDialog = (name: string, args?: string): void => {
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
      case "evolution":
        // trace:exempt reason=internal-detail
        void (async () => {
          const data = (await host.evolution?.()) ?? {};
          openOverlay("Evolution", buildEvolutionDialog(data, style, closeOverlay), closeOverlay);
        })();
        return;
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
      transcript.append({ kind: "user", title: trimmed, body: [] });
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
      // trace:exempt reason=internal-detail
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
      });
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
  editor.setAutocompleteProvider(
    new CombinedAutocompleteProvider(slashCommands(registry), host.cwd, null),
  );

  // Ctrl+P and the reasoning controls read their keys from the registry, so
  // editing a keybinding entry changes which keys respond.
  removeListener = tui.addInputListener((data: string) => {
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

  tui.addChild(header);
  tui.addChild(scroll);
  tui.addChild(editor);
  tui.addChild(status);
  tui.setFocus(editor);

  transcript.append({
    kind: "notice",
    title: "Seed interactive session — /help for commands, Ctrl+P for the palette, /quit to exit",
    body: [],
  });

  process.once("SIGINT", shutdown);
  tui.start();
  host.onReady?.({ renderNow: () => tui.renderNow(true), whenIdle: () => pending });
  return exited;
}
