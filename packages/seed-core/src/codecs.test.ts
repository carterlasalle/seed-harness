/**
 * codecs.test.ts — context codec round trip and strict decode.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CodecError, CONTEXT_CODECS, JSON_CONTEXT_CODEC, RETRIEVAL_CONTEXT_CODEC, SUMMARY_CONTEXT_CODEC } from "./codecs.ts";

test("json codec round-trips a context payload", () => {
  const value = { session: "s1", nested: { tools: ["python", "echo"], count: 3 } };
  const encoded = JSON_CONTEXT_CODEC.encode(value);
  assert.equal(typeof encoded, "string");
  assert.deepEqual(JSON_CONTEXT_CODEC.decode(encoded), value);
});

test("json codec rejects malformed payloads instead of guessing", () => {
  assert.throws(
    () => JSON_CONTEXT_CODEC.decode("{not json"),
    (error: unknown) => error instanceof CodecError && error.name === "CodecError",
  );
});

test("codec set competes: three named codecs round-trip", () => {
  assert.equal(CONTEXT_CODECS.length, 3);
  for (const codec of [SUMMARY_CONTEXT_CODEC, RETRIEVAL_CONTEXT_CODEC]) {
    assert.deepEqual(codec.decode(codec.encode({ a: 1 })), { a: 1 });
  }
});
