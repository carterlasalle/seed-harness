"""seed-evolution mechanism search: query the research catalogs.

Purpose: let the GEPA loop and the scientist look up mechanisms/papers by
tag or problem class without parsing YAML by hand. Why it exists: the lab
searches prompt and router space only — every proposal should ground in a
catalogued mechanism, never in vibes. Responsibilities: minimal YAML-subset
parse of research/*.yaml, filter by tag/problemClass/id. Invariants: stdlib
only; the catalogs use a restricted shape (top-level list, scalar or
bracket-flow values, `|` blocks) which this parser covers; never throws on
missing files (returns []). Public functions/types: Mechanism, query_catalog,
search_mechanisms.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


# trace:v1 id=impl.py-mechanism-type work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
@dataclass(frozen=True)
class Mechanism:
    id: str
    title: str
    source: str
    tags: tuple = ()
    problem_classes: tuple = ()
    summary: str = ""
    ideas: tuple = field(default_factory=tuple)


# trace:v1 id=impl.py-mechanism-scalar work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-D5V8QCMS
def _store_scalar(current: dict, block_key: str | None, raw_line: str, stripped: str) -> None:
    """Store one `key: value` scalar line (flow lists, quotes, blocks)."""
    key, _, value = stripped.partition(":")
    key, value = key.strip(), value.strip()
    if value == "|":
        return
    if value.startswith("[") and value.endswith("]"):
        current[key] = [item.strip() for item in value[1:-1].split(",") if item.strip()]
    elif (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        current[key] = value[1:-1]
    elif value.startswith("- "):
        current.setdefault(key, []).append(value[2:].strip().strip('"'))
    else:
        current[key] = value
    if key == "implementationIdeas" and isinstance(current.get(key), str):
        current[key] = [current[key]]

# trace:v1 id=impl.py-mechanism-parse work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def _parse_simple_yaml(text: str) -> list[dict]:
    """Parse the restricted catalog shape: `- ` entries, `key: value` lines, `|` blocks, `[a, b]` flows."""
    entries: list[dict] = []
    current: dict | None = None
    block_key: str | None = None
    block_lines: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line
        if raw_line.startswith("#") or not raw_line.strip():
            continue
        if raw_line.startswith("- "):
            if current is not None:
                if block_key is not None:
                    current[block_key] = "\n".join(block_lines)
                    block_key, block_lines = None, []
                entries.append(current)
            current = {}
            rest = raw_line[2:].strip()
            if rest:
                line = f"  {rest}"
            else:
                block_key = None
                continue
        if current is None:
            continue
        if block_key is not None:
            if line.startswith("    ") or not line.strip():
                block_lines.append(line[4:] if line.startswith("    ") else "")
                continue
            current[block_key] = "\n".join(block_lines)
            block_key, block_lines = None, []
        stripped = line.strip()
        if ":" not in stripped:
            continue
        _store_scalar(current, block_key, line, stripped)
    if current is not None:
        if block_key is not None:
            current[block_key] = "\n".join(block_lines)
        entries.append(current)
    return entries


# trace:v1 id=impl.py-mechanism-load work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def _load_file(path: Path) -> list[Mechanism]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return []
    out = []
    for raw in _parse_simple_yaml(text):
        ideas = raw.get("implementationIdeas", [])
        if isinstance(ideas, str):
            ideas = [line.strip()[2:] for line in ideas.splitlines() if line.strip().startswith("- ")]
        tags = raw.get("tags", [])
        classes = raw.get("problemClasses", [])
        out.append(
            Mechanism(
                id=str(raw.get("id", "")),
                title=str(raw.get("title", "")),
                source=str(raw.get("source", "")),
                tags=tuple(tags) if isinstance(tags, list) else (),
                problem_classes=tuple(classes) if isinstance(classes, list) else (),
                summary=str(raw.get("mechanismSummary", "")),
                ideas=tuple(ideas) if isinstance(ideas, list) else (),
            )
        )
    return [m for m in out if m.id]


# trace:v1 id=impl.py-mechanism-query work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def query_catalog(root: str | Path = "research", files: tuple[str, ...] = ("mechanisms.yaml", "papers.yaml", "harnesses.yaml")) -> list[Mechanism]:
    """Load every mechanism entry across the catalog files."""
    base = Path(root)
    found: list[Mechanism] = []
    for name in files:
        found.extend(_load_file(base / name))
    return found


# trace:v1 id=impl.py-mechanism-search-fn work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
def search_mechanisms(query: str, root: str | Path = "research") -> list[Mechanism]:
    """Case-insensitive substring match over id/title/tags/problem classes."""
    needle = query.lower()
    return [
        m
        for m in query_catalog(root)
        if needle in m.id.lower()
        or needle in m.title.lower()
        or any(needle in t.lower() for t in m.tags)
        or any(needle in p.lower() for p in m.problem_classes)
    ]
