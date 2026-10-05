#!/usr/bin/env node
// seed: single-binary CLI dispatcher over run/evolve/eval/capability/model/champion/research.
//
// Purpose: the `seed` entry point users and CI call. Why it exists:
// REQ-SEED-EZPD6B85 acceptance names every command below — help must list
// all of them and each must reach real logic, not stubs. Responsibilities:
// argv parsing, usage text, JSON/plain output, exit codes (0 ok, 1 usage or
// check failure, 2 runtime error). Invariants: stdlib only; every command
// resolves SEED_ROOT from cwd; `help` lists all commands. Public
// functions/types: main, COMMANDS.

import { showCapability, discoverCapabilities } from "./capabilities.ts";
import type { CapabilityManifest } from "./capabilities.ts";
import { runDoctor } from "./doctor.ts";
import { runTask } from "./run.ts";
import { evolveRun, evolveStatus, queueExperiment } from "./evolve.ts";
import { compareEvals, runEval, smokeEval } from "./eval.ts";
import { listEvalResults, loadQueue, recentRuns } from "./state.ts";
import type { EvalResultSummary, ModelProfile, RunRecord } from "./state.ts";
import { listModels, profileModel } from "./models.ts";
import { championHistory, rollbackChampion, showChampion } from "./champion.ts";
import { refreshResearch } from "./research.ts";
import { validateSchemas } from "./schema.ts";

// trace:exempt reason=internal-detail
export const COMMANDS = [
  "run <prompt>",
  "status",
  "doctor",
  "capabilities list",
  "capabilities show <name>",
  "evolve status",
  "evolve queue <task>",
  "evolve run [--limit N]",
  "eval run [--limit N]",
  "eval compare <baseline-id> <challenger-id>",
  "eval smoke",
  "model list",
  "model profile <name>",
  "model probe [model]",
  "champion show",
  "champion history",
  "champion rollback <ref> [--reason TEXT]",
  "research refresh",
  "schema validate",
  "help",
] as const;

// trace:exempt reason=internal-detail
const USAGE = `seed — self-evolving harness CLI

usage: seed <command> [args]

commands:
  run <prompt>                    run one task (champion pinned, caps ranked)
  status                          queue depth + recent runs
  doctor                          dependency/state checks (nonzero on failure)
  capabilities list               list capability manifests
  capabilities show <name>        show one manifest
  evolve status                   queued experiments + recent runs
  evolve queue <task>             enqueue an experiment task
  evolve run [--limit N]          drain up to N queued tasks (default 3)
  eval run [--limit N]            run generated corpus oracles
  eval compare <base> <chall>     non-inferiority compare of two eval results
  eval smoke                      fast 2-task subset for CI
  model list                      list model profiles
  model profile <name>            show one model profile
  model probe [model]             probe a model and persist its profile
  champion show                   show champion pointer
  champion history                show champion history
  champion rollback <ref>         rollback champion to ref
  research refresh                revalidate research catalogs
  schema validate                 validate schemas + manifests (static gate)
  help                            this text
`;

