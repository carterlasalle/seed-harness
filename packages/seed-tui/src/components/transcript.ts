// components/transcript.ts — the scrollable record of a session.
//
// Purpose: hold semantic cards (user turn, assistant text, tool call,
// thinking, error, notice) and update a card in place when its state changes.
// Why it exists: terminal logging prints a second and third copy of a tool
// call as it runs; a card that mutates is the difference between an
// interactive app and a log file.
// Responsibilities: append cards, patch a card by id, and render them within
// the viewport width.
// Invariants: render(width) never emits a line wider than width; updating an
// unknown card id appends instead of throwing; tool cards keep their identity
// so a running card becomes a finished card without duplicating.
// Public types/functions: Card, CardKind, Transcript.

import { Markdown, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Component, MarkdownTheme } from "@earendil-works/pi-tui";
import type { Styler } from "../theme/theme.ts";
import type { SeedError } from "../errors.ts";

/**
 * Markdown theme bound to the Seed palette. Assistant prose is real
 * markdown: paragraphs, headings, lists, links, and fenced code.
 */
// trace:v1 id=impl.tui-markdown-theme work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function markdownTheme(style: Styler): MarkdownTheme {
  return {
    heading: (t) => style("accent", t, { bold: true }),
    link: (t) => style("accent", t, { underline: true }),
    linkUrl: (t) => style("dim", t),
    code: (t) => style("thinking", t),
    codeBlock: (t) => style("text", t),
    codeBlockBorder: (t) => style("border", t),
    quote: (t) => style("dim", t, { italic: true }),
    quoteBorder: (t) => style("border", t),
    hr: (t) => style("border", t),
    listBullet: (t) => style("accent", t),
    bold: (t) => style("text", t, { bold: true }),
    italic: (t) => style("text", t, { italic: true }),
    strikethrough: (t) => style("dim", t),
    underline: (t) => style("text", t, { underline: true }),
  };
}

// trace:v1 id=impl.tui-card-kind work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export type CardKind = "user" | "assistant" | "tool" | "thinking" | "error" | "notice";

// trace:exempt reason=internal-detail
export interface Card {
  id: string;
  kind: CardKind;
  /** Primary line: prompt, tool name, notice text. */
  title: string;
  /** Body lines (already split); may be empty. */
  body: string[];
  /** Tool/assistant state. */
  state?: "running" | "ok" | "error";
  durationMs?: number;
  /** One-line summary shown when the card is collapsed. */
  summary?: string;
  collapsed?: boolean;
  error?: SeedError;
}

/** Render one card. Pure: same card + width + style → same lines. */
// trace:v1 id=impl.tui-render-card work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function renderCard(
  card: Card,
  width: number,
  style: Styler,
  expanded = true,
  renderAssistant?: (text: string, width: number) => string[],
): string[] {
  const out: string[] = [];
  const border = style("border", "─".repeat(Math.max(0, Math.min(width, 60))));
  // trace:exempt reason=internal-detail
  if (card.kind === "user") {
    out.push(`${style("accent", "You")}`);
    for (const line of wrap(card.title, width)) out.push(style("text", line));
    return out;
  }
  // trace:exempt reason=internal-detail
  if (card.kind === "notice") {
    for (const line of wrap(card.title, width)) out.push(style("dim", line));
    return out;
  }
  // trace:exempt reason=internal-detail
  if (card.kind === "error" && card.error) {
    const e = card.error;
    out.push(border);
    out.push(`${style("error", "✕")} ${style("error", `${e.domain} error`)} ${style("dim", e.retryable ? "· retryable" : "")}`);
    for (const line of wrap(e.message.split("\n")[0] ?? "", width)) out.push(style("text", line));
    if (e.hint) for (const line of wrap(e.hint, width)) out.push(style("warn", line));
    // trace:exempt reason=internal-detail
    if (expanded && e.detail) {
      // trace:exempt reason=internal-detail
      for (const line of e.detail.split("\n").slice(0, 12)) {
        out.push(style("dim", truncateToWidth(line, width, "")));
      }
    }
    out.push(border);
    return out;
  }
  // trace:exempt reason=internal-detail
  if (card.kind === "thinking") {
    const label = style("thinking", "◆ thinking");
    for (const line of wrap(card.title, width)) out.push(`${label} ${style("dim", line)}`);
    return out;
  }
  // trace:exempt reason=internal-detail
  if (card.kind === "tool") {
    const glyph = card.state === "ok" ? style("ok", "✓") : card.state === "error" ? style("error", "✕") : style("dim", "…");
    const duration = typeof card.durationMs === "number" ? style("dim", `${(card.durationMs / 1000).toFixed(1)}s`) : "";
    const head = `${glyph} ${style("accent", card.title)} ${style("dim", card.summary ?? "")} ${duration}`.trim();
    out.push(truncateToWidth(head, width, ""));
    // trace:exempt reason=internal-detail
    if (expanded && card.body.length > 0) {
      out.push(border);
      for (const line of card.body.slice(0, 20)) out.push(style("dim", truncateToWidth(line, width, "")));
      out.push(border);
    }
    return out;
  }
  // assistant: markdown when a renderer is supplied, plain wrap otherwise.
  const prose = [card.title, ...(expanded ? card.body : [])].join("\n");
  // trace:exempt reason=internal-detail
  if (renderAssistant) {
    out.push(...renderAssistant(prose, width));
    return out;
  }
  for (const line of wrap(card.title, width)) out.push(style("text", line));
  // trace:exempt reason=internal-detail
  if (expanded) {
    for (const line of card.body) out.push(style("text", truncateToWidth(line, width, "")));
  }
  return out;
}

