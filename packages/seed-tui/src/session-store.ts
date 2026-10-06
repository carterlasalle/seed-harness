// session-store.ts — persisted interactive sessions.
//
// Purpose: keep transcripts instead of throwing them away, and let a session
// be resumed later — including resuming *from* another, which gives the
// history the shape of a tree rather than a flat list.
// Why it exists: the objective's session row asks for resume/history/tree;
// without a store, leaving the app loses everything the user just read.
// Responsibilities: create, append, patch, load, and list sessions on disk.
// Invariants:
//   * one file per session, named by id, so a corrupt file cannot take the
//     others down with it;
//   * reads tolerate a missing or malformed file by returning null rather
//     than throwing (a broken transcript must never block startup);
//   * `list` is newest-first and never returns a session it cannot parse;
//   * `parent` is recorded only when the session was resumed from another,
//     which is what makes the tree a tree.
// Public types/functions: StoredSession, SessionStore, createSessionStore.

import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Card } from "./components/transcript.ts";

// trace:exempt reason=internal-detail
export interface StoredSession {
  id: string;
  /** ISO timestamp of creation. */
  at: string;
  /** Set when this session was resumed from another — the tree edge. */
  parent?: string;
  /** Working directory the session ran in. */
  cwd?: string;
  /** First user prompt, for the history list. */
  prompt?: string;
  /** Model in use when the session started, when known. */
  model?: string;
  cards: Card[];
}

// trace:exempt reason=internal-detail
export interface SessionStore {
  readonly dir: string;
  create(options: { parent?: string; cwd?: string; model?: string }): string;
  append(sessionId: string, card: Card): void;
  patch(sessionId: string, cardId: string, patch: Partial<Omit<Card, "id">>): void;
  load(sessionId: string): StoredSession | null;
  list(): StoredSession[];
}

// trace:exempt reason=internal-detail
function safeName(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) && !id.includes("..");
}

// trace:v1 id=impl.tui-session-store work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function createSessionStore(dir: string): SessionStore {
  // trace:exempt reason=internal-detail
  const pathFor = (id: string): string => join(dir, `${id}.json`);

  // trace:exempt reason=internal-detail
  const read = (id: string): StoredSession | null => {
    if (!safeName(id)) return null;
    try {
      const parsed = JSON.parse(readFileSync(pathFor(id), "utf8")) as StoredSession;
      if (typeof parsed?.id !== "string" || !Array.isArray(parsed.cards)) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  // trace:exempt reason=internal-detail
  const write = (session: StoredSession): void => {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(pathFor(session.id), `${JSON.stringify(session, null, 2)}\n`);
    } catch {
      // Persistence is a convenience; a read-only state dir must not break the
      // session that is already running.
    }
  };

  return {
    dir,
    // trace:exempt reason=internal-detail
    create({ parent, cwd, model }) {
      // A session id becomes a file name, so it must not be predictable or
      // collision-prone: a UUID is both.
      const id = `sess-${randomUUID()}`;
      // trace:exempt reason=internal-detail
      write({
        id,
        at: new Date().toISOString(),
        ...(parent ? { parent } : {}),
        ...(cwd ? { cwd } : {}),
        ...(model ? { model } : {}),
        cards: [],
      });
      return id;
    },

    // trace:exempt reason=internal-detail
    append(sessionId, card) {
      const session = read(sessionId);
      if (!session) return;
      session.cards.push(card);
      if (!session.prompt && card.kind === "user") session.prompt = card.title.slice(0, 120);
      write(session);
    },

    // trace:exempt reason=internal-detail
    patch(sessionId, cardId, patch) {
      const session = read(sessionId);
      if (!session) return;
      // trace:exempt reason=internal-detail
      const index = session.cards.findIndex((c) => c.id === cardId);
      if (index === -1) return;
      session.cards[index] = { ...(session.cards[index] as Card), ...patch };
      write(session);
    },

    load: read,

    // trace:exempt reason=internal-detail
    list() {
      let names: string[] = [];
      try {
        names = readdirSync(dir).filter((name) => name.endsWith(".json"));
      } catch {
        return [];
      }
      const sessions: StoredSession[] = [];
      // trace:exempt reason=internal-detail
      for (const name of names) {
        const session = read(name.replace(/\.json$/, ""));
        if (session) sessions.push(session);
      }
      sessions.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      return sessions;
    },
  };
}

/**
 * Render a session list as an indented tree, oldest roots first.
 *
 * A session whose parent is missing (deleted, or from another state dir)
 * renders as a root rather than being dropped, so history never silently
 * loses entries.
 */
// trace:v1 id=impl.tui-session-tree work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function sessionTree(sessions: readonly StoredSession[]): { session: StoredSession; depth: number }[] {
  const byParent = new Map<string, StoredSession[]>();
  // trace:exempt reason=internal-detail
  const ids = new Set(sessions.map((s) => s.id));
  // trace:exempt reason=internal-detail
  for (const session of sessions) {
    const key = session.parent && ids.has(session.parent) ? session.parent : "";
    const bucket = byParent.get(key) ?? [];
    bucket.push(session);
    byParent.set(key, bucket);
  }
  const out: { session: StoredSession; depth: number }[] = [];
  const seen = new Set<string>();
  // trace:exempt reason=internal-detail
  const walk = (parent: string, depth: number): void => {
    // trace:exempt reason=internal-detail
    for (const session of byParent.get(parent) ?? []) {
      if (seen.has(session.id)) continue;
      seen.add(session.id);
      out.push({ session, depth });
      walk(session.id, depth + 1);
    }
  };
  walk("", 0);
  // Anything left (a cycle) is still listed, just flat.
  // trace:exempt reason=internal-detail
  for (const session of sessions) {
    if (!seen.has(session.id)) out.push({ session, depth: 0 });
  }
  return out;
}
