// Seed lab experience: append-only outcome summaries without transcripts.
//
// Purpose: record what worked, what failed, and the lesson — never the full
// agent transcript — so the scientist and crystallizer learn without bloating
// the store or leaking secrets.
// Why it exists: per-task reflection feeds cross-task learning; transcripts
// are cost, noise, and a secret-leak vector.
// Responsibilities: experience record shape, append-only log, lesson query.
// Invariants: summaries are capped at 500 chars; transcripts are never stored;
// the log only grows (no update/delete API exists).
// Public types/functions: Experience, MAX_SUMMARY_CHARS, recordExperience,
// findLessons.

// trace:exempt reason=internal-detail
export interface Experience {
  taskId: string;
  outcome: "success" | "failure";
  summary: string;
  lesson: string;
}

export const MAX_SUMMARY_CHARS = 500;

// trace:v1 id=impl.experience-record work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function recordExperience(log: Experience[], entry: Experience): Experience[] {
  if (!entry.taskId) throw new Error("experience needs a task id");
  if (!entry.lesson) throw new Error("experience needs a lesson");
  if (entry.summary.length > MAX_SUMMARY_CHARS) throw new Error("experience summary exceeds 500 chars");
  if (/```|BEGIN PGP|sk-[A-Za-z0-9]/.test(entry.summary + entry.lesson))
    throw new Error("experience must not carry transcripts or secrets");
  return [...log, { ...entry }];
}

// trace:v1 id=impl.experience-lessons work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
export function findLessons(log: Experience[], outcome: Experience["outcome"]): string[] {
  return log.filter((e) => e.outcome === outcome).map((e) => e.lesson);
}
