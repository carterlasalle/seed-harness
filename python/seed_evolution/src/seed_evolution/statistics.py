"""seed-evolution statistics: non-inferiority gate plus Pareto comparison.

Purpose: decide whether a challenger may promote over the champion without
regressing any axis. Why it exists: promotion needs non-inferiority plus
Pareto gain (docs/EVALUATION.md) — a pure function both the CLI compare and
the GEPA loop call. Responsibilities: pass-rate confidence intervals
(Wilson), non-inferiority verdict with a meaningful margin, Pareto
dominance check over score/cost axes. Invariants: stdlib only (math);
pure functions, no I/O; empty inputs yield defined (failing) verdicts.
Public functions/types: wilson_interval, non_inferior, pareto_dominates,
promotion_verdict.
"""

from __future__ import annotations

import math

MEANINGFUL_MARGIN = 0.05


# trace:v1 id=impl.py-statistics-wilson work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def wilson_interval(passed: int, total: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval for a pass rate; empty input yields (0, 1)."""
    if total <= 0 or passed < 0 or passed > total:
        return (0.0, 1.0)
    if total == 0:
        return (0.0, 1.0)
    p = passed / total
    denom = 1.0 + z * z / total
    center = (p + z * z / (2.0 * total)) / denom
    half = z * math.sqrt(p * (1.0 - p) / total + z * z / (4.0 * total * total)) / denom
    return (max(0.0, center - half), min(1.0, center + half))


# trace:v1 id=impl.py-statistics-noninferior work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def non_inferior(
    base_passed: int,
    base_total: int,
    chall_passed: int,
    chall_total: int,
    margin: float = MEANINGFUL_MARGIN,
    new_failures: int = 0,
) -> tuple[bool, str]:
    """Challenger is non-inferior when its rate is within margin and it adds no new failures."""
    if base_total <= 0 or chall_total <= 0:
        return False, "empty suite: cannot establish non-inferiority"
    base_rate = base_passed / base_total
    chall_rate = chall_passed / chall_total
    if new_failures > 0:
        return False, f"challenger adds {new_failures} new failures"
    if chall_rate + margin < base_rate:
        return (
            False,
            f"challenger rate {chall_rate:.3f} below baseline {base_rate:.3f} beyond margin {margin}",
        )
    return True, f"challenger {chall_rate:.3f} non-inferior to baseline {base_rate:.3f}"


# trace:v1 id=impl.py-statistics-pareto work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def pareto_dominates(challenger: tuple[float, float], champion: tuple[float, float]) -> bool:
    """(score, -cost) dominance: ties-or-better on both, strictly better on one."""
    return (challenger[0] >= champion[0] and challenger[1] >= champion[1]) and (
        challenger[0] > champion[0] or challenger[1] > champion[1]
    )


# trace:v1 id=impl.py-statistics-verdict work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def promotion_verdict(
    base_passed: int,
    base_total: int,
    chall_passed: int,
    chall_total: int,
    chall_score: float,
    chall_cost: float,
    champ_score: float,
    champ_cost: float,
    new_failures: int = 0,
) -> tuple[bool, str]:
    """Full promotion rule: non-inferiority plus Pareto gain."""
    ok, detail = non_inferior(base_passed, base_total, chall_passed, chall_total, new_failures=new_failures)
    if not ok:
        return False, detail
    if not pareto_dominates((chall_score, -chall_cost), (champ_score, -champ_cost)):
        return False, "no Pareto gain on score/cost axes"
    return True, f"promote: {detail} with Pareto gain"
