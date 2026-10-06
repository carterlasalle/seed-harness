// model-client.test.ts — the chat-completions wire contract.
//
// Reasoning effort is a user-facing control, so what reaches the provider is
// contractual: a model that does not reason must never be sent a meaningless
// parameter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChatRequest, DEFAULT_MODEL } from "./model-client.ts";

// trace:exempt reason=unit-test
const base = { system: "sys", messages: [{ role: "user" as const, content: "hi" }] };

test("a reasoning effort is sent as an effort object", () => {
  const body = buildChatRequest({ ...base, reasoning: "high" });
  assert.deepEqual(body.reasoning, { effort: "high" });
});

test("off and absent send no reasoning field at all", () => {
  assert.equal("reasoning" in buildChatRequest({ ...base, reasoning: "off" }), false);
  assert.equal("reasoning" in buildChatRequest({ ...base }), false);
  assert.equal("reasoning" in buildChatRequest({ ...base, reasoning: "" }), false);
});

test("the request carries the system prompt, the messages, and the python tool", () => {
  const body = buildChatRequest({ ...base, model: "vendor/model" });
  assert.equal(body.model, "vendor/model");
  assert.deepEqual(body.messages, [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
  ]);
  assert.equal(Array.isArray(body.tools), true);
  assert.equal(body.tool_choice, "auto");
});

test("an unset model falls back to the default", () => {
  assert.equal(buildChatRequest(base).model, DEFAULT_MODEL);
});

test("a tool message keeps its tool_call_id", () => {
  const body = buildChatRequest({
    ...base,
    messages: [
      { role: "user", content: "hi" },
      { role: "tool", content: "out", tool_call_id: "call-1" },
    ],
  });
  const messages = body.messages as Array<Record<string, unknown>>;
  assert.equal(messages[2]?.tool_call_id, "call-1");
});