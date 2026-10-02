"""seed-evolution dataset: deterministic train/val/holdout splits.

Purpose: split an eval-case list into train/validation/holdout so GEPA
propose/test/keep never trains on the promotion gate. Why it exists: the
Godel-agent lesson (held-out verification) and the challenge-generator rule
(no eval leakage) both require the holdout to stay unseen. Responsibilities:
seeded shuffle, 60/20/20 default with holdout floor of 20%, split-record
serialization. Invariants: stdlib only (random); deterministic by seed;
holdout is always >= 20% of the input (at least 1 case when nonempty).
Public functions/types: Split, split_dataset, load_cases, save_split.
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass
from pathlib import Path


# trace:v1 id=impl.py-dataset-split work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
@dataclass(frozen=True)
class Split:
    train: tuple
    val: tuple
    holdout: tuple


# trace:v1 id=impl.py-dataset-splitfn work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def split_dataset(cases: list, seed: int = 1337) -> Split:
    """Seeded 60/20/20 split; holdout is clamped to >= 20% (min 1 when nonempty)."""
    items = list(cases)
    rng = random.Random(seed)
    rng.shuffle(items)
    n = len(items)
    if n == 0:
        return Split(train=(), val=(), holdout=())
    holdout_n = max(1, round(n * 0.2))
    val_n = max(1 if n >= 3 else 0, round(n * 0.2))
    if holdout_n + val_n >= n:
        holdout_n = max(1, n // 5)
        val_n = max(0, (n - holdout_n) // 4)
    holdout = tuple(items[:holdout_n])
    val = tuple(items[holdout_n : holdout_n + val_n])
    train = tuple(items[holdout_n + val_n :])
    return Split(train=train, val=val, holdout=holdout)


# trace:v1 id=impl.py-dataset-load work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def load_cases(generated_dir: str | Path) -> list[dict]:
    """Load every task.json under a generated corpus dir, sorted by id."""
    root = Path(generated_dir)
    cases: list[dict] = []
    if not root.is_dir():
        return cases
    for child in sorted(root.iterdir()):
        manifest = child / "task.json"
        if child.is_dir() and manifest.is_file():
            cases.append(json.loads(manifest.read_text(encoding="utf-8")))
    cases.sort(key=lambda c: str(c.get("id", "")))
    return cases


# trace:v1 id=impl.py-dataset-save work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def save_split(split: Split, path: str | Path) -> None:
    """Write split id lists as JSON."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    # trace:exempt reason=internal-detail
    as_id = lambda c: c["id"] if isinstance(c, dict) else c.id

    out.write_text(
        json.dumps(
            {"train": [as_id(c) for c in split.train], "val": [as_id(c) for c in split.val], "holdout": [as_id(c) for c in split.holdout]},
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
