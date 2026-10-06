// errors.test.ts — the failure-domain taxonomy.
//
// A misclassified error points an operator at the wrong subsystem, so the
// ordering rules are contractual: a message that names a specific boundary
// must never fall through to a generic transport pattern.

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyError, describeError } from "./errors.ts";

test("a guardian socket failure is a guardian error, not a provider outage", () => {
  const error = classifyError(
    new Error("connect ECONNREFUSED /Users/x/.seed/run/guardian.sock"),
  );
  assert.equal(error.domain, "guardian", "the named boundary wins over the generic transport pattern");
  assert.equal(error.retryable, true);
  assert.ok(error.hint?.includes("seed-guardian"), "the hint says what to do");
});

test("a guardian protocol mismatch is classified as guardian", () => {
  assert.equal(classifyError(new Error("guardian.hello returned a non-object result (protocol mismatch)")).domain, "guardian");
});

test("a missing model key is a non-retryable provider error with a fix", () => {
  const error = classifyError(
    new Error("model call needs OPENROUTER_API_KEY (budget: credentials, limit: key present, requested: missing)"),
  );
  assert.equal(error.domain, "provider");
  assert.equal(error.retryable, false);
  assert.ok(error.hint?.includes("OPENROUTER_API_KEY"));
});

test("schema, config, oracle, probation, and filesystem failures keep their own domains", () => {
  assert.equal(classifyError(new Error("schema_version 2 != supported 1")).domain, "schema");
  assert.equal(classifyError(new Error("parse /Users/x/.seed/config.toml: bad key")).domain, "config");
  assert.equal(classifyError(new Error("oracle failed after repair (exit 1)")).domain, "oracle");
  assert.equal(classifyError(new Error("probation strike 2 of 2")).domain, "probation");
  assert.equal(classifyError(new Error("ENOENT: no such file or directory, open '/tmp/x'")).domain, "filesystem");
});

test("an unrecognised failure is unknown, never silently attributed", () => {
  const error = classifyError(new Error("something entirely novel happened"));
  assert.equal(error.domain, "unknown");
  assert.equal(error.retryable, false);
});

test("classification never throws on a non-Error value", () => {
  assert.equal(classifyError("plain string").domain, "unknown");
  assert.equal(classifyError(undefined).domain, "unknown");
  assert.equal(classifyError({ weird: true }).domain, "unknown");
});

test("describeError states retryability in one line", () => {
  const described = describeError(classifyError(new Error("ENOENT: no such file")));
  assert.ok(described.startsWith("filesystem error (not retryable)"));
});
