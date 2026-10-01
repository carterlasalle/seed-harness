// Seed-runtime session: crash-safe champion-pinned session directories.
//
// Purpose: give every organism run a stable identity (session id) and a
// confined scratch root (SEED_SCRATCH), and make restarts explicit about
// which champion they resume under.
// Why it exists: REQ-SEED-YM8XJREE needs session-pinned champions — a crash
// restart must rebind the SAME sha, never silently switch to a newer one.
// Responsibilities: session id minting, scratch dir creation under
// ~/.seed/scratch/<session>/, session.json persistence, same-sha resume
// with mismatch refusal.
// Invariants: scratch dir always exists after create; session.json always
// carries the pinned champion ref; resume with a different ref throws
// instead of switching; SEED_SCRATCH points at the live session dir.
// Public types/functions: SeedSession, newSessionId, defaultScratchRoot,
// createSession, openSession, resumeSession.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SeedSession {
  id: string;
  championRef: string;
  scratchDir: string;
  createdAt: string;
}

// trace:exempt reason=internal-detail
interface SessionFile {
  id: string;
  championRef: string;
  createdAt: string;
}

let sessionCounter = 0;

// trace:v1 id=impl.rt-session-id work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export function newSessionId(prefix = "sess"): string {
  sessionCounter += 1;
  return `${prefix}-${process.pid}-${Date.now().toString(36)}-${sessionCounter}`;
}

// trace:v1 id=impl.rt-session-root work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export function defaultScratchRoot(): string {
  return process.env.SEED_SCRATCH_ROOT ?? join(homedir(), ".seed", "scratch");
}

// trace:exempt reason=internal-detail
function readSessionFile(scratchDir: string): SessionFile {
  const raw = readFileSync(join(scratchDir, "session.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) throw new Error(`bad session.json in ${scratchDir}`);
  const file = parsed as Partial<SessionFile>;
  if (typeof file.id !== "string" || typeof file.championRef !== "string") {
    throw new Error(`bad session.json in ${scratchDir}: missing id/championRef`);
  }
  return { id: file.id, championRef: file.championRef, createdAt: typeof file.createdAt === "string" ? file.createdAt : "" };
}

// trace:v1 id=impl.rt-session-create work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export function createSession(init: {
  championRef: string;
  sessionId?: string;
  scratchRoot?: string;
}): SeedSession {
  const id = init.sessionId ?? newSessionId();
  // trace:exempt reason=internal-detail
  const scratchDir = join(init.scratchRoot ?? defaultScratchRoot(), id);
  mkdirSync(scratchDir, { recursive: true });
  const createdAt = new Date().toISOString();
  writeFileSync(join(scratchDir, "session.json"), JSON.stringify({ id, championRef: init.championRef, createdAt }));
  process.env.SEED_SCRATCH = scratchDir;
  return { id, championRef: init.championRef, scratchDir, createdAt };
}

// trace:v1 id=impl.rt-session-open work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export function openSession(sessionId: string, scratchRoot?: string): SeedSession {
  const scratchDir = join(scratchRoot ?? defaultScratchRoot(), sessionId);
  if (!existsSync(join(scratchDir, "session.json"))) throw new Error(`unknown session: ${sessionId}`);
  const file = readSessionFile(scratchDir);
  process.env.SEED_SCRATCH = scratchDir;
  return { id: file.id, championRef: file.championRef, scratchDir, createdAt: file.createdAt };
}

// trace:v1 id=impl.rt-session-resume work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-YM8XJREE
export function resumeSession(sessionId: string, championRef: string, scratchRoot?: string): SeedSession {
  const session = openSession(sessionId, scratchRoot);
  if (session.championRef !== championRef) {
    throw new Error(
      `session champion mismatch: pinned ${JSON.stringify(session.championRef)} ` +
      `vs requested ${JSON.stringify(championRef)} (no silent switch; restart with the pinned sha)`,
    );
  }
  return session;
}
