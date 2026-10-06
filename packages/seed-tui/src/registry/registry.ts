// registry/registry.ts — the single live registry.
//
// Purpose: hold every runtime-visible thing (commands, settings, models,
// skills, tools, capabilities, renderers, keybindings, themes) behind one
// interface that emits change events. Why it exists: the interactive
// frontend must never hard-code a second copy of what the runtime knows.
// Responsibilities: store entries per domain, publish exactly one event per
// mutation, and hand back immutable snapshots.
// Invariants:
//   * every successful mutation publishes exactly one event;
//   * `revision` strictly increases and never repeats;
//   * a listener registered with `on` sees every subsequent mutation;
//   * `list` immediately reflects the mutation (no restart, no cache);
//   * ids are unique within a domain (register replaces);
//   * removing an unknown id is a no-op and publishes nothing.
// Public types/functions: SeedRegistry, seedRegistry.

import { REGISTRY_DOMAINS } from "./types.ts";
import type { RegistryDomain, RegistryEntryMap, RegistryEvent } from "./types.ts";

// trace:exempt reason=internal-detail
export type RegistryListener = (event: RegistryEvent) => void;

// trace:v1 id=impl.tui-registry-core work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export class SeedRegistry {
  private readonly domains = new Map<RegistryDomain, Map<string, unknown>>();
  private readonly listeners = new Set<RegistryListener>();
  private rev = 0;

  // trace:exempt reason=internal-detail
  constructor() {
    for (const domain of REGISTRY_DOMAINS) this.domains.set(domain, new Map());
  }

  /** Monotonic revision; changes exactly once per published event. */
  // trace:exempt reason=internal-detail
  get revision(): number {
    return this.rev;
  }

  /** Subscribe to every mutation. Returns an unsubscribe function. */
  // trace:exempt reason=internal-detail
  on(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    // trace:exempt reason=internal-detail
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Add or replace an entry. Returns "added" or "updated" so callers can
   * assert the mutation landed. Publishes exactly one event.
   */
  // trace:exempt reason=internal-detail
  register<D extends RegistryDomain>(domain: D, entry: RegistryEntryMap[D]): "added" | "updated" {
    const bucket = this.bucket(domain);
    const type = bucket.has(entry.id) ? "updated" : "added";
    bucket.set(entry.id, entry);
    this.publish(type, domain, entry.id);
    return type;
  }

  /**
   * Replace every entry in a domain at once (bulk rediscovery). Publishes one
   * event per added/updated/removed id, then a single "reset" for the domain.
   * Returns the number of entries now present.
   */
  // trace:exempt reason=internal-detail
  replaceAll<D extends RegistryDomain>(domain: D, entries: readonly RegistryEntryMap[D][]): number {
    const bucket = this.bucket(domain);
    const next = new Map<string, unknown>();
    for (const entry of entries) next.set(entry.id, entry);
    // trace:exempt reason=internal-detail
    for (const id of bucket.keys()) {
      if (!next.has(id)) this.publish("removed", domain, id);
    }
    // trace:exempt reason=internal-detail
    for (const [id, entry] of next) {
      const previous = bucket.get(id);
      const existed = previous !== undefined;
      bucket.set(id, entry);
      if (!existed) this.publish("added", domain, id);
      else if (JSON.stringify(previous) !== JSON.stringify(entry)) {
        this.publish("updated", domain, id);
      }
    }
    for (const id of bucket.keys()) if (!next.has(id)) bucket.delete(id);
    this.publish("reset", domain, "*");
    return next.size;
  }

  /** Remove one entry. Returns false (and publishes nothing) when absent. */
  // trace:exempt reason=internal-detail
  unregister(domain: RegistryDomain, id: string): boolean {
    const bucket = this.bucket(domain);
    if (!bucket.delete(id)) return false;
    this.publish("removed", domain, id);
    return true;
  }

  /** Sorted entries for a domain — the same order every surface renders. */
  // trace:exempt reason=internal-detail
  list<D extends RegistryDomain>(domain: D): RegistryEntryMap[D][] {
    const bucket = this.bucket(domain);
    return [...bucket.values()].sort((a, b) => {
      const left = (a as { id: string }).id;
      const right = (b as { id: string }).id;
      return left < right ? -1 : left > right ? 1 : 0;
    }) as RegistryEntryMap[D][];
  }

  /** One entry, or null. */
  // trace:exempt reason=internal-detail
  get<D extends RegistryDomain>(domain: D, id: string): RegistryEntryMap[D] | null {
    return (this.bucket(domain).get(id) as RegistryEntryMap[D] | undefined) ?? null;
  }

  /** Entry count for a domain. */
  // trace:exempt reason=internal-detail
  size(domain: RegistryDomain): number {
    return this.bucket(domain).size;
  }

  /** Every domain with its entry count — powers `/registry`. */
  // trace:exempt reason=internal-detail
  census(): { domain: RegistryDomain; count: number }[] {
    return REGISTRY_DOMAINS.map((domain) => ({ domain, count: this.size(domain) }));
  }

  /** Full snapshot for inspection and tests. */
  // trace:exempt reason=internal-detail
  snapshot(): Record<RegistryDomain, unknown[]> {
    const out = {} as Record<RegistryDomain, unknown[]>;
    for (const domain of REGISTRY_DOMAINS) out[domain] = this.list(domain);
    return out;
  }

  /** Drop every listener (tests and shutdown). */
  // trace:exempt reason=internal-detail
  removeAllListeners(): void {
    this.listeners.clear();
  }

  // trace:exempt reason=internal-detail
  private bucket(domain: RegistryDomain): Map<string, unknown> {
    const bucket = this.domains.get(domain);
    if (!bucket) throw new Error(`unknown registry domain ${JSON.stringify(domain)}`);
    return bucket;
  }

  // trace:exempt reason=internal-detail
  private publish(type: RegistryEvent["type"], domain: RegistryDomain, id: string): void {
    this.rev += 1;
    const event: RegistryEvent = { type, domain, id, revision: this.rev };
    for (const listener of [...this.listeners]) listener(event);
  }
}

/** Construct an empty registry. Population lives in sources.ts. */
// trace:v1 id=impl.tui-registry-factory work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function seedRegistry(): SeedRegistry {
  return new SeedRegistry();
}
