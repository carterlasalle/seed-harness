// Seed lab research: catalog refresh over GitHub REST and arXiv, append-only.
//
// Purpose: refresh research/*.yaml mechanism entries from live GitHub release
// metadata and arXiv records without ever installing anything.
// Why it exists: the catalog grounds the scientist in real mechanisms; refresh
// keeps pins honest while staying read-only and side-effect free.
// Responsibilities: URL builders, response parsing into entries, append-only merge.
// Invariants: never spawns install commands; GITHUB_TOKEN is optional (higher
// rate limit when set); existing entries are never modified, only appended.
// Public types/functions: MechanismEntry, githubReleaseUrl, arxivRecordUrl,
// parseGithubRelease, parseArxivRecord, mergeEntries.

// trace:exempt reason=internal-detail
export interface MechanismEntry {
  id: string;
  title: string;
  source: string;
  tags: string[];
  problemClasses: string[];
  mechanismSummary: string;
  implementationIdeas: string[];
}

// trace:v1 id=impl.research-urls work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function githubReleaseUrl(owner: string, repo: string): string {
  if (!owner || !repo) throw new Error("github refresh needs owner and repo");
  return `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
}

// trace:v1 id=impl.research-arxiv-url work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function arxivRecordUrl(arxivId: string): string {
  if (!arxivId) throw new Error("arxiv refresh needs an id");
  return `http://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`;
}

// trace:v1 id=impl.research-github-parse work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function parseGithubRelease(owner: string, repo: string, payload: { tag?: string; body?: string }): MechanismEntry {
  const revision = payload.tag ?? "unknown";
  return {
    id: `${repo}-release`,
    title: `${owner}/${repo} release ${revision}`,
    source: `github:${owner}/${repo}`,
    tags: ["harness", "release"],
    problemClasses: ["context-freshness"],
    mechanismSummary: (payload.body ?? "").slice(0, 500),
    implementationIdeas: [`re-pin ${owner}/${repo} to ${revision} after re-running gates plus eval smoke`],
  };
}

// trace:v1 id=impl.research-arxiv-parse work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function parseArxivRecord(arxivId: string, title: string, summary: string): MechanismEntry {
  return {
    id: arxivId.replace(/\./g, "-"),
    title,
    source: `arxiv:${arxivId}`,
    tags: ["paper"],
    problemClasses: ["open-ended-improvement"],
    mechanismSummary: summary.slice(0, 500),
    implementationIdeas: [],
  };
}

// trace:v1 id=impl.research-merge work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function mergeEntries(existing: MechanismEntry[], fresh: MechanismEntry[]): MechanismEntry[] {
  const seen = new Set(existing.map((e) => e.id));
  const appended = fresh.filter((e) => !seen.has(e.id));
  return [...existing, ...appended];
}