// trace:v1 id=impl.cli-main work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
export async function main(argv: string[]): Promise<number> {
  const [command, sub, ...rest] = argv;
  const json = argv.includes("--json");
  const args = argv.filter((a) => a !== "--json");
  // trace:exempt reason=internal-detail
  const emit = (value: unknown): void => {
    if (json) console.log(JSON.stringify(value, null, 2));
    else if (typeof value === "string") console.log(value);
    else console.log(JSON.stringify(value, null, 2));
  };
  try {
    // trace:exempt reason=internal-detail
    switch (command) {
      case "run": {
        if (!sub) {
          console.error("usage: seed run <prompt>");
          return 1;
        }
        // trace:exempt reason=internal-detail
        const prompt = args.slice(1).join(" ");
        const record = await runTask(prompt, {});
        emit(record.ok ? `ok ${record.id} ${record.detail.split(" ")[0]}` : `failed ${record.id}: ${record.detail}`);
        return record.ok ? 0 : 1;
      }
      case "status": {
        // trace:exempt reason=internal-detail
        const status = evolveStatus();
        const queue = loadQueue();
        const recent = recentRuns(5);
        emit({ queued: status.queued, queue, recent: recent.map((r: RunRecord) => ({ id: r.id, ok: r.ok, prompt: r.prompt.slice(0, 80) })) });
        return 0;
      }
      case "doctor": {
        // trace:exempt reason=internal-detail
        const report = await runDoctor();
        if (json) {
          emit(report);
        } else {
          for (const check of report.checks) {
            console.log(`${check.ok ? "ok" : "FAIL"} ${check.name}: ${check.detail}`);
          }
        }
        return report.ok ? 0 : 1;
      }
      case "capabilities": {
        // trace:exempt reason=internal-detail
        if (sub === "list" || !sub) {
          const caps = discoverCapabilities();
          emit(caps.map((c: CapabilityManifest) => `${c.name}@${c.version} [${(c.tools ?? []).join(",")}] ${c.description ?? ""}`.trim()).join("\n"));
          return 0;
        }
        if (sub === "show") {
          // trace:exempt reason=internal-detail
          const manifest = showCapability(rest[0] ?? "");
          if (!manifest) {
            console.error(`unknown capability: ${rest[0] ?? ""}`);
            return 1;
          }
          emit(manifest);
          return 0;
        }
        console.error("usage: seed capabilities <list|show NAME>");
        return 1;
      }
      case "evolve": {
        // trace:exempt reason=internal-detail
        if (sub === "status" || !sub) {
          emit(evolveStatus());
          return 0;
        }
        if (sub === "queue") {
          const task = rest.join(" ");
          // trace:exempt reason=internal-detail
          if (!task) {
            console.error("usage: seed evolve queue <task>");
            return 1;
          }
          emit({ queued: queueExperiment(task) });
          return 0;
        }
        // trace:exempt reason=internal-detail
        if (sub === "run") {
          const limitFlag = rest.indexOf("--limit");
          const limit = limitFlag >= 0 ? Number(rest[limitFlag + 1]) : 3;
          const result = await evolveRun(Number.isFinite(limit) ? limit : 3);
          emit(result);
          return 0;
        }
        console.error("usage: seed evolve <status|queue|run>");
        return 1;
      }
      case "eval": {
        // trace:exempt reason=internal-detail
        if (sub === "run" || !sub) {
          const limitFlag = rest.indexOf("--limit");
          const limit = limitFlag >= 0 ? Number(rest[limitFlag + 1]) : undefined;
          const modelFlag = rest.indexOf("--model");
          const model = modelFlag >= 0 ? rest[modelFlag + 1] : undefined;
          const turnsFlag = rest.indexOf("--max-turns");
          const maxTurns = turnsFlag >= 0 ? Number(rest[turnsFlag + 1]) : undefined;
          emit(await runEval({
            limit: Number.isFinite(limit) ? limit : undefined,
            model,
            maxTurns: Number.isFinite(maxTurns) ? maxTurns : undefined,
            holdout: rest.includes("--holdout"),
            replay: rest.includes("--replay"),
            crossModel: rest.includes("--cross-model") ? rest.filter((a) => a.includes("/")).slice(0, 3) : undefined,
          }));
          return 0;
        }
        // trace:exempt reason=internal-detail
        if (sub === "smoke") {
          const summary = smokeEval();
          emit(summary);
          return summary.failed > 0 ? 1 : 0;
        }
        if (sub === "compare") {
          const [baselineId, challengerId] = rest;
          // trace:exempt reason=internal-detail
          const results = listEvalResults();
          const baseline = results.find((r: EvalResultSummary) => r.id === baselineId);
          const challenger = results.find((r: EvalResultSummary) => r.id === challengerId);
          if (!baseline || !challenger) {
            console.error("both eval ids must exist in the eval index");
            return 1;
          }
          // trace:exempt reason=internal-detail
          const verdict = compareEvals(baseline, challenger);
          emit(verdict);
          return verdict.nonInferior ? 0 : 1;
        }
        console.error("usage: seed eval <run|smoke|compare BASE CHALLENGER>");
        return 1;
      }
      case "model": {
        // trace:exempt reason=internal-detail
        if (sub === "list" || !sub) {
          emit(listModels().map((m: ModelProfile) => `${m.model} tasks=${m.tasksEvaluated} cost=${m.costPerTask} p50=${m.p50LatencyMs}ms`));
          return 0;
        }
        if (sub === "profile") {
          const found = profileModel(rest[0] ?? "");
          // trace:exempt reason=internal-detail
          if (!found) {
            console.error(`unknown model: ${rest[0] ?? ""}`);
            return 1;
          }
          emit(found);
          return 0;
        }
        if (sub === "probe") {
          const { probeModel } = await import("./models.ts");
          const { completeModelTurn } = await import("@carterlasalle/seed-runtime/dist/model-client.js");
          const name = rest[0] ?? process.env.SEED_MODEL ?? "anthropic/claude-sonnet-4";
          const record = await probeModel(name, async (prompt, model) => {
            // trace:exempt reason=internal-detail
            const startedAt = Date.now();
            // trace:exempt reason=internal-detail
            const turn = await completeModelTurn({ model, system: prompt, messages: [{ role: "user", content: prompt }] });
            return { success: turn.text.length > 0, latencyMs: Date.now() - startedAt, tokens: turn.inputTokens + turn.outputTokens, costUsd: 0 };
          });
          emit(record);
          return 0;
        }
        console.error("usage: seed model <list|profile NAME|probe [MODEL]>");
        return 1;
      }
      case "champion": {
        // trace:exempt reason=internal-detail
        if (sub === "show" || !sub) {
          emit(await showChampion());
          return 0;
        }
        if (sub === "history") {
          emit(await championHistory());
          return 0;
        }
        // trace:exempt reason=internal-detail
        if (sub === "rollback") {
          const ref = rest[0];
          if (!ref) {
            console.error("usage: seed champion rollback <ref> [--reason TEXT]");
            return 1;
          }
          // trace:exempt reason=internal-detail
          const reasonFlag = rest.indexOf("--reason");
          const reason = reasonFlag >= 0 ? rest.slice(reasonFlag + 1).join(" ") : "manual rollback";
          emit(await rollbackChampion(ref, reason));
          return 0;
        }
        console.error("usage: seed champion <show|history|rollback REF>");
        return 1;
      }
      case "schema": {
        // trace:exempt reason=internal-detail
        if (sub === "validate" || !sub) {
          const report = validateSchemas();
          if (json) {
            emit(report);
          } else if (report.ok) {
            console.log(`schemas ok (${report.schemas.length} schemas, ${report.manifests} manifests)`);
          } else {
            for (const bad of report.badSchemas) console.log(`FAIL schema: ${bad}`);
            for (const bad of report.badManifests) console.log(`FAIL manifest: ${bad}`);
          }
          return report.ok ? 0 : 1;
        }
        console.error("usage: seed schema validate");
        return 1;
      }
      case "research": {
        // trace:exempt reason=internal-detail
        if (sub === "refresh" || !sub) {
          if (rest.includes("--live")) {
            const { refreshResearchLive } = await import("./research.ts");
            const report = await refreshResearchLive({ github: [{ owner: "earendil-works", repo: "pi" }], arxiv: [] });
            emit(report.ok ? report.output : `FAILED\n${report.output}`);
            return report.ok ? 0 : 1;
          }
          const report = refreshResearch();
          emit(report.ok ? report.output : `FAILED\n${report.output}`);
          return report.ok ? 0 : 1;
        }
        console.error("usage: seed research refresh [--live]");
        return 1;
      }
      case "help":
      case "--help":
      case "-h":
      case undefined: {
        console.log(USAGE);
        return 0;
      }
      default: {
        console.error(`unknown command: ${command}\n\n${USAGE}`);
        return 1;
      }
    }
  } catch (error) {
    console.error(`seed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

// trace:exempt reason=internal-detail
const invoked = process.argv[1] !== undefined && /(packages\/seed-cli\/(src\/cli\.ts|dist\/cli\.js)|\.bin\/seed|seed-cli\/(dist\/cli\.js|bin\/seed))$/.test(process.argv[1]);
if (invoked) {
  // Stale-while-revalidate: synchronous cache read first so the notice
  // always lands before process.exit; background refresh stays detached.
  // Never blocks on network, never throws, honors SEED_NO_UPDATE_CHECK=1.
  try {
    const { checkCachedUpdate } = await import("./update-check.ts");
    const notice = checkCachedUpdate("0.1.0");
    if (notice) console.error(`seed: update available — ${notice}`);
  } catch {
    // A broken cache must never break the CLI.
  }
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`seed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(2);
    },
  );
}
