"""seed-evolution: JSON contracts shared with the TS organism.

Purpose: single source for the cross-language record shapes (EvalCase,
ExperimentResult, PromotionDecision, FrictionLabel) so the Python GEPA loop
and the TS CLI/eval code agree byte-for-byte on field names. Why it exists:
the GEPA optimizer, dataset splitter, statistics gate, and TS eval runner
all read/write the same eval manifests — one module prevents silent drift.
Responsibilities: dataclass definitions with to_dict/from_dict roundtrips
and strict key validation. Invariants: stdlib only; no I/O; unknown keys
raise; every shape mirrors packages/seed-cli/src/state.ts. Public
functions/types: EvalCase, ExperimentResult, PromotionDecision,
FrictionLabel, parse_eval_case, format_eval_case.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field


# trace:v1 id=impl.py-protocol-evalcase work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
@dataclass(frozen=True)
class EvalCase:
    """One deterministic eval task manifest (mirrors TS EvalResultSummary inputs)."""

    id: str
    category: str
    repo_fixture: str
    prompt: str
    oracle_command: str
    timeout_ms: int = 300000
    network: bool = False

    # trace:v1 id=impl.py-protocol-evalcase-dict work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "category": self.category,
            "repoFixture": self.repo_fixture,
            "prompt": self.prompt,
            "oracleCommand": self.oracle_command,
            "timeoutMs": self.timeout_ms,
            "network": self.network,
        }

    # trace:v1 id=impl.py-protocol-evalcase-parse work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
    @staticmethod
    def from_dict(raw: dict) -> EvalCase:
        known = {"id", "category", "repoFixture", "prompt", "oracleCommand", "timeoutMs", "network"}
        unknown = set(raw) - known
        if unknown:
            raise ValueError(f"unknown EvalCase keys: {sorted(unknown)}")
        return EvalCase(
            id=str(raw["id"]),
            category=str(raw["category"]),
            repo_fixture=str(raw["repoFixture"]),
            prompt=str(raw["prompt"]),
            oracle_command=str(raw["oracleCommand"]),
            timeout_ms=int(raw.get("timeoutMs", 300000)),
            network=bool(raw.get("network", False)),
        )


# trace:v1 id=impl.py-protocol-experiment work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
@dataclass(frozen=True)
class ExperimentResult:
    """One task outcome inside an experiment (mirrors TS RunRecord)."""

    id: str
    at: str
    ok: bool
    score: float = 0.0
    cost: float = 0.0
    detail: str = ""

    # trace:v1 id=impl.py-protocol-experiment-dict work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
    def to_dict(self) -> dict:
        return asdict(self)


# trace:v1 id=impl.py-protocol-promotion work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
@dataclass(frozen=True)
class PromotionDecision:
    """Non-inferiority verdict for champion vs challenger."""

    non_inferior: bool
    detail: str
    baseline_rate: float = 0.0
    challenger_rate: float = 0.0


# trace:v1 id=impl.py-protocol-friction work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
@dataclass(frozen=True)
class FrictionLabel:
    """One deterministic friction label over a telemetry window."""

    kind: str
    session: str
    at: str
    evidence: dict = field(default_factory=dict)

    # trace:v1 id=impl.py-protocol-friction-dict work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
    def to_dict(self) -> dict:
        return asdict(self)


# trace:v1 id=impl.py-protocol-parse work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def parse_eval_case(raw: dict) -> EvalCase:
    return EvalCase.from_dict(raw)


# trace:v1 id=impl.py-protocol-format work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def format_eval_case(case: EvalCase) -> dict:
    return case.to_dict()
