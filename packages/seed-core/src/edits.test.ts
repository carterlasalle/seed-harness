/**
 * edits.test.ts — parse/apply for full-file, unified-diff and search-replace.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { applyEdit, detectEditFormat, EditError, parseEdit } from "./edits.ts";

const original = "line one\nline two\nline three";

test("detectEditFormat classifies the three formats", () => {
  assert.equal(detectEditFormat("--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b"), "unified-diff");
  assert.equal(detectEditFormat("<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE"), "search-replace");
  assert.equal(detectEditFormat("@@line 2 @@\nnew two"), "hashline");
  assert.equal(detectEditFormat("just file content\n"), "full-file");
});

test("hashline replaces one addressed line and rejects out-of-range", () => {
  const operation = parseEdit("@@line 2 @@\nline two changed");
  assert.equal(applyEdit(original, operation), "line one\nline two changed\nline three");
  const bad = parseEdit("@@line 9 @@\nx");
  assert.throws(() => applyEdit(original, bad), (error: unknown) => error instanceof EditError && /beyond/.test(error.message));
});

test("full-file replaces the file and strips a surrounding fence", () => {
  const bare = parseEdit("brand new content\n");
  assert.equal(applyEdit(original, bare), "brand new content\n");
  const fenced = parseEdit("```ts\nexport const x = 1;\n```");
  assert.equal(applyEdit(original, fenced), "export const x = 1;");
});

test("search-replace substitutes exactly-once matches", () => {
  const operation = parseEdit(
    "<<<<<<< SEARCH\nline two\n=======\nline two changed\n>>>>>>> REPLACE",
  );
  assert.equal(applyEdit(original, operation), "line one\nline two changed\nline three");
});

test("search-replace fails on missing or ambiguous matches", () => {
  const missing = parseEdit("<<<<<<< SEARCH\nnot there\n=======\nx\n>>>>>>> REPLACE");
  assert.throws(() => applyEdit(original, missing), (error: unknown) => error instanceof EditError && /not found/.test(error.message));
  const ambiguous = parseEdit("<<<<<<< SEARCH\nline\n=======\nx\n>>>>>>> REPLACE");
  assert.throws(() => applyEdit(original, ambiguous), (error: unknown) => error instanceof EditError && /ambiguous/.test(error.message));
});

test("search-replace rejects malformed payloads", () => {
  assert.throws(() => parseEdit("<<<<<<< SEARCH\nonly search\n"), EditError);
  assert.throws(() => parseEdit("<<<<<<< SEARCH\n\n=======\nx\n>>>>>>> REPLACE"), EditError);
});

test("unified diff applies hunks with context verification", () => {
  const operation = parseEdit("--- a/file.txt\n+++ b/file.txt\n@@ -1,3 +1,3 @@\n line one\n-line two\n+line two changed\n line three");
  assert.equal(applyEdit(original, operation), "line one\nline two changed\nline three");
});

test("unified diff rejects context mismatches and count mismatches", () => {
  const mismatch = parseEdit("--- a/f\n+++ b/f\n@@ -1,1 +1,1 @@\n-not the first line\n+x");
  assert.throws(() => applyEdit(original, mismatch), (error: unknown) => error instanceof EditError && /mismatch/.test(error.message));
  assert.throws(() => parseEdit("--- a/f\n+++ b/f\n@@ -1,5 +1,1 @@\n line one\n"), (error: unknown) => error instanceof EditError && /declares/.test(error.message));
});

test("unified diff rejects hunks that start before earlier hunks finish", () => {
  const overlapping = parseEdit(
    "--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n line one\n-line two\n+two\n@@ -2,1 +2,1 @@\n-line three\n+three",
  );
  assert.throws(
    () => applyEdit(original, overlapping),
    (error: unknown) => error instanceof EditError && /overlaps or is out of order/.test(error.message),
  );
});
