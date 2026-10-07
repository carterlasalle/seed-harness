// dotenv.ts — load `.env` into the process environment for the CLI entry.
//
// Purpose: make the documented `.env` real.
// Why it exists: `.env.example`, the README and the model-key error all tell
// people to put values in `.env`, but nothing read the file — only `doctor`
// regex-scraped one key for its own check. A key placed exactly where the
// error said to put it silently did nothing, and the failure looked like a
// missing key rather than an unread file.
// Responsibilities: parse `KEY=VALUE` lines, expand `$HOME`/`${HOME}`, and
// apply them without overwriting what the environment already set.
// Invariants: never throws (a malformed file leaves the environment alone);
// real environment variables always win; comments and blanks are skipped;
// values are never echoed or logged.
// Public functions: loadEnvFile.

import { existsSync, readFileSync } from "node:fs";

// trace:v1 id=impl.cli-dotenv-parse work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function parseEnvFile(text: string, home: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    // trace:exempt reason=internal-detail
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    // trace:exempt reason=internal-detail
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    // trace:exempt reason=internal-detail
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    // trace:exempt reason=internal-detail
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // `.env.example` ships `$HOME/.seed/scratch`, which is meaningless to a
    // process that does not expand it.
    values[key] = value.replace(/\$\{HOME\}|\$HOME/g, home);
  }
  return values;
}

/**
 * Apply `path` to `process.env`. Absent or unreadable files are a no-op, and
 * an already-set variable is never overwritten — the environment is the
 * caller's explicit intent and outranks a file.
 */
// trace:v1 id=impl.cli-dotenv-load work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  // trace:exempt reason=internal-detail
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  // trace:exempt reason=internal-detail
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  for (const [key, value] of Object.entries(parseEnvFile(text, home))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}