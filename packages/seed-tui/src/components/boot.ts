// components/boot.ts — the startup animation.
//
// Purpose: open a session with the thing Seed actually is — a wordmark that
// writes itself, an underline that draws outward, and the three parts named.
// Why it exists: the interactive frontend is the product, and it previously
// appeared mid-thought with no moment of arrival.
// Responsibilities: render one frame from a frame counter, and report when the
// sequence is over.
// Invariants: render() is pure (same frame + width + style → same lines) and
// always returns the same number of lines, so the layout never jumps while it
// plays; it never blocks (the host drives frames on a timer); it is skipped
// entirely for headless and test hosts.
// Public types/functions: BootScreen, BOOT_FRAMES.

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { Styler } from "../theme/theme.ts";

// trace:exempt reason=const-data
const WORD = ["S", "E", "E", "D"];
// trace:exempt reason=const-data
const TAGLINE = "guardian · organism · lab";
// trace:exempt reason=const-data
const LETTER_FRAMES = WORD.length;
// trace:exempt reason=const-data
const RULE_FRAMES = 4;
// trace:exempt reason=const-data
const TAG_FRAMES = 2;
// trace:exempt reason=const-data
const HOLD_FRAMES = 2;

/** Total frames the sequence plays before handing off to the session. */
// trace:exempt reason:const-data
export const BOOT_FRAMES = LETTER_FRAMES + RULE_FRAMES + TAG_FRAMES + HOLD_FRAMES;

/** Milliseconds per frame — the whole sequence runs a little over a second. */
// trace:exempt reason:const-data
export const BOOT_FRAME_MS = 90;

/** Centre `text` in `width`, never exceeding it — the same invariant the transcript holds. */
// trace:exempt reason=internal-detail
function centre(text: string, width: number): string {
  // trace:exempt reason=internal-detail
  const pad = Math.max(0, Math.floor((width - visibleWidth(text)) / 2));
  // A terminal narrower than the line must clip, not overrun.
  return truncateToWidth(" ".repeat(pad) + text, Math.max(0, width), "");
}

// trace:v1 id=impl.tui-boot-screen work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export class BootScreen implements Component {
  private frame = 0;
  private style: Styler;

  // trace:exempt reason=internal-detail
  constructor(style: Styler) {
    this.style = style;
  }

  /** Advance one frame; returns false once the sequence has finished. */
  // trace:exempt reason=internal-detail
  advance(): boolean {
    if (this.frame >= BOOT_FRAMES) return false;
    this.frame += 1;
    return this.frame < BOOT_FRAMES;
  }

  // trace:exempt reason=internal-detail
  isDone(): boolean {
    return this.frame >= BOOT_FRAMES;
  }

  // trace:exempt reason=internal-detail
  setStyle(style: Styler): void {
    this.style = style;
  }

  // Stateless render: the frame counter is the only state, so there is nothing
  // cached to drop.
  // trace:exempt reason=internal-detail
  invalidate(): void {
    // no-op
  }

  // trace:exempt reason=internal-detail
  render(width: number): string[] {
    const letters = WORD.slice(0, Math.min(this.frame, LETTER_FRAMES));
    const drawn = this.style("accent", letters.join(" "), { bold: true });

    // The rule draws outward over its four frames and then holds its width.
    const ruleMax = Math.max(0, Math.min(18, width - 8));
    const ruleProgress = Math.min(1, Math.max(0, this.frame - LETTER_FRAMES) / RULE_FRAMES);
    const ruleWidth = Math.round(ruleMax * ruleProgress);
    const rule = ruleWidth > 0 ? this.style("dim", "─".repeat(ruleWidth)) : "";

    const tagline =
      this.frame >= LETTER_FRAMES + RULE_FRAMES ? this.style("dim", TAGLINE) : "";

    // Fixed height: the session layout must not jump when the boot ends.
    return [centre(drawn, width), centre(rule, width), centre(tagline, width)];
  }
}