// trace:exempt reason=internal-detail
function wrap(text: string, width: number): string[] {
  if (text.length === 0) return [];
  return wrapTextWithAnsi(text, Math.max(1, width));
}

// trace:v1 id=impl.tui-transcript work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export class Transcript implements Component {
  readonly cards: Card[] = [];
  private style: Styler;
  private expanded = true;
  private counter = 0;
  private markdown: Markdown;
  onDebug?: () => void;

  // trace:exempt reason=internal-detail
  constructor(style: Styler) {
    this.style = style;
    this.markdown = new Markdown("", 0, 0, markdownTheme(style));
  }

  // trace:exempt reason=internal-detail
  setStyle(style: Styler): void {
    this.style = style;
    this.markdown = new Markdown("", 0, 0, markdownTheme(style));
    this.invalidate();
  }

  // trace:exempt reason=internal-detail
  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.invalidate();
  }

  // trace:exempt reason=internal-detail
  isExpanded(): boolean {
    return this.expanded;
  }

  /** Append a card and return its id (used for later in-place updates). */
  // trace:exempt reason=internal-detail
  append(card: Omit<Card, "id"> & { id?: string }): string {
    this.counter += 1;
    const id = card.id ?? `card-${this.counter}`;
    this.cards.push({ ...card, id });
    this.invalidate();
    return id;
  }

  /** Patch a card in place; unknown ids append rather than throw. */
  // trace:exempt reason=internal-detail
  update(id: string, patch: Partial<Omit<Card, "id">>): void {
    // trace:exempt reason=internal-detail
    const index = this.cards.findIndex((c) => c.id === id);
    // trace:exempt reason=internal-detail
    if (index === -1) {
      this.counter += 1;
      this.cards.push({
        id,
        kind: "notice",
        title: "",
        body: [],
        ...patch,
      });
      this.invalidate();
      return;
    }
    this.cards[index] = { ...(this.cards[index] as Card), ...patch };
    this.invalidate();
  }

  // trace:exempt reason=internal-detail
  clear(): void {
    this.cards.length = 0;
    this.invalidate();
  }

  // trace:exempt reason=internal-detail
  invalidate(): void {
    // Stateless render: nothing cached.
  }

  // trace:exempt reason=internal-detail
  render(width: number): string[] {
    const lines: string[] = [];
    // trace:exempt reason=internal-detail
    const assistant = (text: string, w: number): string[] => {
      this.markdown.setText(text);
      return this.markdown.render(w);
    };
    // trace:exempt reason=internal-detail
    for (const card of this.cards) {
      lines.push(...renderCard(card, width, this.style, this.expanded, assistant));
    }
    return lines;
  }
}
