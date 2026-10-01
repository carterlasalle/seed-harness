"""Tests for statistics: non-inferiority verdicts and promotion rule."""

from seed_evolution.statistics import non_inferior, promotion_verdict, wilson_interval


def test_better_challenger_is_non_inferior():
    ok, _ = non_inferior(3, 4, 4, 4)
    assert ok is True


def test_new_failures_break_non_inferiority():
    ok, detail = non_inferior(4, 4, 4, 4, new_failures=1)
    assert ok is False
    assert "new failures" in detail


def test_large_regression_fails_margin():
    ok, _ = non_inferior(10, 10, 5, 10)
    assert ok is False


def test_empty_suite_cannot_pass():
    ok, _ = non_inferior(0, 0, 0, 0)
    assert ok is False


def test_wilson_interval_contains_rate():
    low, high = wilson_interval(8, 10)
    assert low <= 0.8 <= high
    assert (low, high) != (0.0, 1.0)
    assert wilson_interval(0, 0) == (0.0, 1.0)


def test_promotion_needs_pareto_gain():
    ok, _ = promotion_verdict(4, 4, 4, 4, chall_score=1.0, chall_cost=0.1, champ_score=1.0, champ_cost=0.1)
    assert ok is False
    ok, _ = promotion_verdict(4, 4, 4, 4, chall_score=1.0, chall_cost=0.05, champ_score=1.0, champ_cost=0.1)
    assert ok is True
