// errors.ts — typed failure domains for the transcript.
//
// Purpose: classify a failure by which Seed subsystem produced it, so the
// transcript can render a styled, expandable card instead of a red text dump.
// Why it exists: Seed has far more failure domains than a normal coding agent
// (provider, tool, guardian RPC, sandbox, oracle, gate, candidate, probation,
// config, schema, filesystem); showing them identically hides the one thing
// an operator needs — which boundary broke.
// Responsibilities: map an error (or a message) to a domain, extract
// provenance, and describe retryability.
// Invariants: classification never throws; an unrecognised error is
// "unknown", never silently attributed to a domain.
// Public types/functions: ErrorDomain, SeedError, classifyError, describeError.

/** Every boundary Seed can fail at. */
// trace:v1 id=impl.tui-error-domains work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export type ErrorDomain =
  | "provider"
  | "model"
  | "tool"
  | "capability"
  | "guardian"
  | "sandbox"
  | "oracle"
  | "gate"
  | "candidate"
  | "probation"
  | "config"
  | "schema"
  | "filesystem"
  | "unknown";

// trace:exempt reason=internal-detail
export interface SeedError {
  domain: ErrorDomain;
  message: string;
  /** Actionable one-liner: what to do next, when known. */
  hint?: string;
  retryable: boolean;
  /** Raw text for the expanded view. */
  detail?: string;
}

// Ordered most-specific first: the first pattern that matches wins, so a
// guardian RPC failure is never mislabelled as a generic provider error.
// trace:exempt reason=internal-detail
const PATTERNS: { domain: ErrorDomain; pattern: RegExp; retryable: boolean; hint?: string }[] = [
  // Guardian first: a socket failure names its boundary explicitly, so it must
  // beat the generic connection pattern below or it would read as a provider
  // outage and point the operator at the wrong subsystem.
  { domain: "guardian", pattern: /guardian|protocol mismatch/, retryable: true, hint: "start seed-guardian; it binds ~/.seed/run/guardian.sock" },
  { domain: "provider", pattern: /OPENROUTER_API_KEY|api key|401|403/, retryable: false, hint: "export OPENROUTER_API_KEY or add it to .env" },
  { domain: "provider", pattern: /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|fetch failed/, retryable: true },
  { domain: "schema", pattern: /schema_version|schema .*invalid|required field/, retryable: false },
  { domain: "config", pattern: /config\.toml|unknown key|parse .*\.toml/, retryable: false },
  { domain: "sandbox", pattern: /sandbox|docker/, retryable: true },
  { domain: "oracle", pattern: /oracle/, retryable: false },
  { domain: "gate", pattern: /non-?inferior|gate|tolerance/, retryable: false },
  { domain: "probation", pattern: /probation|strike/, retryable: false },
  { domain: "candidate", pattern: /candidate|worktree/, retryable: false },
  { domain: "capability", pattern: /capabilit/, retryable: false },
  { domain: "tool", pattern: /tool|python turn|timeout_ms/, retryable: true },
  { domain: "filesystem", pattern: /ENOENT|EACCES|EISDIR|no such file/, retryable: false },
  { domain: "model", pattern: /model/, retryable: true },
];

// trace:v1 id=impl.tui-classify-error work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function classifyError(error: unknown): SeedError {
  const message = error instanceof Error ? error.message : String(error);
  const detail = error instanceof Error && error.stack ? error.stack : undefined;
  // trace:exempt reason=internal-detail
  for (const candidate of PATTERNS) {
    // trace:exempt reason=internal-detail
    if (candidate.pattern.test(message)) {
      return {
        domain: candidate.domain,
        message,
        retryable: candidate.retryable,
        ...(candidate.hint ? { hint: candidate.hint } : {}),
        ...(detail ? { detail } : {}),
      };
    }
  }
  return { domain: "unknown", message, retryable: false, ...(detail ? { detail } : {}) };
}

/** One-line summary for the collapsed card. */
// trace:v1 id=impl.tui-describe-error work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function describeError(error: SeedError): string {
  const retry = error.retryable ? "retryable" : "not retryable";
  return `${error.domain} error (${retry}): ${error.message.split("\n")[0] ?? ""}`;
}
