// tui/settings-schema.ts — the one definition of every tunable Seed setting.
//
// Purpose: declare each setting once, with metadata, so the CLI, the TUI
// `/settings` browser, and validation all derive from the same source instead
// of maintaining a parser + a UI + docs by hand.
// Why it exists: the interactive frontend must not hard-code a settings page;
// it renders whatever this schema registers.
// Responsibilities: mirror the guardian config keys (spec section 103) plus
// session/display settings the frontend owns.
// Invariants:
//   * keys are exactly the config.toml names the guardian accepts;
//   * guardian-policy settings are readOnly — the evolvable organism must not
//     move its own grading criteria through a UI;
//   * every entry declares type/default/group/scope so the UI never guesses.
// Public types/functions: SETTINGS_SCHEMA, SETTING_GROUPS, guardianScopeKeys.

import type { SettingScope } from "@carterlasalle/seed-tui/src/registry/types.ts";

// trace:exempt reason=internal-detail
export interface SettingDefinition {
  key: string;
  type: "number" | "boolean" | "string" | "enum";
  default: unknown;
  group: string;
  label: string;
  description: string;
  scope: SettingScope;
  restart: boolean;
  min?: number;
  max?: number;
  values?: string[];
  readOnly?: boolean;
}

/** `capabilities.visibleToolLimit` → `{ section: "capabilities", key: "visible_tool_limit" }`. */
// trace:v1 id=impl.cli-tui-toml-path work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function tomlPath(settingKey: string): { section: string; key: string } | null {
  const [section, rest] = settingKey.split(".");
  if (!section || !rest) return null;
  // trace:exempt reason=internal-detail
  const snake = rest.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
  return { section, key: snake };
}

/**
 * Whether a setting lives in `~/.seed/config.toml`. Session and display
 * settings are frontend-owned; every other scope mirrors a guardian config
 * key, so the rule is derived rather than annotated per entry.
 */
// trace:v1 id=impl.cli-tui-setting-persisted work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function isPersisted(def: SettingDefinition): boolean {
  return def.scope !== "session" && def.scope !== "display";
}

/** Display order for the settings browser. Guardian policy sorts last. */
// trace:exempt reason=internal-detail
export const SETTING_GROUPS: readonly string[] = [
  "Session",
  "Display",
  "Capabilities",
  "Evolution",
  "Incubator",
  "Guardian policy",
] as const;

// trace:exempt reason=const-data
export const SETTINGS_SCHEMA: readonly SettingDefinition[] = [
  {
    key: "session.model",
    type: "string",
    default: "anthropic/claude-sonnet-4",
    group: "Session",
    label: "Task model",
    description: "Model id used for foreground task turns (SEED_MODEL overrides at launch).",
    scope: "session",
    restart: false,
  },
  {
    key: "session.maxTurns",
    type: "number",
    default: 12,
    min: 1,
    max: 24,
    group: "Session",
    label: "Max agent turns",
    description: "Upper bound on model turns for one task before the loop stops.",
    scope: "session",
    restart: false,
  },
  {
    key: "session.thinking",
    type: "enum",
    default: "medium",
    values: ["off", "low", "medium", "high"],
    group: "Session",
    label: "Reasoning effort",
    description: "Requested reasoning effort; ignored when the selected model does not reason.",
    scope: "session",
    restart: false,
  },
  {
    key: "session.showThinking",
    type: "boolean",
    default: true,
    group: "Session",
    label: "Show thinking",
    description: "Render provider-visible reasoning blocks in the transcript.",
    scope: "session",
    restart: false,
  },
  {
    key: "display.theme",
    type: "string",
    default: "seed",
    group: "Display",
    label: "Theme",
    description: "Active theme name from the theme registry.",
    scope: "display",
    restart: false,
  },
  {
    key: "display.compactTools",
    type: "boolean",
    default: false,
    group: "Display",
    label: "Compact tool cards",
    description: "Collapse tool cards to a one-line summary after they finish.",
    scope: "display",
    restart: false,
  },
  {
    key: "capabilities.visibleToolLimit",
    type: "number",
    default: 8,
    min: 1,
    max: 32,
    group: "Capabilities",
    label: "Visible tool limit",
    description: "Maximum capabilities the router exposes to one task turn.",
    scope: "capabilities",
    restart: false,
  },
  {
    key: "capabilities.autoCrystallize",
    type: "boolean",
    default: true,
    group: "Capabilities",
    label: "Auto-crystallize",
    description: "Propose durable capabilities from repeated ephemeral helpers.",
    scope: "capabilities",
    restart: false,
  },
  {
    key: "evolution.enabled",
    type: "boolean",
    default: true,
    group: "Evolution",
    label: "Evolution enabled",
    description: "Allow the lab to run experiments outside the foreground path.",
    scope: "capabilities",
    restart: false,
  },
  {
    key: "evolution.autoRunIdle",
    type: "boolean",
    default: true,
    group: "Evolution",
    label: "Auto-run when idle",
    description: "Start queued experiments only when no foreground task is active.",
    scope: "capabilities",
    restart: false,
  },
  {
    key: "foreground.inlineHarnessImprovementSeconds",
    type: "number",
    default: 30,
    min: 0,
    max: 300,
    group: "Evolution",
    label: "Inline improvement budget (s)",
    description: "Per-task ceiling on inline harness improvement work.",
    scope: "capabilities",
    restart: false,
  },
  {
    key: "incubator.rollingBudgetRatio",
    type: "number",
    default: 0.1,
    min: 0,
    max: 1,
    group: "Incubator",
    label: "Rolling budget ratio",
    description: "Share of spend reserved for the incubator.",
    scope: "guardian",
    restart: false,
    readOnly: true,
  },
  {
    key: "incubator.dailyCostLimitUsd",
    type: "number",
    default: 10,
    min: 0,
    group: "Incubator",
    label: "Daily cost limit (USD)",
    description: "Hard daily spend ceiling for lab work.",
    scope: "guardian",
    restart: false,
    readOnly: true,
  },
  {
    key: "promotion.qualityNoninferiority",
    type: "number",
    default: 0.01,
    min: 0,
    max: 1,
    group: "Guardian policy",
    label: "Quality non-inferiority",
    description: "Allowed quality drop before a candidate is rejected.",
    scope: "guardian",
    restart: true,
    readOnly: true,
  },
  {
    key: "promotion.criticalQualityNoninferiority",
    type: "number",
    default: 0.005,
    min: 0,
    max: 1,
    group: "Guardian policy",
    label: "Critical non-inferiority",
    description: "Stricter tolerance applied to critical evaluation categories.",
    scope: "guardian",
    restart: true,
    readOnly: true,
  },
  {
    key: "promotion.probationTasks",
    type: "number",
    default: 10,
    min: 1,
    group: "Guardian policy",
    label: "Probation tasks",
    description: "Tasks a promoted champion must pass before probation clears.",
    scope: "guardian",
    restart: true,
    readOnly: true,
  },
  {
    key: "sandbox.defaultNetwork",
    type: "boolean",
    default: false,
    group: "Guardian policy",
    label: "Sandbox network",
    description: "Network access inside candidate evaluation sandboxes.",
    scope: "guardian",
    restart: true,
    readOnly: true,
  },
];

/** Keys the organism must not mutate through the UI. */
// trace:v1 id=impl.cli-tui-settings-guardian-keys work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function guardianScopeKeys(): string[] {
  return SETTINGS_SCHEMA.filter((s) => s.scope === "guardian").map((s) => s.key);
}
