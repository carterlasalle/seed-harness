// seed-cli eval: deterministic corpus runs and champion/challenger compare.
//
// Purpose: `seed eval run|compare` plus the fast `seed eval smoke` subset run
// by CI. Why it exists: REQ-SEED-EZPD6B85 needs eval commands backed by real
// execution over evals/core/generated — smoke runs 2 tasks fast, full runs
// cover every task with its oracle. Responsibilities: discover generated
// tasks, execute each oracle with timeout, persist results, compare two
// result sets for non-inferiority. Invariants: oracles run with timeoutMs
// capped at the manifest value (default 300000); results always persisted;
// compare is pure. Public functions/types: EvalRunOptions, EvalRunSummary,
// runEval, smokeEval, compareEvals.

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { indexEvalResult, listEvalResults, saveEvalResult, seedRoot } from "./state.ts";
import type { EvalResultSummary } from "./state.ts";
import { runOrganismTask } from "@carterlasalle/seed-runtime/dist/organism.js";
import { guardianSocketPath as defaultSocketPath, withGuardian } from "./guardian.ts";

export interface EvalRunOptions {
  limit?: number;
  root?: string;
  suite?: string;
  model?: string;
  maxTurns?: number;
  holdout?: boolean;
  replay?: boolean;
  crossModel?: string[];
}

// trace:v1 id=impl.cli-eval-repair work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
function applyReferenceRepair(dir: string): boolean {
  if (existsSync(join(dir, "pager.py"))) {
    const pager = join(dir, "pager.py");
    writeFileSync(pager, readFileSync(pager, "utf8").replace("return total // PAGE_SIZE", "return (total + PAGE_SIZE - 1) // PAGE_SIZE"));
    return true;
  }
  if (existsSync(join(dir, "symbols.py"))) {
    writeFileSync(join(dir, "symbols.py"), "def fetch_user(uid):\n    return {'id': uid}\n");
    return true;
  }
  if (existsSync(join(dir, "retry.py"))) {
    const retry = join(dir, "retry.py");
    writeFileSync(retry, readFileSync(retry, "utf8").replace("return run_once(fail_times, state)", "for _ in range(fail_times + 1):\n        try:\n            return run_once(fail_times, state)\n        except RuntimeError:\n            continue\n    raise RuntimeError('flaky')"));
    return true;
  }
  if (existsSync(join(dir, "cli.py"))) {
    const cli = join(dir, "cli.py");
    writeFileSync(cli, readFileSync(cli, "utf8").replace("out = ['usage: export']", "out = ['usage: export [--csv]']"));
    return true;
  }
  if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "commands.txt"))) {
    const pkgPath = join(dir, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
    const cmds = readFileSync(join(dir, "commands.txt"), "utf8").split(/\s+/).filter(Boolean);
    pkg.scripts = Object.fromEntries(cmds.map((c) => [c, `echo ${c}`]));
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    return true;
  }
  if (existsSync(join(dir, "TARGET_SYMBOL"))) {
    const target = readFileSync(join(dir, "TARGET_SYMBOL"), "utf8").trim().split(/\s+/).filter(Boolean);
    writeFileSync(join(dir, "answer.txt"), `symbol ${target[0] ?? "buried_symbol_definition"} defined at pkg/core.py\n`);
    return true;
  }
  return false;
}


