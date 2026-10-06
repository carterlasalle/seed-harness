// registry/types.ts — the live registry's vocabulary.
//
// Purpose: one registry every surface reads from, so the UI can never drift
// from the runtime. Why it exists: the hard invariant of the interactive
// frontend is "registry/UI consistency" — if something is registered it is
// visible on the next render, and if it is visible it came from the registry.
// Responsibilities: domain names, entry shapes, and the event payload.
// Invariants: every mutation emits exactly one event carrying a strictly
// increasing revision; ids are unique per domain; entries are immutable
// snapshots (mutations replace, never mutate in place).
// Public types: RegistryDomain, RegistryEventType, RegistryEvent,
// RegistryEntryBase, CommandEntry, SettingEntry, ModelEntry, SkillEntry,
// ToolEntry, CapabilityEntry, RendererEntry, ThemeEntry, KeybindingEntry,
// CommandContext.

// trace:v1 id=impl.tui-registry-types work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export type RegistryDomain =
  | "command"
  | "setting"
  | "model"
  | "skill"
  | "tool"
  | "capability"
  | "renderer"
  | "keybinding"
  | "theme";

// trace:exempt reason=internal-detail
export const REGISTRY_DOMAINS: readonly RegistryDomain[] = [
  "command",
  "setting",
  "model",
  "skill",
  "tool",
  "capability",
  "renderer",
  "keybinding",
  "theme",
] as const;

// trace:exempt reason=internal-detail
export type RegistryEventType = "added" | "updated" | "removed" | "reset";

/** Every mutation publishes one of these; `revision` strictly increases. */
// trace:exempt reason=internal-detail
export interface RegistryEvent {
  type: RegistryEventType;
  domain: RegistryDomain;
  id: string;
  revision: number;
}

// trace:exempt reason=internal-detail
export interface RegistryEntryBase {
  id: string;
}

/** Where an entry came from — shown in the UI so provenance is never a guess. */
// trace:exempt reason=internal-detail
export type EntrySource = "builtin" | "extension" | "file" | "guardian" | "profile";

// trace:exempt reason=internal-detail
export interface CommandEntry extends RegistryEntryBase {
  /** Slash name without the leading slash, e.g. "model". */
  name: string;
  description: string;
  argumentHint?: string;
  source: EntrySource;
  handler: (args: string, ctx: CommandContext) => void | Promise<void>;
}

/** Runtime context handed to a command handler. */
// trace:exempt reason=internal-detail
export interface CommandContext {
  /** The raw argument string after the command name. */
  args: string;
  /** Close the interactive app (no-op in headless mode). */
  quit: () => void;
  /** Open a named dialog, if the presentation layer supports it. */
  open: (dialog: string, args?: string) => void;
  /** Print a line into the transcript. */
  print: (text: string) => void;
}

// trace:exempt reason=internal-detail
export type SettingScope = "session" | "model" | "display" | "capabilities" | "guardian";

// trace:exempt reason=internal-detail
export interface SettingEntry extends RegistryEntryBase {
  /** Dotted key, e.g. "capabilities.visibleToolLimit". */
  key: string;
  type: "number" | "boolean" | "string" | "enum";
  default: unknown;
  value: unknown;
  group: string;
  label: string;
  description: string;
  scope: SettingScope;
  /** True when changing it needs a new session (or daemon restart). */
  restart: boolean;
  min?: number;
  max?: number;
  values?: string[];
  /** Guardian policy values the organism must not move through the UI. */
  readOnly?: boolean;
  source: EntrySource;
}

// trace:exempt reason=internal-detail
export interface ModelEntry extends RegistryEntryBase {
  /** Provider-qualified model id used on the wire, e.g. "anthropic/claude-sonnet-4". */
  model: string;
  provider: string;
  family: string;
  profileStatus: "unknown" | "provisional" | "validated";
  capabilities: Record<string, number>;
  strengths: string[];
  weaknesses: string[];
  costPerTask: number;
  p50LatencyMs: number;
  tasksEvaluated: number;
  /** Which lab role currently selects it, when any. */
  role?: string;
  source: EntrySource;
}

// trace:exempt reason=internal-detail
export interface SkillEntry extends RegistryEntryBase {
  name: string;
  description: string;
  /** Discovery root that produced it, e.g. ".omp/skills". */
  origin: string;
  enabled: boolean;
  /** Set when another skill with the same name won precedence. */
  shadowedBy?: string;
  source: EntrySource;
}

// trace:exempt reason=internal-detail
export interface ToolEntry extends RegistryEntryBase {
  name: string;
  description: string;
  /** Capability package that provides it. */
  capability: string;
  /** Whether the router may surface it to a task turn. */
  active: boolean;
  /** Router visibility for the most recent selection, when known. */
  visible?: boolean;
  /** Router score/rank diagnostics for the most recent selection. */
  score?: number;
  rank?: number;
  visibleLimit?: number;
  source: EntrySource;
}

// trace:exempt reason=internal-detail
export interface CapabilityEntry extends RegistryEntryBase {
  name: string;
  version: string;
  kind: string;
  description: string;
  dir: string;
  permissions: string[];
  tools: string[];
  source: EntrySource;
}

/** A renderer claims a transcript card shape so raw JSON never leaks. */
// trace:exempt reason=internal-detail
export interface RendererEntry extends RegistryEntryBase {
  /** Tool or card name this renderer claims. */
  for: string;
  /** Human summary for the card header. */
  summary: string;
  source: EntrySource;
}

// trace:exempt reason=internal-detail
export interface ThemeEntry extends RegistryEntryBase {
  name: string;
  description: string;
  colors: Record<string, string>;
  source: EntrySource;
}

// trace:exempt reason=internal-detail
export interface KeybindingEntry extends RegistryEntryBase {
  /** Action id, e.g. "seed.palette". */
  action: string;
  keys: string[];
  description: string;
  source: EntrySource;
}

/** Domain → entry type map, so `list("model")` is typed. */
// trace:exempt reason=internal-detail
export interface RegistryEntryMap {
  command: CommandEntry;
  setting: SettingEntry;
  model: ModelEntry;
  skill: SkillEntry;
  tool: ToolEntry;
  capability: CapabilityEntry;
  renderer: RendererEntry;
  keybinding: KeybindingEntry;
  theme: ThemeEntry;
}
