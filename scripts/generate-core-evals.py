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
    "single-edit",
    "cross-file",
    "test-fix",
    "feature",
    "config",
    "navigation",
)

PER_CATEGORY = 10
TIMEOUT_MS = 300000


# trace:v1 id=impl.generate-core-evals-build work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def build_task(category: str, index: int, rng: random.Random) -> dict:
    """Build one task spec: stable id, prompt, and oracle body for its category."""
    seq = index + 1
    task_id = f"core-{category}-{seq:02d}"
    subjects = {
        "single-edit": ("off-by-one in pager", "fix the boundary in one file", "tests fail on last page"),
        "cross-file": ("renamed shared symbol", "fix every caller across files", "callers keep signatures"),
        "test-fix": ("failing retry test", "make the failing test pass", "failing test turns green"),
        "feature": ("csv export flag", "add the flag end to end across files", "flag appears in help"),
        "config": ("stale package config", "repair the package configuration", "commands match"),
        "navigation": ("buried symbol definition", "locate the symbol without editing", "symbol path reported"),
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
def fixture_files(task: dict) -> dict[str, str]:
    """Per-category broken fixture: real files the agent must repair with python."""
    category = task["category"]
    if category == "single-edit":
        return {
            "pager.py": (
                "PAGE_SIZE = 10\n\n"
                "def last_page(total):\n"
                "    return total // PAGE_SIZE  # BUG: off-by-one, drops the last partial page\n"
            ),
            "test_pager.py": (
                "from pager import last_page\n\n"
                "assert last_page(10) == 1, 'exact pages'\n"
                "assert last_page(11) == 2, 'partial page counts'\n"
                "assert last_page(0) == 0, 'empty'\n"
                "print('pager ok')\n"
            ),
        }
    if category == "cross-file":
        return {
            "symbols.py": "def fetch_user_v2(uid):\n    return {'id': uid}\n",
            "caller_a.py": "from symbols import fetch_user\n\nprint(fetch_user(1))\n",
            "caller_b.py": "from symbols import fetch_user\n\nprint(fetch_user(2))\n",
        }
    if category == "test-fix":
        return {
            "retry.py": (
                "def run_once(fail_times, state):\n"
                "    state['n'] += 1\n"
                "    if state['n'] <= fail_times:\n"
                "        raise RuntimeError('flaky')\n"
                "    return 'ok'\n\n"
                "def run_with_retry(fail_times):\n"
                "    state = {'n': 0}\n"
                "    return run_once(fail_times, state)  # BUG: never retries\n"
            ),
            "test_retry.py": (
                "from retry import run_with_retry\n\n"
                "assert run_with_retry(2) == 'ok', 'must survive 2 flakes'\n"
                "print('retry ok')\n"
            ),
        }
    if category == "feature":
        return {
            "cli.py": (
                "import sys\n\n"
                "def main(argv):\n"
                "    out = ['usage: export']\n"
                "    if '--csv' in argv:\n"
                "        out.append('format=csv')  # BUG: help never advertises --csv\n"
                "    return '\\n'.join(out) + '\\n'\n\n"
                "if __name__ == '__main__':\n"
                "    sys.stdout.write(main(sys.argv[1:]))\n"
            ),
            "test_cli.py": (
                "import subprocess, sys\n\n"
                "out = subprocess.run([sys.executable, 'cli.py', '--help'], capture_output=True, text=True).stdout\n"
                "assert '--csv' in out, 'help must advertise --csv'\n"
                "print('cli ok')\n"
            ),
        }
    if category == "config":
        return {
            "package.json": '{ "name": "demo", "scripts": { "oops": "nope" } }\n',
            "commands.txt": "build\ntest\n",
        }
    # navigation: report the definition path of TARGET_SYMBOL
    return {
        "pkg/__init__.py": "",
        "pkg/core.py": "def buried_symbol_definition():\n    return 42\n",
        "pkg/util.py": "from .core import buried_symbol_definition\n\nVALUE = buried_symbol_definition()\n",
        "TARGET_SYMBOL": "buried_symbol_definition\n",
    }


# trace:v1 id=impl.generate-core-evals-oracle2 work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def oracle_script(task: dict) -> str:
    """Executable oracle: per-category check that fails broken, passes repaired."""
    tid = task["id"]
    bodies = {
        "single-edit": 'python3 test_pager.py',
        "cross-file": (
            'python3 -c "import caller_a, caller_b"'
        ),
        "test-fix": 'python3 test_retry.py',
        "feature": 'python3 test_cli.py',
        "config": (
            'python3 -c "import json; m=json.load(open(\'package.json\')); '
            'cmds=open(\'commands.txt\').read().split(); '
            'assert all(c in m.get(\'scripts\',{}) for c in cmds), \'scripts missing\'"'
        ),
        "navigation": (
            'if ! test -f answer.txt; then echo "no answer.txt yet" >&2; exit 1; fi; grep -q "pkg/core.py" answer.txt && grep -q "buried_symbol_definition" answer.txt'
        ),
    }
    body = bodies[task["category"]]
    return f"""#!/bin/sh
# oracle for {tid}: fails on the broken fixture, passes after repair.
# Nothing outside this directory is read or written.
set -eu
cd "$(dirname "$0")"
{body}
echo "oracle ok {tid}"
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
                "prompt": task["prompt"] + " Work in the task directory; verify with ./oracle.sh before finishing.",
                "oracleCommand": "oracle.sh",
                "timeoutMs": TIMEOUT_MS,
                "network": False,
            }
            (task_dir / "task.json").write_text(json.dumps(manifest, indent=2) + "\n")
            oracle_path = task_dir / "oracle.sh"
            oracle_path.write_text(oracle_script(task))
            oracle_path.chmod(oracle_path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
            for name, content in fixture_files(task).items():
                dest = task_dir / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(content)
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
