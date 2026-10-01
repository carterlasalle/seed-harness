"""Tests for mechanism_search and the gepa CLI contract."""

import json
from pathlib import Path

from seed_evolution.gepa_optimizer import ALLOWED_TARGETS, main, optimize
from seed_evolution.mechanism_search import query_catalog, search_mechanisms

REPO_ROOT = Path(__file__).resolve().parents[3]


def test_allowed_targets_are_prompt_shaped_only():
    assert set(ALLOWED_TARGETS) == {
        "skill",
        "system-prompt-section",
        "tool-description",
        "routing-instruction",
    }
    try:
        optimize("arbitrary-ts", "/nonexistent", "/tmp/seed-gepa-nope.json")
    except ValueError:
        return
    raise AssertionError("arbitrary targets must be rejected")


def test_catalog_query_finds_gepa_paper():
    found = search_mechanisms("gepa", root=REPO_ROOT / "research")
    assert any(m.id == "gepa" for m in found)
    assert query_catalog("/nonexistent-dir") == []


def test_cli_help_and_optimize_cycle(tmp_path):
    try:
        main(["optimize", "--help"])
    except SystemExit as exc:
        assert exc.code == 0
    else:
        raise AssertionError("--help must exit 0")
    dataset = tmp_path / "corpus"
    for i in range(5):
        task = dataset / f"task-{i:02d}"
        task.mkdir(parents=True)
        (task / "task.json").write_text(json.dumps({"id": f"task-{i:02d}"}))
    out = tmp_path / "result.json"
    assert main(["optimize", "--target", "skill", "--dataset", str(dataset), "--output", str(out)]) == 0
    record = json.loads(out.read_text())
    assert record["holdoutScoredOnly"] is True
    assert len(record["holdout"]) >= 1
    assert record["candidate"]["parent"] == "base"
