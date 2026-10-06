// registry/index.ts — public surface of the live registry.
//
// Purpose: one import site for the registry vocabulary and implementation.
// Invariant: this module is deliberately free of terminal-UI imports so
// headless callers (the CLI) can populate the registry without loading a
// terminal UI. A pure barrel re-exports symbols traced at their definition,
// so it carries no marker of its own.
// trace:exempt reason=internal-detail

export { SeedRegistry, seedRegistry } from "./registry.ts";
export type { RegistryListener } from "./registry.ts";
export { REGISTRY_DOMAINS } from "./types.ts";
export type {
  CommandContext,
  CommandEntry,
  CapabilityEntry,
  EntrySource,
  KeybindingEntry,
  ModelEntry,
  RegistryDomain,
  RegistryEntryBase,
  RegistryEntryMap,
  RegistryEvent,
  RegistryEventType,
  RendererEntry,
  SettingEntry,
  SettingScope,
  SkillEntry,
  ThemeEntry,
  ToolEntry,
} from "./types.ts";
