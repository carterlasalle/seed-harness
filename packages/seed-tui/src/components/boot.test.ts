// boot.test.ts — the startup animation holds its shape and knows when to stop.
//
// Purpose: prove the invariants that keep the animation from disturbing the
// session. Why it exists: the failure modes here are visual and timing-shaped
// (a jumping layout, a sequence that never ends, a frame that changes width),
// which no other test would catch.
// Invariants under test: every frame has the same line count so the session
// layout does not jump when the boot ends; the wordmark is written
// progressively; advance() reports completion exactly once; render is pure.

import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { BOOT_FRAMES, BootScreen } from "./boot.ts";
import { plainStyler } from "../theme/theme.ts";

test("every frame has the same height, so the session layout never jumps", () => {
  const boot = new BootScreen(plainStyler);
  const heights = new Set<number>();
  for (let i = 0; i < BOOT_FRAMES; i++) {
    heights.add(boot.render(80).length);
    boot.advance();
  }
  assert.equal(heights.size, 1, "one height for the whole sequence");
  assert.equal([...heights][0], 3);
});

test("the wordmark is written one letter at a time and the tagline lands last", () => {
  const boot = new BootScreen(plainStyler);
  const first = boot.render(80).join("\n");
  assert.ok(!first.includes("S"), "frame zero is empty");

  boot.advance();
  assert.ok(boot.render(80)[0].includes("S"), "the first letter appears");
  assert.ok(!boot.render(80)[0].includes("D"), "and not the last one yet");

  const seen: string[] = [];
  for (let i = 0; i < BOOT_FRAMES; i++) {
    seen.push(boot.render(80)[0]);
    boot.advance();
  }
  assert.ok(seen.some((line) => line.includes("D")), "the wordmark completes");
  assert.ok(boot.render(80)[2].includes("guardian"), "the tagline lands");
});

test("advance() reports completion exactly once and then latches", () => {
  const boot = new BootScreen(plainStyler);
  let running = true;
  let ticks = 0;
  while (running) {
    running = boot.advance();
    ticks += 1;
    assert.ok(ticks <= BOOT_FRAMES + 1, "the sequence terminates");
  }
  assert.equal(ticks, BOOT_FRAMES, "it runs the declared number of frames");
  assert.equal(boot.isDone(), true);
  assert.equal(boot.advance(), false, "further advances stay finished");
});

test("render is pure and stays inside the requested width", () => {
  const boot = new BootScreen(plainStyler);
  boot.advance();
  boot.advance();
  const a = boot.render(40);
  const b = boot.render(40);
  assert.deepEqual(a, b, "same frame and width render identically");
  for (const line of a) assert.ok(visibleWidth(line) <= 40, "no line is wider than the terminal");
});

test("a terminal narrower than the tagline does not overflow", () => {
  const boot = new BootScreen(plainStyler);
  for (let i = 0; i < BOOT_FRAMES; i++) {
    for (const line of boot.render(12)) {
      // Visible width, not string length: truncation leaves a zero-width reset.
      assert.ok(visibleWidth(line) <= 12, `line fits: ${JSON.stringify(line)}`);
    }
    boot.advance();
  }
});