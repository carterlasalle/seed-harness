// commands/builtin.ts — interactive commands every Seed surface shares.
//
// Purpose: register the presentation-level slash commands once, so `/`
// autocomplete and the Ctrl+P palette read the same entries.
// Why it exists: two command systems would drift; the registry is the single
// source and both views project it.
// Responsibilities: declare name/description/argument hints and route to the
// host through CommandContext (open a dialog, print a line, quit).
// Invariants: every command here is registered with source "builtin"; none of
// them touch the engine directly — they go through the context the host
// supplies, so headless hosts can no-op safely.
// Public functions: CORE_COMMANDS, registerCoreCommands.

import type { CommandEntry, CommandContext } from "../registry/types.ts";
import type { SeedRegistry } from "../registry/registry.ts";

/** Dialog ids the app knows how to open. */
// trace:exempt reason=internal-detail
export const DIALOGS: readonly string[] = [
  "model",
  "settings",
  "skills",
  "tools",
  "registry",
  "evolution",
] as const;

// trace:exempt reason=internal-detail
interface CommandSpec {
  name: string;
  description: string;
  argumentHint?: string;
  dialog?: string;
}

/**
 * Presentation commands. Engine-backed commands (doctor, evolve, eval,
 * champion) are registered by the CLI, which owns those subsystems.
 */
// trace:exempt reason=const-data
export const CORE_COMMANDS: readonly CommandSpec[] = [
  { name: "help", description: "List every registered command" },
  { name: "model", description: "Switch model or role assignments", dialog: "model" },
  { name: "settings", description: "Browse and edit Seed settings", dialog: "settings" },
  { name: "skills", description: "Browse discovered skills", dialog: "skills" },
  { name: "tools", description: "Inspect capability routing", dialog: "tools" },
  { name: "registry", description: "Inspect everything currently registered", dialog: "registry" },
  { name: "evolution", description: "Champion, candidates, and friction", dialog: "evolution" },
  { name: "reload", description: "Rediscover capabilities, skills, and models" },
  { name: "quit", description: "Leave the interactive session" },
];

/**
 * Register the core commands. `onReload` and `onQuit` are host hooks; both
 * default to no-ops so a headless host can register the same entries.
 */
// trace:v1 id=impl.tui-register-core-commands work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function registerCoreCommands(
  registry: SeedRegistry,
  hooks: { onReload?: (ctx: CommandContext) => void | Promise<void>; onQuit?: (ctx: CommandContext) => void } = {},
): void {
  // trace:exempt reason=internal-detail
  for (const spec of CORE_COMMANDS) {
    const entry: CommandEntry = {
      id: spec.name,
      name: spec.name,
      description: spec.description,
      ...(spec.argumentHint ? { argumentHint: spec.argumentHint } : {}),
      source: "builtin",
      handler: async (args: string, ctx: CommandContext): Promise<void> => {
        // trace:exempt reason=internal-detail
        if (spec.dialog) {
          ctx.open(spec.dialog, args);
          return;
        }
        // trace:exempt reason=internal-detail
        if (spec.name === "reload") {
          await hooks.onReload?.(ctx);
          return;
        }
        // trace:exempt reason=internal-detail
        if (spec.name === "quit") {
          (hooks.onQuit ?? ctx.quit)(ctx);
          return;
        }
        // trace:exempt reason=internal-detail
        if (spec.name === "help") {
          const lines = registry
            .list("command")
            .map((c) => `/${c.name}${c.argumentHint ? ` ${c.argumentHint}` : ""} — ${c.description}`);
          ctx.print(lines.join("\n"));
        }
      },
    };
    registry.register("command", entry);
  }
}
