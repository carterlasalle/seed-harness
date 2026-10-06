// components/dialogs.ts — overlays that project the registry.
//
// Purpose: every picker/browser reads the live registry, so registering a
// command, model, skill, tool, or setting makes it appear here on the next
// render with no dialog-side list to maintain.
// Why it exists: "registry/UI consistency" is a hard invariant — a dialog that
// hard-codes its own contents is a bug waiting to drift.
// Responsibilities: build SelectList/SettingsList components from registry
// entries, with themes derived from the Seed palette.
// Invariants: dialog contents are computed from `registry.list(domain)` at
// open time; guardian-scope settings render as locked and are never editable;
// an empty domain renders an explicit empty state instead of a blank box.
// Public types/functions: selectTheme, settingsTheme, buildPalette,
// buildModelDialog, buildSettingsDialog, buildSkillsDialog, buildToolsDialog,
// buildRegistryDialog, buildEvolutionDialog.

import { SelectList, SettingsList } from "@earendil-works/pi-tui";
import type {
  Component,
  SelectItem,
  SelectListTheme,
  SettingItem,
  SettingsListTheme,
} from "@earendil-works/pi-tui";
import type { SeedRegistry } from "../registry/registry.ts";
import type { StoredSession } from "../session-store.ts";
import type { Styler } from "../theme/theme.ts";

// trace:v1 id=impl.tui-select-theme work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function selectTheme(style: Styler): SelectListTheme {
  return {
    selectedPrefix: (t) => style("accent", t),
    selectedText: (t) => style("accent", t, { bold: true }),
    description: (t) => style("dim", t),
    scrollInfo: (t) => style("dim", t),
    noMatch: (t) => style("warn", t),
  };
}

// trace:v1 id=impl.tui-settings-theme work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function settingsTheme(style: Styler): SettingsListTheme {
  return {
    label: (t, selected) => (selected ? style("accent", t, { bold: true }) : style("text", t)),
    value: (t, selected) => (selected ? style("accent", t) : style("dim", t)),
    description: (t) => style("dim", t),
    cursor: style("accent", "❯"),
    hint: (t) => style("dim", t),
  };
}

/** Commands → palette items. Same registry the slash menu reads. */
// trace:v1 id=impl.tui-palette-items work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function commandItems(registry: SeedRegistry): SelectItem[] {
  return registry.list("command").map((command) => ({
    value: `/${command.name}`,
    label: `/${command.name}`,
    description: `${command.description}${command.source === "builtin" ? "" : ` · ${command.source}`}`,
  }));
}

// trace:v1 id=impl.tui-build-palette work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function buildPalette(
  registry: SeedRegistry,
  style: Styler,
  onPick: (value: string) => void,
  onCancel: () => void,
): SelectList {
  const items = commandItems(registry);
  const list = new SelectList(
    items.length > 0 ? items : [{ value: "", label: "no commands registered", description: "" }],
    12,
    selectTheme(style),
  );
  list.onSelect = (item) => onPick(item.value);
  list.onCancel = onCancel;
  return list;
}

/** Models → picker items, showing measured profile facts, not just an id. */
// trace:v1 id=impl.tui-model-items work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function modelItems(registry: SeedRegistry): SelectItem[] {
  return registry.list("model").map((model) => {
    const measured =
      model.tasksEvaluated > 0
        ? `${model.tasksEvaluated} tasks · $${model.costPerTask.toFixed(3)}/task · ${model.p50LatencyMs}ms p50`
        : "unmeasured";
    const strengths = model.strengths.length > 0 ? ` · strong: ${model.strengths.slice(0, 3).join("/")}` : "";
    const role = model.role ? `${model.role} role · ` : "";
    return {
      value: model.model,
      label: model.model,
      description: `${role}${model.provider}/${model.family} · ${model.profileStatus} · ${measured}${strengths}`,
    };
  });
}

// trace:v1 id=impl.tui-build-model-dialog work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function buildModelDialog(
  registry: SeedRegistry,
  style: Styler,
  onPick: (model: string) => void,
  onCancel: () => void,
): SelectList {
  const items = modelItems(registry);
  const list = new SelectList(
    items.length > 0 ? items : [{ value: "", label: "no models registered", description: "" }],
    12,
    selectTheme(style),
  );
  list.onSelect = (item) => onPick(item.value);
  list.onCancel = onCancel;
  return list;
}

