"""seed-evolution trace analysis: friction features mirroring the TS lab rules.

Purpose: pure functions over telemetry event streams producing friction
labels (stall, thrash, tool-loop, budget-burn) for clustering and the
scientist. Why it exists: friction rules are guardian-side deterministic
code — the Python mirror lets GEPA reflect on traces in natural language
using the same vocabulary. Responsibilities: per-rule detectors plus one
analyze() fan-out. Invariants: stdlib only; pure (events in, labels out);
never raises on malformed events (skips them). Public functions/types:
stall_events, thrash_files, tool_loops, budget_burn, analyze_traces.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from itertools import pairwise

STALL_MINUTES = 10
THRASH_EDITS = 3
TOOL_LOOP_REPEATS = 3


# trace:v1 id=impl.py-trace-stall work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def _parse_time(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value).astimezone(UTC)
    except (ValueError, AttributeError):
        return None


# trace:v1 id=impl.py-trace-stallfn work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def stall_events(events: list[dict], minutes: int = STALL_MINUTES) -> list[dict]:
    """Sessions whose progress gap exceeds `minutes` between consecutive events."""
    by_session: dict[str, list[datetime]] = {}
    for event in events:
        stamp = _parse_time(str(event.get("timestamp", "")))
        session = str(event.get("session", ""))
        if stamp is None or not session:
            continue
        by_session.setdefault(session, []).append(stamp)
    labels = []
    for session, stamps in by_session.items():
        stamps.sort()
        for prev, current in pairwise(stamps):
            if current - prev >= timedelta(minutes=minutes):
                labels.append(
                    {"kind": "stall", "session": session, "gapMinutes": (current - prev).total_seconds() / 60.0}
                )
                break
    return labels


# trace:v1 id=impl.py-trace-thrash work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def thrash_files(events: list[dict], threshold: int = THRASH_EDITS) -> list[dict]:
    """Files edited >= threshold times within one session."""
    counts: dict[tuple[str, str], int] = {}
    for event in events:
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        path = payload.get("file") or payload.get("path")
        session = str(event.get("session", ""))
        if not path or not session:
            continue
        key = (session, str(path))
        counts[key] = counts.get(key, 0) + 1
    return [
        {"kind": "thrash", "session": session, "file": path, "edits": n}
        for (session, path), n in counts.items()
        if n >= threshold
    ]


# trace:v1 id=impl.py-trace-toomloop work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def tool_loops(events: list[dict], repeats: int = TOOL_LOOP_REPEATS) -> list[dict]:
    """Same failing tool call repeated >= repeats times in a row."""
    labels = []
    run: list[dict] = []
    for event in events:
        raw_payload = event.get("payload")
        payload: dict = raw_payload if isinstance(raw_payload, dict) else {}
        call = str(payload.get("tool", "") or payload.get("method", ""))
        failed = bool(payload.get("error") or payload.get("failed"))
        if call and failed and run and run[-1].get("call") == call:
            run.append({"call": call, "session": str(event.get("session", ""))})
        elif call and failed:
            run = [{"call": call, "session": str(event.get("session", ""))}]
        else:
            run = []
        if len(run) >= repeats:
            labels.append({"kind": "tool-loop", "session": run[-1]["session"], "tool": call, "repeats": len(run)})
            run = []
    return labels


# trace:v1 id=impl.py-trace-budget work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def budget_burn(events: list[dict], cost_per_event: float = 0.01, budget: float = 1.0) -> list[dict]:
    """Sessions whose accumulated cost meets the budget line."""
    totals: dict[str, float] = {}
    for event in events:
        raw_budget_payload = event.get("payload")
        budget_payload: dict = raw_budget_payload if isinstance(raw_budget_payload, dict) else {}
        try:
            cost = float(budget_payload.get("cost", cost_per_event))
        except (TypeError, ValueError):
            cost = cost_per_event
        session = str(event.get("session", ""))
        if session:
            totals[session] = totals.get(session, 0.0) + cost
    return [
        {"kind": "budget-burn", "session": session, "spent": spent}
        for session, spent in totals.items()
        if spent >= budget
    ]


# trace:v1 id=impl.py-trace-analyze work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def analyze_traces(events: list[dict]) -> list[dict]:
    """Run every friction rule over one event stream."""
    return stall_events(events) + thrash_files(events) + tool_loops(events) + budget_burn(events)
