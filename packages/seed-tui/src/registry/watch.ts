// registry/watch.ts — keep filesystem-backed domains live.
//
// Purpose: when a skill, capability, or command file appears on disk, the
// registry picks it up and the UI shows it — no restart, no `/reload`.
// Why it exists: the objective asks for "I add it and it shows up", which is
// strictly more than OMP offers (its command dirs are refreshed only on
// init, cwd change, and explicit reloads).
// Responsibilities: watch the declared directories, debounce bursts, re-run
// the supplied discovery functions, and publish the result through the
// registry so every surface repaints.
// Invariants:
//   * discovery is the caller's function — the watcher never parses files
//     itself, so there is exactly one discovery path per domain;
//   * a burst of filesystem events collapses into one refresh;
//   * `flush()` performs the refresh synchronously for deterministic callers;
//   * a missing directory is not an error (roots come and go);
//   * `stop()` releases every watcher and cancels any pending debounce.
// Public types/functions: WatchSource, WatchOptions, watchRegistry.

import { existsSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import type { SeedRegistry } from "./registry.ts";
import type { RegistryDomain, RegistryEntryMap } from "./types.ts";

/** One filesystem-backed domain: where to watch, and how to rediscover it. */
// trace:exempt reason=internal-detail
export interface WatchSource<D extends RegistryDomain = RegistryDomain> {
  domain: D;
  /** Directories whose changes should trigger a refresh. */
  dirs: string[];
  /** The single discovery function for this domain (shared with startup). */
  discover: () => RegistryEntryMap[D][];
}

// trace:exempt reason=internal-detail
export interface WatchOptions {
  /** Debounce window in ms. Bursts inside it collapse to one refresh. */
  debounceMs?: number;
  /** Called after each refresh with what changed, for logging and tests. */
  onRefresh?: (summary: { domain: RegistryDomain; count: number }) => void;
}

/** Handle for a running watcher. */
// trace:exempt reason=internal-detail
export interface RegistryWatcher {
  /** Refresh every source now, bypassing the debounce. */
  flush: () => void;
  /** Release watchers and cancel any pending refresh. */
  stop: () => void;
  /** Domains currently being watched. */
  watched: () => RegistryDomain[];
}

// trace:v1 id=impl.tui-watch-registry work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function watchRegistry(
  registry: SeedRegistry,
  sources: readonly WatchSource[],
  options: WatchOptions = {},
): RegistryWatcher {
  const debounceMs = options.debounceMs ?? 150;
  const watchers: FSWatcher[] = [];
  // `undefined` (not null) so `clearTimeout` accepts it directly without a
  // guard that could never change behaviour.
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  // trace:exempt reason=internal-detail
  const refresh = (): void => {
    if (stopped) return;
    // trace:exempt reason=internal-detail
    for (const source of sources) {
      const entries = source.discover();
      registry.replaceAll(source.domain, entries);
      options.onRefresh?.({ domain: source.domain, count: entries.length });
    }
  };

  // trace:exempt reason=internal-detail
  const schedule = (): void => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      refresh();
    }, debounceMs);
    // Never hold the process open just to debounce a refresh.
    timer.unref?.();
  };

  // trace:exempt reason=internal-detail
  for (const source of sources) {
    // trace:exempt reason=internal-detail
    for (const dir of source.dirs) {
      if (!existsSync(dir)) continue;
      try {
        // trace:exempt reason=internal-detail
        const watcher = watch(dir, { recursive: true }, () => schedule());
        watcher.on("error", () => {
          // A directory that disappears mid-watch is not fatal: the next
          // refresh simply reports fewer entries.
        });
        watchers.push(watcher);
      } catch {
        // Recursive watching is unavailable on some platforms; the domain
        // still refreshes via `/reload` and on explicit `flush()`.
      }
    }
  }

  return {
    flush: refresh,
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      timer = undefined;
      for (const watcher of watchers) watcher.close();
      watchers.length = 0;
    },
    watched: () => sources.map((s) => s.domain),
  };
}
