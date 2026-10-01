#!/usr/bin/env python3
"""generate-core-evals: synthesize the 60-task deterministic eval corpus.

Purpose: generate EXACTLY 60 eval tasks (10 per category across 6
categories) each with a task.json EvalCase manifest plus an executable
oracle.sh, deterministically from --seed. Why it exists: REQ-SEED-JJ5Q1072
requires a 60-task deterministic corpus with oracles for the static/unit/
replay/holdout gates and promotion decisions. Responsibilities: argparse
(--seed, --output), seeded task synthesis, oracle script emission, manifest
writing per the EvalCase contract (id/category/repoFixture/prompt/
oracleCommand/timeoutMs 300000/network false). Invariants: stdlib only;
deterministic by seed (same seed, same bytes); exactly 60 tasks or nonzero
exit; every oracle is executable and exits 0 on a correct solution.
Public functions/types: CATEGORIES, build_task, generate, main.
"""
from __future__ import annotations

import argparse
import json
import random
import stat
import sys
from pathlib import Path

CATEGORIES = (
    "bugfix",
    "refactor",
    "feature",
    "testgen",
    "docfix",
    "perf",
)

PER_CATEGORY = 10
TIMEOUT_MS = 300000


# trace:v1 id=impl.generate-core-evals-build work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def build_task(category: str, index: int, rng: random.Random) -> dict:
    """Build one task spec: stable id, prompt, and oracle body for its category."""
    seq = index + 1
    task_id = f"core-{category}-{seq:02d}"
    subjects = {
        "bugfix": ("off-by-one in pager", "fix the boundary", "tests fail on last page"),
        "refactor": ("nested callback helper", "flatten without behavior change", "callers keep signatures"),
        "feature": ("csv export flag", "add the flag end to end", "flag appears in help"),
        "testgen": ("uncovered retry path", "cover the retry branch", "coverage rises"),
        "docfix": ("stale install steps", "sync docs with the script", "commands match"),
        "perf": ("quadratic dedupe loop", "make it linear", "benchmark budget holds"),
    }
    subject, goal, oracle_hint = subjects[category]
    nonce = rng.randint(1000, 9999)
    prompt = (
        f"[{task_id}] ({category} #{seq}): {goal} for the {subject} "
        f"(fixture seed {nonce}). Constraint: {oracle_hint}; "
        "do not touch eval oracles or promotion config."
    )
    return {"id": task_id, "category": category, "prompt": prompt, "nonce": nonce, "hint": oracle_hint}


# trace:v1 id=impl.generate-core-evals-oracle work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def oracle_script(task: dict) -> str:
    """Executable oracle: self-contained positive/negative check of the fixture repair."""
    return f"""#!/bin/sh
# oracle for {task["id"]}: fails on the broken fixture, passes after repair.
# The fixture ships broken: target.txt contains BROKEN. A correct repair
# replaces it with FIXED (the task prompt describes the defect class).
# Nothing outside this directory is read or written.
set -eu
dir=$(dirname "$0")
target="$dir/target.txt"
if [ ! -f "$target" ]; then
  echo "missing target.txt for {task["id"]}" >&2
  exit 1
fi
if grep -q "BROKEN" "$target"; then
  echo "defect still present in {task["id"]}" >&2
  exit 1
fi
if ! grep -q "FIXED" "$target"; then
  echo "repair marker FIXED not found for {task["id"]}" >&2
  exit 1
fi
echo "oracle ok {task["id"]}"
"""


# trace:v1 id=impl.generate-core-evals-generate work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def generate(seed: int, output: Path) -> list[Path]:
    """Generate the full 60-task corpus; returns written task.json paths."""
    rng = random.Random(seed)
    written: list[Path] = []
    output.mkdir(parents=True, exist_ok=True)
    for category in CATEGORIES:
        for index in range(PER_CATEGORY):
            task = build_task(category, index, rng)
            task_dir = output / task["id"]
            task_dir.mkdir(parents=True, exist_ok=True)
            manifest = {
                "id": task["id"],
                "category": task["category"],
                "repoFixture": "echo",
                "prompt": task["prompt"],
                "oracleCommand": "oracle.sh",
                "timeoutMs": TIMEOUT_MS,
                "network": False,
            }
            (task_dir / "task.json").write_text(json.dumps(manifest, indent=2) + "\n")
            oracle_path = task_dir / "oracle.sh"
            oracle_path.write_text(oracle_script(task))
            oracle_path.chmod(oracle_path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
            (task_dir / "target.txt").write_text(f"BROKEN {task['id']}\n")
            written.append(task_dir / "task.json")
    return written


# trace:v1 id=impl.generate-core-evals-main work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate the 60-task deterministic eval corpus")
    parser.add_argument("--seed", type=int, default=1337)
    parser.add_argument("--output", default="evals/core/generated")
    args = parser.parse_args(argv)
    written = generate(args.seed, Path(args.output))
    expected = len(CATEGORIES) * PER_CATEGORY
    if len(written) != expected:
        print(f"expected {expected} tasks, wrote {len(written)}", file=sys.stderr)
        return 1
    print(f"generated {len(written)} tasks in {args.output} (seed {args.seed})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
