// components/chrome.ts — the two persistent rows of the Seed interface.
//
// Purpose: render the state that must always be visible — champion, guardian
// reachability, model, thinking effort, context use (header) and candidate,
// queue, probation, spend (status).
// Why it exists: Seed's identity is "a coding organism whose harness can
// evolve while a guardian evaluates it"; those facts belong on screen, not
// behind a command.
// Responsibilities: lay out and truncate two rows against the viewport width.
// Invariants: render(width) returns lines no wider than width; a missing value
// renders as an explicit placeholder ("—") rather than a fabricated number;
// both components re-read the registry revision so a mutation repaints.
// Public types/functions: SeedStatusModel, HeaderBar, StatusBar.

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { Styler } from "../theme/theme.ts";

/** Live facts the host keeps current. Absent fields render as "—". */
// trace:exempt reason=internal-detail
export interface SeedStatusModel {
  champion?: string;
  guardian?: "reachable" | "offline" | "unknown";
  model?: string;
  thinking?: string;
  contextPercent?: number;
  candidate?: string;
  queueDepth?: number;
  probation?: string;
  costUsd?: number;
  /** Registry revision last painted — proves the UI follows the registry. */
  revision?: number;
}

// trace:exempt reason=internal-detail
function cell(label: string, value: string, style: Styler): string {
  return `${style("dim", label)} ${style("text", value)}`;
}

/** Join cells with a separator, then truncate to the viewport. */
// trace:exempt reason=internal-detail
function row(cells: string[], style: Styler, width: number): string {
  const separator = style("border", "   ");
  return truncateToWidth(cells.join(separator), Math.max(0, width), "");
}

// trace:v1 id=impl.tui-header-bar work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export class HeaderBar implements Component {
  private status: SeedStatusModel = {};
  private style: Styler;
  onDebug?: () => void;

  // trace:exempt reason=internal-detail
  constructor(style: Styler) {
    this.style = style;
  }

  // trace:exempt reason=internal-detail
  setStyle(style: Styler): void {
    this.style = style;
    this.invalidate();
  }

  // trace:exempt reason=internal-detail
  update(status: SeedStatusModel): void {
    this.status = { ...this.status, ...status };
    this.invalidate();
  }

  // trace:exempt reason=internal-detail
  invalidate(): void {
    // Stateless render: nothing cached.
  }

  // trace:exempt reason=internal-detail
  render(width: number): string[] {
    const s = this.style;
    const guardian = this.status.guardian ?? "unknown";
    const guardianGlyph = guardian === "reachable" ? "●" : guardian === "offline" ? "○" : "◌";
    const guardianRole = guardian === "reachable" ? "guardian" : guardian === "offline" ? "error" : "dim";
    const context =
      typeof this.status.contextPercent === "number" ? `${this.status.contextPercent.toFixed(0)}%` : "—";
    const top = row(
      [
        cell("champion", this.status.champion ?? "—", s),
        `${s(guardianRole, guardianGlyph)} ${s("dim", "guardian")}`,
        cell("model", this.status.model ?? "—", s),
        cell("thinking", this.status.thinking ?? "—", s),
        cell("context", context, s),
      ],
      s,
      width,
    );
    const title = "SEED";
    const pad = Math.max(0, Math.floor((width - title.length) / 2));
    const banner = s("accent", `${" ".repeat(pad)}${title}`);
    const divider = s("border", "─".repeat(Math.max(0, width)));
    return [banner, top, divider];
  }
}

// trace:v1 id=impl.tui-status-bar work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export class StatusBar implements Component {
  private status: SeedStatusModel = {};
  private style: Styler;
  onDebug?: () => void;

  // trace:exempt reason=internal-detail
  constructor(style: Styler) {
    this.style = style;
  }

  // trace:exempt reason=internal-detail
  setStyle(style: Styler): void {
    this.style = style;
    this.invalidate();
  }

  // trace:exempt reason=internal-detail
  update(status: SeedStatusModel): void {
    this.status = { ...this.status, ...status };
    this.invalidate();
  }

  // trace:exempt reason=internal-detail
  invalidate(): void {
    // Stateless render: nothing cached.
  }

  // trace:exempt reason=internal-detail
  render(width: number): string[] {
    const s = this.style;
    const probation = this.status.probation;
    const probationRole =
      probation === "stable" ? "ok" : probation === "at-risk" ? "warn" : probation ? "error" : "dim";
    const cost = typeof this.status.costUsd === "number" ? `$${this.status.costUsd.toFixed(2)}` : "—";
    const revision = typeof this.status.revision === "number" ? `r${this.status.revision}` : "—";
    const bar = row(
      [
        `${s("dim", "candidate")} ${s("candidate", this.status.candidate ?? "—")}`,
        cell("queue", String(this.status.queueDepth ?? 0), s),
        `${s("dim", "probation")} ${s(probationRole, probation ?? "—")}`,
        cell("spend", cost, s),
        `${s("dim", "registry")} ${visibleWidth(revision) > 0 ? s("border", revision) : "—"}`,
      ],
      s,
      width,
    );
    return [bar];
  }
}
