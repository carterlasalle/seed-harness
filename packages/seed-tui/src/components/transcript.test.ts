// components/transcript.test.ts — card rendering, collapse, and mouse.
//
// Mouse is an affordance the objective lists as optional; these tests pin that
// clicking a card toggles it *without* becoming the only way to do anything.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Transcript, renderCard } from "./transcript.ts";
import { plainStyler } from "../theme/theme.ts";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";

// trace:exempt reason=unit-test
function click(y: number): TuiMouseEvent {
  return {
    type: "press",
    button: "left",
    x: 0,
    y,
    screenX: 0,
    screenY: y,
    width: 80,
    height: 40,
    shift: false,
    alt: false,
    ctrl: false,
  };
}

test("a tool card renders collapsed when the card says so", () => {
  const card = { id: "t", kind: "tool" as const, title: "python", body: ["secret output"], state: "ok" as const };
  assert.ok(renderCard(card, 80, plainStyler, true).join("\n").includes("secret output"));
  assert.ok(
    !renderCard({ ...card, collapsed: true }, 80, plainStyler, true).join("\n").includes("secret output"),
    "a collapsed card hides its body",
  );
});

test("clicking a card toggles it, and clicking again restores it", () => {
  const transcript = new Transcript(plainStyler);
  transcript.append({ kind: "tool", title: "python", body: ["line one", "line two"] });
  const rendered = transcript.render(80);
  assert.ok(rendered.join("\n").includes("line one"), "starts expanded");

  // Line 0 is the card's header, so a click there hits that card.
  assert.equal(transcript.handleMouse(click(0))?.handled, true);
  assert.ok(!transcript.render(80).join("\n").includes("line one"), "collapsed after click");

  transcript.handleMouse(click(0));
  assert.ok(transcript.render(80).join("\n").includes("line one"), "expanded again");
});

test("a click below the last card is not handled", () => {
  const transcript = new Transcript(plainStyler);
  transcript.append({ kind: "notice", title: "hello", body: [] });
  transcript.render(80);
  assert.equal(transcript.handleMouse(click(50)), undefined);
});

test("right-click does not toggle a card", () => {
  const transcript = new Transcript(plainStyler);
  transcript.append({ kind: "tool", title: "python", body: ["line one"] });
  transcript.render(80);
  assert.equal(transcript.handleMouse({ ...click(0), button: "right" }), undefined);
  assert.ok(transcript.render(80).join("\n").includes("line one"), "unchanged");
});

test("hiding thinking leaves tool cards alone", () => {
  const transcript = new Transcript(plainStyler);
  transcript.append({ kind: "thinking", title: "deliberation", body: [] });
  transcript.append({ kind: "tool", title: "python", body: ["output"] });
  transcript.setShowThinking(false);
  const out = transcript.render(80).join("\n");
  assert.ok(!out.includes("deliberation"));
  assert.ok(out.includes("output"), "tool bodies are independent of the thinking toggle");
});

test("the observer sees appends and patches, but not a resume replay", () => {
  const transcript = new Transcript(plainStyler);
  const seen: string[] = [];
  transcript.setObserver(({ type, card }) => seen.push(`${type}:${card.id}`));
  transcript.append({ kind: "user", title: "hi", body: [] });
  transcript.update("card-1", { title: "changed" });
  assert.deepEqual(seen, ["append:card-1", "patch:card-1"]);

  transcript.setCards([{ id: "old", kind: "user", title: "from disk", body: [] }]);
  assert.deepEqual(seen, ["append:card-1", "patch:card-1"], "replaying history is not a new mutation");
});

test("an image card renders its caption and its pre-rendered body", () => {
  const card = {
    id: "i",
    kind: "image" as const,
    title: "./shot.png",
    body: ["<rendered>"],
    summary: "12x6 cells",
  };
  const out = renderCard(card, 80, plainStyler).join("\n");
  assert.ok(out.includes("./shot.png"));
  assert.ok(out.includes("<rendered>"));
  assert.ok(out.includes("12x6 cells"));
});