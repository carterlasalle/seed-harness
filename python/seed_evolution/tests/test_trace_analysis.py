"""Tests for trace_analysis: each friction rule fires on a crafted stream."""

from seed_evolution.trace_analysis import analyze_traces


def test_each_rule_fires():
    events = [
        {"timestamp": "2026-10-01T00:00:00Z", "session": "s1", "payload": {}},
        {"timestamp": "2026-10-01T00:30:00Z", "session": "s1", "payload": {}},
        {"timestamp": "2026-10-01T01:00:00Z", "session": "s2", "payload": {"file": "a.ts"}},
        {"timestamp": "2026-10-01T01:01:00Z", "session": "s2", "payload": {"file": "a.ts"}},
        {"timestamp": "2026-10-01T01:02:00Z", "session": "s2", "payload": {"file": "a.ts"}},
    ]
    for _ in range(3):
        events.append(
            {"timestamp": "2026-10-01T02:00:00Z", "session": "s3", "payload": {"tool": "echo", "failed": True}}
        )
    events.extend(
        {"timestamp": "2026-10-01T03:00:00Z", "session": "s4", "payload": {"cost": 0.5}} for _ in range(3)
    )
    kinds = {label["kind"] for label in analyze_traces(events)}
    assert {"stall", "thrash", "tool-loop", "budget-burn"} <= kinds


def test_malformed_events_are_skipped():
    assert analyze_traces([{}, {"session": "x"}, {"timestamp": "not-a-time", "session": "x"}]) == []