/** Settings → schema-generated browser. Guardian policy is shown locked. */
// trace:v1 id=impl.tui-build-settings-dialog work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function buildSettingsDialog(
  registry: SeedRegistry,
  style: Styler,
  onChange: (key: string, value: string) => void,
  onCancel: () => void,
): SettingsList {
  const items: SettingItem[] = registry.list("setting").map((setting) => {
    const locked = setting.readOnly === true;
    const value = setting.value === undefined ? "—" : String(setting.value);
    const scope = setting.scope === "guardian" ? "guardian policy 🔒" : setting.scope;
    return {
      id: setting.key,
      label: locked ? `${setting.label} 🔒` : setting.label,
      description: `${setting.description} (${setting.key} · ${scope}${setting.restart ? " · restart" : ""})`,
      currentValue: locked ? `${value} (read-only)` : value,
      ...(setting.values && !locked ? { values: [...setting.values] } : {}),
    };
  });
  return new SettingsList(
    items,
    14,
    settingsTheme(style),
    (id, newValue) => {
      const setting = registry.get("setting", id);
      // Defence in depth: the browser already hides the editor for locked
      // entries, and the write path refuses them again here.
      if (!setting || setting.readOnly) return;
      registry.register("setting", { ...setting, value: newValue });
      onChange(id, newValue);
    },
    onCancel,
    { enableSearch: true },
  );
}

// trace:v1 id=impl.tui-build-skills-dialog work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function buildSkillsDialog(
  registry: SeedRegistry,
  style: Styler,
  onPick: (id: string) => void,
  onCancel: () => void,
): SelectList {
  const skills = registry.list("skill");
  // trace:exempt reason=internal-detail
  const active = skills.filter((s) => s.enabled).length;
  // trace:exempt reason=internal-detail
  const shadowed = skills.filter((s) => s.shadowedBy).length;
  const items: SelectItem[] = skills.map((skill) => ({
    value: skill.id,
    label: `${skill.enabled ? "✓" : "○"} ${skill.name}`,
    description: `${skill.origin}${skill.shadowedBy ? ` · shadowed by ${skill.shadowedBy}` : ""}${skill.description ? ` · ${skill.description.slice(0, 70)}` : ""}`,
  }));
  const header: SelectItem[] = [
    { value: "", label: `${active} active · ${shadowed} shadowed · ${skills.length} discovered`, description: "" },
  ];
  const list = new SelectList([...header, ...items], 14, selectTheme(style));
  list.onSelect = (item) => onPick(item.value);
  list.onCancel = onCancel;
  return list;
}

/** Tools → routing view: installed vs active vs visible, with why. */
// trace:v1 id=impl.tui-tool-items work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function toolItems(registry: SeedRegistry): SelectItem[] {
  return registry.list("tool").map((tool) => {
    const visible = tool.visible === undefined ? "—" : tool.visible ? "✓" : "—";
    const why =
      typeof tool.score === "number" && typeof tool.rank === "number"
        ? ` · score ${tool.score.toFixed(2)} · rank ${tool.rank} · visible limit ${tool.visibleLimit ?? "—"}`
        : "";
    return {
      value: tool.id,
      label: `${tool.name}`,
      description: `installed ✓ · active ${tool.active ? "✓" : "—"} · visible ${visible} · from ${tool.capability}${why}`,
    };
  });
}

// trace:v1 id=impl.tui-build-tools-dialog work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function buildToolsDialog(
  registry: SeedRegistry,
  style: Styler,
  onPick: (id: string) => void,
  onCancel: () => void,
): SelectList {
  const items = toolItems(registry);
  const list = new SelectList(
    items.length > 0 ? items : [{ value: "", label: "no tools registered", description: "" }],
    12,
    selectTheme(style),
  );
  list.onSelect = (item) => onPick(item.value);
  list.onCancel = onCancel;
  return list;
}

/** Registry census — proves at a glance that the UI is a projection. */
// trace:v1 id=impl.tui-build-registry-dialog work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function buildRegistryDialog(
  registry: SeedRegistry,
  style: Styler,
  onCancel: () => void,
): SelectList {
  const census = registry.census();
  const items: SelectItem[] = census.map(({ domain, count }) => ({
    value: domain,
    label: `${domain}`,
    description: `${count} registered`,
  }));
  items.unshift({
    value: "__revision__",
    label: `revision ${registry.revision}`,
    description: "increments once per published registry event",
  });
  const list = new SelectList(items, 14, selectTheme(style));
  list.onSelect = () => {
    /* informational only */
  };
  list.onCancel = onCancel;
  return list;
}