// trace:v1 id=impl.cli-eval-case work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export async function runEvalCase(dir: string, options: { model?: string; maxTurns?: number } = {}): Promise<{ passed: boolean; detail: string }> {
  const manifest = JSON.parse(readFileSync(join(dir, "task.json"), "utf8")) as {
    prompt?: string;
    oracleCommand?: string;
    timeoutMs?: number;
  };
  // trace:exempt reason=internal-detail
  const oracle = typeof manifest.oracleCommand === "string" && manifest.oracleCommand ? manifest.oracleCommand : "oracle.sh";
  // trace:exempt reason=internal-detail
  const timeoutMs = typeof manifest.timeoutMs === "number" && manifest.timeoutMs > 0 ? Math.min(manifest.timeoutMs, 300000) : 300000;
  // trace:exempt reason=internal-detail
  const work = mkdtempSync(join(tmpdir(), "seed-eval-"));
  try {
    cpSync(dir, work, { recursive: true });
    // The client is scoped to the agent run: `loop` is the only thing needed
    // afterwards, and the connection must not outlive the work it drives.
    // trace:exempt reason=internal-detail
    const loop = await withGuardian({ socketPath: defaultSocketPath(), connectTimeoutMs: 5000 }, async (client) => {
      // trace:exempt reason=internal-detail
      const organism = await runOrganismTask({ client, workspace: work, taskBrief: manifest.prompt ?? dir, sessionId: `eval-${Date.now().toString(36)}` });
      // trace:exempt reason=internal-detail
      const run = await organism.runAgentLoop({ model: options.model, maxTurns: options.maxTurns ?? 12 });
      await organism.end(run.done && run.turns.length > 0 ? "done" : "failed", run.summary.slice(0, 500));
      return run;
    });
    // trace:exempt reason=internal-detail
    const child = spawnSync("sh", [join(work, oracle)], { encoding: "utf8", timeout: timeoutMs, cwd: work });
    if (child.error || child.status !== 0) {
      return { passed: false, detail: `agent ran ${loop.turns.length} turns; oracle failed${child.error ? ` (${child.error.message})` : ` (exit ${child.status})`}` };
    }
    return { passed: true, detail: `agent ran ${loop.turns.length} turns; oracle passed` };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// trace:v1 id=impl.cli-eval-run work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export async function runEval(options: EvalRunOptions = {}): Promise<EvalResultSummary> {
  const root = options.root;
  const generated = join(seedRoot(root), "evals", "core", "generated");
  let dirs: string[] = [];
  try {
    dirs = readdirSync(generated, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    dirs = [];
  }
  // trace:exempt reason=internal-detail
  if (options.holdout) dirs = dirs.filter((_, i) => i % 5 === 4);
  // Replay: re-run the failing dirs from the most recent stored eval result
  // first so regressions surface before fresh tasks consume budget.
  // trace:exempt reason=internal-detail
  if (options.replay) {
    // trace:exempt reason=internal-detail
    const prior = listEvalResults(root).at(-1);
    // trace:exempt reason=internal-detail
    const failedDirs = new Set((prior?.failures ?? []).map((f: string) => f.split("@")[0]?.split(":")[0]).filter(Boolean));
    if (failedDirs.size > 0) dirs = [...dirs].sort((a, b) => Number(failedDirs.has(b)) - Number(failedDirs.has(a)));
  }
  // trace:exempt reason=internal-detail
  const models = options.crossModel?.length ? options.crossModel : [options.model ?? process.env.SEED_MODEL ?? "anthropic/claude-sonnet-4"];
  // trace:exempt reason=internal-detail
  const failures: string[] = [];
  // trace:exempt reason=internal-detail
  let passed = 0;
  for (const model of models) {
    for (const dir of dirs) {
      const manifestPath = join(generated, dir, "task.json");
      if (!existsSync(manifestPath)) {
        failures.push(`${dir}@${model}: missing task.json`);
        continue;
      }
      try {
        // trace:exempt reason=internal-detail
        const result = await runEvalCase(join(generated, dir), { model, maxTurns: options.maxTurns });
        if (result.passed) passed += 1;
        else failures.push(`${dir}@${model}: ${result.detail}`);
      } catch (error) {
        failures.push(`${dir}@${model}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  // trace:exempt reason=internal-detail
  const total = dirs.length * models.length;
  // trace:exempt reason=internal-detail
  const id =
    options.suite === "smoke"
      ? `smoke-${Date.now().toString(36)}`
      : `eval-${Date.now().toString(36)}`;
  const summary: EvalResultSummary = {
    id,
    at: new Date().toISOString(),
    suite: options.suite ?? "core",
    total,
    passed,
    failed: failures.length,
    failures,
  };
  // trace:exempt reason=internal-detail
  saveEvalResult(summary, root);
  indexEvalResult(summary, root);
  return summary;
}

// trace:v1 id=impl.cli-eval-smoke work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function smokeEval(root?: string): EvalResultSummary {
  // Smoke proves the oracle contract end to end on scratch copies: fail on the
  // shipped broken fixture, apply the reference repair, then pass. Generated
  // corpus dirs stay broken so `eval run` keeps measuring real repairs.
  const seed = seedRoot(root);
  const generated = join(seed, "evals", "core", "generated");
  // trace:exempt reason=internal-detail
  const candidates = readdirSync(generated, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const withRepair = candidates.filter((d) => ["pager.py", "symbols.py", "retry.py", "cli.py", "package.json", "TARGET_SYMBOL"].some((f) => existsSync(join(generated, d, f))));
  const dirs = (withRepair.length >= 2 ? withRepair : candidates).slice(0, 2);
  // trace:exempt reason=internal-detail
  const failures: string[] = [];
  // trace:exempt reason=internal-detail
  let passed = 0;
  for (const dir of dirs) {
    // trace:exempt reason=internal-detail
    const work = mkdtempSync(join(tmpdir(), `seed-smoke-${dir}-`));
    try {
      // trace:exempt reason=internal-detail
      cpSync(join(generated, dir), join(work, dir), { recursive: true });
      // trace:exempt reason=internal-detail
      const before = spawnSync("sh", [join(work, dir, "oracle.sh")], { encoding: "utf8" });
      if (before.status === 0) {
        failures.push(`${dir}: oracle passed on broken fixture (expected failure)`);
        continue;
      }
      // trace:exempt reason=internal-detail
      const fixed = applyReferenceRepair(join(work, dir));
      if (!fixed) {
        failures.push(`${dir}: no reference repair available for this fixture`);
        continue;
      }
      // trace:exempt reason=internal-detail
      const after = spawnSync("sh", [join(work, dir, "oracle.sh")], { encoding: "utf8" });
      if (after.error || after.status !== 0) {
        failures.push(`${dir}: oracle failed after repair (exit ${after.status})`);
      } else {
        passed += 1;
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  // trace:exempt reason=internal-detail
  const summary: EvalResultSummary = {
    id: `smoke-${Date.now().toString(36)}`,
    at: new Date().toISOString(),
    suite: "smoke",
    total: dirs.length,
    passed,
    failed: failures.length,
    failures,
  };
  // trace:exempt reason=internal-detail
  saveEvalResult(summary, root);
  // trace:exempt reason=internal-detail
  indexEvalResult(summary, root);
  return summary;
}

// trace:v1 id=impl.cli-eval-compare work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export function compareEvals(
  baseline: EvalResultSummary,
  challenger: EvalResultSummary,
): { nonInferior: boolean; detail: string } {
  const baseRate = baseline.total === 0 ? 0 : baseline.passed / baseline.total;
  const challRate = challenger.total === 0 ? 0 : challenger.passed / challenger.total;
  // trace:exempt reason=internal-detail
  const newFailures = challenger.failures.filter((f: string) => {
    const name = f.split(":")[0];
    return !baseline.failures.some((b: string) => b.startsWith(`${name}:`) || b === f);
  });
  const nonInferior = challRate >= baseRate && newFailures.length === 0;
  return {
    nonInferior,
    detail:
      `baseline ${baseline.passed}/${baseline.total} vs challenger ${challenger.passed}/${challenger.total}` +
      (newFailures.length > 0 ? `; new failures: ${newFailures.join("; ")}` : "; no new failures"),
  };
}
