"""Tests for dataset: deterministic splits with a >=20% holdout floor."""

from seed_evolution.dataset import split_dataset


def test_split_is_deterministic_and_covers_all():
    cases = [{"id": f"case-{i:02d}"} for i in range(60)]
    first = split_dataset(cases, seed=1337)
    second = split_dataset(cases, seed=1337)
    assert [c["id"] for c in first.train] == [c["id"] for c in second.train]
    total = len(first.train) + len(first.val) + len(first.holdout)
    assert total == 60
    assert len(first.holdout) >= 12


def test_holdout_floor_holds_for_small_inputs():
    for n in (1, 2, 5, 10):
        split = split_dataset([{"id": f"c{i}"} for i in range(n)], seed=7)
        assert len(split.holdout) >= max(1, round(n * 0.2)) or n == 0
        assert len(split.train) + len(split.val) + len(split.holdout) == n
    assert split_dataset([], seed=7).holdout == ()
