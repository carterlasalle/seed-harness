// seed-cli update check: stale-while-revalidate reminder against GitHub releases.
//
// Purpose: `seed doctor` (and every CLI run) tells the user a newer release
// exists without ever blocking on the network. Why it exists: brew and npm
// installs go stale silently; the reminder is the only update channel.
// Responsibilities: read-only cache check on the call path, detached
// background refresh of the latest release tag, semver compare, 24h
// re-notify throttle. Invariants: stdlib only (node:https/fs/os/path);
// never throws (all failures resolve to undefined); never awaits network
// on the call path; honors SEED_NO_UPDATE_CHECK=1; cache lives under
// ~/.cache/seed/update.json so it never pollutes the repo or ~/.seed state.
// Public types/functions: checkCachedUpdate.
import { get } from "node:https";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// trace:exempt reason=const-data
const REPO = "carterlasalle/seed-harness";
// trace:exempt reason=const-data
const CACHE_FILE = join(homedir(), ".cache", "seed", "update.json");
// trace:exempt reason=const-data
const REFRESH_AFTER_MS = 12 * 60 * 60 * 1000;
// trace:exempt reason=const-data
const RENOTIFY_AFTER_MS = 24 * 60 * 60 * 1000;
// trace:exempt reason=const-data
const HTTP_TIMEOUT_MS = 6000;

type Cache = {
  latest: string;
  checkedAt: number;
  lastNotifiedVersion?: string;
  lastNotifiedAt?: number;
};

// trace:exempt reason=internal-detail
function cacheFile(): string {
  const override = process.env.SEED_UPDATE_CACHE ?? "";
  return override.length > 0 ? override : CACHE_FILE;
}

// trace:exempt reason=internal-detail
function readCache(): Cache | undefined {
  try {
    const raw = readFileSync(cacheFile(), "utf8");
    const c = JSON.parse(raw) as Partial<Cache>;
    if (typeof c.latest !== "string" || typeof c.checkedAt !== "number") return undefined;
    return c as Cache;
  } catch {
    return undefined;
  }
}

// trace:exempt reason=internal-detail
function writeCache(c: Cache): void {
  try {
    mkdirSync(join(cacheFile(), ".."), { recursive: true });
    writeFileSync(cacheFile(), JSON.stringify(c));
  } catch {
    // Cache is best-effort; a read-only HOME must not break the CLI.
  }
}

// Numeric semver compare on the leading x.y.z; pre-release suffixes are
// ignored (good enough for a reminder, keeps this dependency-free).
// trace:exempt reason=internal-detail
function cmpSemver(a: string, b: string): number {
  const pa = a.replace(/^[v=\s]+/, "").split("-")[0].split(".").map(Number);
  const pb = b.replace(/^[v=\s]+/, "").split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0 || Number.isNaN(d)) return Number.isNaN(d) ? 0 : d;
  }
  return 0;
}

// Detached refresh: latest GitHub release tag -> cache. Never awaited by
// callers; never throws (all failures resolve silently).
// trace:exempt reason=internal-detail
function refreshInBackground(): void {
  if (process.env.SEED_NO_UPDATE_CHECK === "1") return;
  try {
    const req = get(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { "User-Agent": "seed-update-check", Accept: "application/vnd.github+json" } },
      (res) => {
        let body = "";
        res.on("data", (chunk: unknown) => {
          body += String(chunk);
        });
        res.on("end", () => {
          try {
            const tag = (JSON.parse(body) as { tag_name?: unknown }).tag_name;
            if (typeof tag !== "string" || !tag) return;
            const prev = readCache();
            writeCache({
              latest: tag,
              checkedAt: Date.now(),
              lastNotifiedVersion: prev?.lastNotifiedVersion,
              lastNotifiedAt: prev?.lastNotifiedAt,
            });
          } catch {
            // Malformed API response — keep the old cache.
          }
        });
      },
    );
    req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy());
    req.on("error", () => {});
  } catch {
    // Offline / DNS / sandbox — the reminder simply stays quiet.
  }
};

// trace:v1 id=impl.cli-update-check work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function checkCachedUpdate(installed: string): string | undefined {
  if (process.env.SEED_NO_UPDATE_CHECK === "1") return undefined;
  const now = Date.now();
  const cache = readCache();
  if (!cache || now - cache.checkedAt > REFRESH_AFTER_MS) {
    refreshInBackground();
  }
  if (!cache) return undefined;
  if (cmpSemver(cache.latest, installed) <= 0) return undefined;
  if (
    cache.lastNotifiedVersion === cache.latest &&
    typeof cache.lastNotifiedAt === "number" &&
    now - cache.lastNotifiedAt < RENOTIFY_AFTER_MS
  ) {
    return undefined;
  }
  writeCache({ ...cache, lastNotifiedVersion: cache.latest, lastNotifiedAt: now });
  // trace:exempt reason=internal-detail
  const clean = (v: string): string => v.replace(/^[v=\s]+/, "");
  // Without this the function fell off the end and always returned undefined,
  // so the reminder could never print however stale the install was.
  return `${clean(installed)} -> ${clean(cache.latest)}`;
}

/**
 * The latest known release versus `installed`, for an explicit status query.
 *
 * Deliberately not the reminder: `checkCachedUpdate` throttles repeats for 24h
 * and stamps `lastNotifiedAt`, so the entry-point preflight would make an
 * immediately following `seed update --check` report "up to date" right after
 * printing that an update exists. This only reads the cache — no background
 * refresh, no write, no throttle — so asking twice gives the same answer.
 */
// trace:v1 id=impl.cli-update-status work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function cachedUpdateStatus(installed: string): { latest: string } | undefined {
  // trace:exempt reason=internal-detail
  const cache = readCache();
  if (!cache) return undefined;
  if (cmpSemver(cache.latest, installed) <= 0) return undefined;
  // trace:exempt reason=internal-detail
  return { latest: cache.latest.replace(/^[v=\s]+/, "") };
}
