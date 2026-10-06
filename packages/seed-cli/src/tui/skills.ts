// tui/skills.ts — skill discovery across every on-disk skill root.
//
// Purpose: turn the skill directories a Seed checkout actually carries into
// registry entries the `/skills` browser can render, with provenance and
// collision reporting.
// Why it exists: the runtime treats skills as opaque metadata; the interactive
// frontend must show every discovered skill, where it came from, and why it
// lost a name collision.
// Responsibilities: scan the known roots in precedence order, parse SKILL.md
// YAML frontmatter (name/description), mark shadowed duplicates.
// Invariants: read-only; roots are scanned in a fixed precedence order; a
// later root never overrides an earlier one — it is marked `shadowedBy`;
// a skill without a readable SKILL.md is skipped rather than guessed.
// Public types/functions: SKILL_ROOTS, discoverSkills, parseFrontmatter.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SkillEntry } from "@carterlasalle/seed-tui/src/registry/types.ts";

/**
 * Skill roots in precedence order: earlier roots win a name collision.
 * Mirrors the layout this repository ships.
 */
// trace:exempt reason=const-data
export const SKILL_ROOTS: readonly string[] = [
  ".omp/skills",
  ".agents/skills",
  ".claude/skills",
  ".pi/skills",
  ".hermes/skills",
] as const;

/** Parse the leading `---` frontmatter block. Returns {} when absent. */
// trace:v1 id=impl.cli-tui-frontmatter work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function parseFrontmatter(text: string): Record<string, string> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const out: Record<string, string> = {};
  // trace:exempt reason=internal-detail
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1] ?? "";
    let value = (kv[2] ?? "").trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Discover every skill under `root`. Entry id is `<origin>::<name>` so two
 * roots holding the same skill name stay distinguishable in the registry.
 */
// trace:v1 id=impl.cli-tui-skill-discover work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function discoverSkills(root: string): SkillEntry[] {
  const entries: SkillEntry[] = [];
  const winnerByName = new Map<string, string>();
  // trace:exempt reason=internal-detail
  for (const origin of SKILL_ROOTS) {
    const dir = join(root, origin);
    if (!existsSync(dir)) continue;
    let names: string[] = [];
    try {
      names = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    } catch {
      continue;
    }
    // trace:exempt reason=internal-detail
    for (const dirName of names) {
      const skillFile = join(dir, dirName, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      let text = "";
      try {
        text = readFileSync(skillFile, "utf8");
      } catch {
        continue;
      }
      const meta = parseFrontmatter(text);
      const name = meta.name && meta.name.length > 0 ? meta.name : dirName;
      const shadowedBy = winnerByName.get(name);
      if (!shadowedBy) winnerByName.set(name, origin);
      entries.push({
        id: `${origin}::${name}`,
        name,
        description: meta.description ?? "",
        origin,
        enabled: !shadowedBy,
        ...(shadowedBy ? { shadowedBy } : {}),
        source: "file",
      });
    }
  }
  return entries;
}
