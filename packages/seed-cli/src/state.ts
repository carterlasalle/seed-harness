// seed-cli state: local JSON state + shared record shapes.
//
// Purpose: single home for the CLI's view of Seed state (champion pointer,
// run queue/history, model profiles, eval results) so every command reads and
// writes the same shapes. Why it exists: REQ-SEED-EZPD6B85 needs `seed`
// commands (run/status/evolve/eval/champion/...) to share one state dir
// instead of each inventing its own. Responsibilities: locate repo root and
// state dir, atomic-ish JSON load/save, lazy-init defaults, shared record
// types mirroring python/seed_evolution/protocol.py. Invariants: every read
// tolerates missing/corrupt files via defaults; every write creates parent
// dirs; never touches the network; state dir overridable via SEED_STATE_DIR
// (tests). State layout: SEED_STATE_DIR wins; explicit root arg uses
// <root>/.seed-state (tests/CI); otherwise ~/.seed (spec section 11) so the
// user project tree stays free of Seed runtime state.
// Public functions/types: seedRoot, stateDir, readJson, writeJson,
// appendJsonl, loadChampion, saveChampion, loadQueue, saveQueue, recordRun,
// recentRuns, loadModels, saveModels, saveEvalResult, listEvalResults,
// RunRecord, ChampionPointer, ModelProfile, ExperimentSummary,
// EvalResultSummary.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// trace:exempt reason=internal-detail
export interface RunRecord {
  id: string;
  at: string;
  session: string;
  prompt: string;
  capabilities: string[];
  ok: boolean;
  detail: string;
}

// trace:exempt reason=internal-detail
export interface ChampionPointer {
  ref: string;
  updatedAt: string;
  history: Array<{ ref: string; at: string; reason: string }>;
}

// trace:exempt reason=internal-detail
export interface ModelProfile {
  model: string;
  strengths: string[];
  weaknesses: string[];
  costPerTask: number;
  p50LatencyMs: number;
  tasksEvaluated: number;
}

// trace:exempt reason=internal-detail
export interface ExperimentSummary {
  id: string;
  at: string;
  tasks: string[];
  passed: number;
  failed: number;
}

// trace:exempt reason=internal-detail
export interface EvalResultSummary {
  id: string;
  at: string;
  suite: string;
  total: number;
  passed: number;
  failed: number;
  failures: string[];
}

// trace:v1 id=impl.cli-state-root work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function seedRoot(startDir?: string): string {
  if (process.env.SEED_ROOT) return resolve(process.env.SEED_ROOT);
  let dir = resolve(startDir ?? process.cwd());
  for (;;) {
    if (existsSync(join(dir, ".trace", "trace.toml"))) return dir;
    const parent = dirname(dir);
    // trace:exempt reason=internal-detail
    if (parent === dir) return resolve(startDir ?? process.cwd());
    dir = parent;
  }
}

// trace:v1 id=impl.cli-state-dir work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function stateDir(root?: string): string {
  if (process.env.SEED_STATE_DIR) return resolve(process.env.SEED_STATE_DIR);
  if (root) {
    const dir = join(resolve(root), ".seed-state");
    mkdirSync(dir, { recursive: true });
    return dir;
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? null;
  const dir = home ? join(home, ".seed") : join(process.cwd(), ".seed-state");
  mkdirSync(dir, { recursive: true });
  return dir;
}

// trace:v1 id=impl.cli-state-json work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

// trace:v1 id=impl.cli-state-write work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

// trace:v1 id=impl.cli-state-append work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function appendJsonl(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(value) + "\n");
}

const DEFAULT_CHAMPION: ChampionPointer = {
  ref: "baseline@v1",
  updatedAt: new Date(0).toISOString(),
  history: [{ ref: "baseline@v1", at: new Date(0).toISOString(), reason: "initial champion" }],
};

// trace:v1 id=impl.cli-state-champion work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function loadChampion(root?: string): ChampionPointer {
  const path = join(stateDir(root), "champion.json");
  const found = readJson<ChampionPointer | null>(path, null);
  if (!found || typeof found.ref !== "string" || !Array.isArray(found.history)) {
    writeJson(path, DEFAULT_CHAMPION);
    return { ...DEFAULT_CHAMPION, history: [...DEFAULT_CHAMPION.history] };
  }
  return found;
}

// trace:v1 id=impl.cli-state-champion-save work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function saveChampion(pointer: ChampionPointer, root?: string): void {
  writeJson(join(stateDir(root), "champion.json"), pointer);
}

// trace:v1 id=impl.cli-state-queue work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function loadQueue(root?: string): string[] {
  return readJson<string[]>(join(stateDir(root), "evolve-queue.json"), []);
}

// trace:v1 id=impl.cli-state-queue-save work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function saveQueue(tasks: string[], root?: string): void {
  writeJson(join(stateDir(root), "evolve-queue.json"), tasks);
}

// trace:v1 id=impl.cli-state-runs work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function recordRun(record: RunRecord, root?: string): void {
  const dir = stateDir(root);
  const runs = readJson<RunRecord[]>(join(dir, "runs.json"), []);
  runs.push(record);
  writeJson(join(dir, "runs.json"), runs.slice(-50));
  appendJsonl(join(dir, "events.jsonl"), {
    type: "task.result",
    timestamp: record.at,
    session: record.session,
    payload: { runId: record.id, ok: record.ok },
  });
}

// trace:v1 id=impl.cli-state-recent work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function recentRuns(limit: number, root?: string): RunRecord[] {
  const runs = readJson<RunRecord[]>(join(stateDir(root), "runs.json"), []);
  return runs.slice(-Math.max(1, limit));
}

const DEFAULT_MODELS: ModelProfile[] = [
  {
    model: "default",
    strengths: ["routine-coding", "tool-use"],
    weaknesses: ["novel-design"],
    costPerTask: 0.02,
    p50LatencyMs: 8000,
    tasksEvaluated: 0,
  },
  {
    model: "fast",
    strengths: ["small-edits"],
    weaknesses: ["multi-file-refactor"],
    costPerTask: 0.005,
    p50LatencyMs: 2500,
    tasksEvaluated: 0,
  },
];

// trace:v1 id=impl.cli-state-models work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function loadModels(root?: string): ModelProfile[] {
  const path = join(stateDir(root), "models.json");
  const found = readJson<ModelProfile[] | null>(path, null);
  if (!Array.isArray(found)) {
    writeJson(path, DEFAULT_MODELS);
    return DEFAULT_MODELS.map((m) => ({ ...m }));
  }
  return found;
}

// trace:v1 id=impl.cli-state-models-save work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function saveModels(models: ModelProfile[], root?: string): void {
  writeJson(join(stateDir(root), "models.json"), models);
}

// trace:v1 id=impl.cli-state-evals work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function saveEvalResult(result: EvalResultSummary, root?: string): void {
  writeJson(join(stateDir(root), "evals", `${result.id}.json`), result);
}

// trace:v1 id=impl.cli-state-evals-list work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function listEvalResults(root?: string): EvalResultSummary[] {
  return readJson<EvalResultSummary[]>(join(stateDir(root), "evals-index.json"), []);
}

// trace:v1 id=impl.cli-state-evals-index work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function indexEvalResult(result: EvalResultSummary, root?: string): void {
  const dir = stateDir(root);
  const index = readJson<EvalResultSummary[]>(join(dir, "evals-index.json"), []);
  index.push(result);
  writeJson(join(dir, "evals-index.json"), index.slice(-20));
}
