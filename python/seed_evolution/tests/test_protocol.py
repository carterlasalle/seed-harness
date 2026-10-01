"""Tests for protocol: EvalCase camelCase roundtrip, strict keys."""

from seed_evolution.protocol import EvalCase, format_eval_case, parse_eval_case


def test_eval_case_roundtrip_uses_camel_case_keys():
    case = EvalCase(
        id="core-001",
        category="bugfix",
        repo_fixture="echo",
        prompt="do it",
        oracle_command="oracle.sh",
    )
    raw = format_eval_case(case)
    assert raw["repoFixture"] == "echo"
    assert raw["oracleCommand"] == "oracle.sh"
    assert raw["timeoutMs"] == 300000
    assert raw["network"] is False
    assert parse_eval_case(raw) == case


def test_eval_case_rejects_unknown_keys():
    raw = {
        "id": "x",
        "category": "y",
        "repoFixture": "echo",
        "prompt": "p",
        "oracleCommand": "oracle.sh",
        "surprise": 1,
    }
    try:
        parse_eval_case(raw)
    except ValueError:
        return
    raise AssertionError("unknown keys must raise")
