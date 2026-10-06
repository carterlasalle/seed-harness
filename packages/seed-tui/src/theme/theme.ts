// theme/theme.ts — Seed's own visual identity.
//
// Purpose: name the palette once, expose it as registry entries, and hand
// components a styler that degrades honestly on low-color terminals.
// Why it exists: themes are registry-backed like everything else, so `/theme`
// and the status bar read the same definitions.
// Responsibilities: theme definitions, registry population, and a styler
// factory bound to the detected terminal color mode.
// Invariants: every color is a parseable CSS-ish hex string; a theme that
// fails to parse never reaches the registry; styling never emits color when
// the terminal reports no capability (the mode decides).
// Public types/functions: SeedTheme, SEED_THEMES, registerThemes, createStyler.

import { getTerminalColorMode, parseColor, styleText } from "@earendil-works/pi-tui";
import type { Color, TerminalColorMode } from "@earendil-works/pi-tui";
import type { SeedRegistry } from "../registry/registry.ts";

// trace:exempt reason=internal-detail
export interface SeedTheme {
  name: string;
  description: string;
  colors: Record<string, string>;
}

/**
 * Seed's palette. Deliberately restrained: the identity is the *information*
 * (champion, guardian, candidate, probation), not decoration.
 */
// trace:exempt reason=const-data
export const SEED_THEMES: readonly SeedTheme[] = [
  {
    name: "seed",
    description: "Default Seed palette",
    colors: {
      accent: "#7aa2f7",
      dim: "#565f89",
      ok: "#9ece6a",
      warn: "#e0af68",
      error: "#f7768e",
      champion: "#9ece6a",
      guardian: "#bb9af7",
      candidate: "#7aa2f7",
      thinking: "#7dcfff",
      text: "#c0caf5",
      border: "#3b4261",
    },
  },
  {
    name: "mono",
    description: "No color — for terminals without color support",
    colors: {
      accent: "#ffffff",
      dim: "#888888",
      ok: "#ffffff",
      warn: "#cccccc",
      error: "#ffffff",
      champion: "#ffffff",
      guardian: "#ffffff",
      candidate: "#ffffff",
      thinking: "#cccccc",
      text: "#ffffff",
      border: "#888888",
    },
  },
] as const;

// trace:v1 id=impl.tui-register-themes work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function registerThemes(registry: SeedRegistry): void {
  // trace:exempt reason=internal-detail
  for (const theme of SEED_THEMES) {
    registry.register("theme", {
      id: theme.name,
      name: theme.name,
      description: theme.description,
      colors: { ...theme.colors },
      source: "builtin",
    });
  }
}

/** Style a string with one palette role. Unknown roles fall back to `text`. */
// trace:exempt reason=internal-detail
export type Styler = (
  role: string,
  text: string,
  attrs?: { bold?: boolean; italic?: boolean; underline?: boolean },
) => string;

/**
 * Build a styler bound to a color mode. Components take a Styler so tests can
 * pass a pass-through implementation and assert on plain text.
 */
// trace:v1 id=impl.tui-create-styler work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function createStyler(
  theme: SeedTheme = SEED_THEMES[0] as SeedTheme,
  mode: TerminalColorMode = getTerminalColorMode(),
): Styler {
  // Parse each palette entry once: styleText runs on every rendered line, and
  // re-parsing hex per call would put color math on the hot path.
  const parsed: Record<string, Color> = {};
  for (const [role, hex] of Object.entries(theme.colors)) parsed[role] = parseColor(hex);
  const fallback = parsed.text ?? parseColor("#ffffff");
  // trace:exempt reason=internal-detail
  return (role, text, attrs) => {
    const fg = parsed[role] ?? fallback;
    return styleText(text, { fg, ...attrs }, mode);
  };
}

/** Identity styler: returns text unchanged. Used by tests and `mono` mode. */
// trace:v1 id=impl.tui-plain-styler work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export const plainStyler: Styler = (_role, text) => text;