/** Sessions → resume picker, indented by resume lineage so it reads as a tree. */
// trace:v1 id=impl.tui-build-sessions-dialog work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function buildSessionsDialog(
  entries: readonly { session: StoredSession; depth: number }[],
  style: Styler,
  onPick: (id: string) => void,
  onCancel: () => void,
): SelectList {
  const items: SelectItem[] = entries.map(({ session, depth }) => {
    const when = session.at.replace("T", " ").slice(0, 16);
    const indent = depth > 0 ? `${"  ".repeat(depth)}↳ ` : "";
    const first = session.prompt ? session.prompt.slice(0, 56) : "(no prompt)";
    return {
      value: session.id,
      label: `${indent}${when}`,
      description: `${first} · ${session.cards.length} cards${session.model ? ` · ${session.model}` : ""}`,
    };
  });
  const list = new SelectList(
    items.length > 0 ? items : [{ value: "", label: "no saved sessions", description: "" }],
    14,
    selectTheme(style),
  );
  list.onSelect = (item) => onPick(item.value);
  list.onCancel = onCancel;
  return list;
}

/** Evolution view. Data comes from the host; absent data renders as "—". */
// trace:v1 id=impl.tui-build-evolution-dialog work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function buildEvolutionDialog(
  data: {
    champion?: string;
    /** Champion history, newest last — the lineage the guardian holds. */
    lineage?: { ref: string; reason: string }[];
    /** Candidates the guardian recorded, newest first. */
    candidates?: { id: string; ref: string; parent: string; status: string }[];
    /** Pareto archive members the guardian retained. */
    archive?: { ref: string; novelty: number; tags: string[] }[];
    /** Queued experiment prompts: the candidate pipeline as the CLI sees it. */
    queued?: string[];
    /** Recorded eval results, newest last. */
    evals?: { id: string; passed: number; total: number }[];
    friction?: string[];
  },
  style: Styler,
  onCancel: () => void,
): SelectList {
  const items: SelectItem[] = [
    { value: "champion", label: `champion ${data.champion ?? "—"}`, description: "current deployed reference" },
  ];
  // trace:exempt reason=internal-detail
  for (const entry of data.lineage ?? []) {
    items.push({ value: `lineage:${entry.ref}`, label: `  ↳ ${entry.ref}`, description: entry.reason || "no reason recorded" });
  }
  // trace:exempt reason=internal-detail
  for (const candidate of data.candidates ?? []) {
    // A promoted candidate is the champion; mark it so the list reads as a
    // lineage rather than an undifferentiated pile.
    const mark = candidate.ref === data.champion ? "●" : "↑";
    const parent = candidate.parent ? ` · from ${candidate.parent}` : "";
    items.push({
      value: `candidate:${candidate.id}`,
      label: `${mark} ${candidate.ref}`,
      description: `${candidate.status}${parent}`,
    });
  }
  // trace:exempt reason=internal-detail
  for (const member of data.archive ?? []) {
    const tags = member.tags.length > 0 ? ` · ${member.tags.join("/")}` : "";
    items.push({
      value: `archive:${member.ref}`,
      label: `◆ ${member.ref}`,
      description: `archived · novelty ${member.novelty.toFixed(2)}${tags}`,
    });
  }
  // trace:exempt reason=internal-detail
  for (const task of data.queued ?? []) {
    items.push({ value: `queued:${task}`, label: "↑ queued", description: task.slice(0, 90) });
  }
  // trace:exempt reason=internal-detail
  for (const result of data.evals ?? []) {
    const rate = result.total > 0 ? Math.round((result.passed / result.total) * 100) : 0;
    items.push({
      value: `eval:${result.id}`,
      label: `eval ${result.id}`,
      description: `${result.passed}/${result.total} passed (${rate}%)`,
    });
  }
  // trace:exempt reason=internal-detail
  for (const line of data.friction ?? []) {
    items.push({ value: `friction:${line}`, label: "friction", description: line });
  }
  const list = new SelectList(items, 16, selectTheme(style));
  list.onCancel = onCancel;
  return list;
}

/** Wrap a SelectList/SettingsList in a titled frame component. */
// trace:v1 id=impl.tui-dialog-frame work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function dialogFrame(title: string, inner: Component, style: Styler): Component {
  return {
    invalidate: () => inner.invalidate(),
    handleInput: (data: string) => inner.handleInput?.(data),
    handleMouse: inner.handleMouse?.bind(inner),
    render: (width: number): string[] => {
      const border = style("border", "─".repeat(Math.max(0, width)));
      return [border, style("accent", title), ...inner.render(width), border];
    },
  };
}
