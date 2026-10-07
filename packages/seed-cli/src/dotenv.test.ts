// dotenv.test.ts — the .env loader matches what .env.example actually ships.
//
// Purpose: prove the documented `.env` reaches the process, and that a real
// environment variable still wins. Why it exists: nothing read `.env` at all,
// so a key placed where the error message said to put it silently did nothing.
// Invariants under test: comments/blanks/malformed lines are skipped, `$HOME`
// expands, quotes are stripped, and the environment outranks the file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile, parseEnvFile } from "./dotenv.ts";

test("parseEnvFile reads values, skips comments and junk, and expands $HOME", () => {
  const text = [
    "# Seed local config",
    "",
    "SEED_GUARDIAN_URL=http://127.0.0.1:7788",
    "SEED_SCRATCH_ROOT=$HOME/.seed/scratch",
    "BRACED=${HOME}/other",
    "QUOTED='a b c'",
    "DQUOTED=\"a b c\"",
    "SPACED = value",
    "NOT A KEY=x",
    "noequals",
  ].join("\n");
  const values = parseEnvFile(text, "/home/tester");

  assert.equal(values.SEED_GUARDIAN_URL, "http://127.0.0.1:7788");
  assert.equal(values.SEED_SCRATCH_ROOT, "/home/tester/.seed/scratch");
  assert.equal(values.BRACED, "/home/tester/other");
  assert.equal(values.QUOTED, "a b c");
  assert.equal(values.DQUOTED, "a b c");
  assert.equal(values.SPACED, "value");
  assert.equal(values["NOT A KEY"], undefined);
  assert.equal(values.noequals, undefined);
});

test("loadEnvFile applies the file but never overwrites the real environment", () => {
  const dir = mkdtempSync(join(tmpdir(), "seed-dotenv-"));
  const file = join(dir, ".env");
  writeFileSync(file, "SEED_DOTENV_NEW=fromfile\nSEED_DOTENV_KEEP=fromfile\n");

  delete process.env.SEED_DOTENV_NEW;
  process.env.SEED_DOTENV_KEEP = "fromenv";
  try {
    loadEnvFile(file);
    assert.equal(process.env.SEED_DOTENV_NEW, "fromfile", "a new key is applied");
    assert.equal(process.env.SEED_DOTENV_KEEP, "fromenv", "the environment wins");
  } finally {
    delete process.env.SEED_DOTENV_NEW;
    delete process.env.SEED_DOTENV_KEEP;
  }
});

test("a missing .env is a no-op rather than an error", () => {
  assert.doesNotThrow(() => loadEnvFile(join(tmpdir(), "seed-does-not-exist-xyz", ".env")));
});