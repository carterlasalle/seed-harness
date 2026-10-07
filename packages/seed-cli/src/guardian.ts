// guardian.ts — the one place CLI code opens a guardian connection.
//
// Purpose: guarantee every guardian connection is closed.
// Why it exists: every caller connected, called, then closed on the happy path
// only — `client.close()` sat after the `call`, so a throw from the call (or
// anything between connect and close) leaked the socket. An open socket keeps
// the event loop alive, which the CLI hides behind `process.exit` but which
// leaves the test runner and any library consumer hanging forever. One
// helper makes the close structural instead of a thing each caller must
// remember.
// Responsibilities: connect, run the caller's body, close on every path.
// Invariants: the client is always closed, including when the body throws; the
// body's error propagates unchanged, so callers keep their own offline
// fallbacks and their own error messages.
// Public functions: withGuardian.

import { connectGuardian } from "@carterlasalle/seed-runtime/dist/guardian-client.js";
import type { GuardianClient } from "@carterlasalle/seed-runtime/dist/guardian-client.js";
import { join } from "node:path";

/**
 * Where the guardian listens. `SEED_GUARDIAN_SOCKET` wins so tests (and anyone
 * running a second guardian) are not forced to talk to the developer's live
 * daemon; the default is the documented per-user path.
 */
// trace:v1 id=impl.cli-guardian-socket work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function guardianSocketPath(): string {
  // trace:exempt reason=internal-detail
  const override = process.env.SEED_GUARDIAN_SOCKET;
  if (override !== undefined && override.length > 0) return override;
  return join(process.env.HOME ?? "", ".seed", "run", "guardian.sock");
}

// trace:v1 id=impl.cli-with-guardian work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export async function withGuardian<T>(
  options: { socketPath: string; connectTimeoutMs: number },
  body: (client: GuardianClient) => Promise<T>,
): Promise<T> {
  const client = await connectGuardian(options);
  try {
    return await body(client);
  } finally {
    // A connection is scoped to one body; it must never outlive it.
    client.close();
  }
}