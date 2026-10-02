"""seed-research-catalog: validate research/*.yaml catalogs.

Purpose: enforce the research-catalog contract (spec sections 93-94) —
every entry carries id/title/source/tags/problemClasses/mechanismSummary/
implementationIdeas plus a hashline (sha256 of the mechanismSummary text)
and a snapcompact (<source-ref>@<revision>).
Why it exists: REQ-SEED-D5V8QCMS — the lab reasons over this catalog, so
corrupt or unattributed entries must fail CI, not silently mislead.
Usage: python3 scripts/seed-research-catalog.py [--dir research].
Invariant: stdlib only — ships a minimal parser for exactly the catalog
shape (block scalars, flow lists, nested item lists), and rejects anything
outside that shape rather than guessing.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

REQUIRED_KEYS = frozenset(
    {
        "id",
        "title",
        "source",
        "tags",
        "problemClasses",
        "mechanismSummary",
        "implementationIdeas",
        "hashline",
        "snapcompact",
    }
)

# Entries that must exist per the scaffold slice (concepts/papers named there).
REQUIRED_IDS = {
    "harnesses.yaml": frozenset(
        {
            "pi",
            "oh-my-pi",
            "aider",
            "swe-agent",
            "hermes-agent",
            "openhands",
            "goose",
            "claude-code-concepts",
            "gemini-cli-concepts",
            "opencode-concepts",
        }
    ),
    "papers.yaml": frozenset(
        {
            "gepa",
            "darwin-godel-machine",
            "adas",
            "self-improving-coding-agent",
            "godel-agent",
            "latm",
            "skillweaver",
            "agent-workflow-memory",
            "reflexion",
            "self-refine",
            "toolformer",
        }
    ),
    "mechanisms.yaml": frozenset(),
}


# trace:exempt reason=internal-detail
def unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        return json.loads(value)  # handles \" and \\ escapes
    if len(value) >= 2 and value[0] == "'" and value[-1] == "'":
        return value[1:-1]
    return value


# trace:exempt reason=internal-detail
def parse_flow_list(value: str) -> list[str]:
    inner = value.strip()[1:-1].strip()
    if not inner:
        return []
    items, depth, buf, quote = [], 0, "", None
    for ch in inner + ",":
        if quote:
            buf += ch
            if ch == quote:
                quote = None
        elif ch in {"\"", "'"}:
            quote, buf = ch, buf + ch
        elif ch == "," and depth == 0:
            items.append(unquote(buf))
            buf = ""
        else:
            buf += ch
    return items


# trace:exempt reason=internal-detail
def parse_catalog(text: str) -> list[dict]:
    """Parse exactly the catalog shape; raise ValueError otherwise."""
    entries: list[dict] = []
    current: dict | None = None
    key = ""
    block: list[str] | None = None
    items: list[str] | None = None

    # trace:exempt reason=internal-detail
    def flush_block() -> None:
        nonlocal block
        if block is not None and current is not None:
            current[key] = "\n".join(block) + "\n" if block else ""
        block = None

    for raw in text.splitlines():
        if block is not None:
            if raw.startswith("    ") or not raw.strip():
                block.append(raw[4:] if raw.startswith("    ") else "")
                continue
            flush_block()
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if raw.startswith("- id:"):
            if current is not None:
                entries.append(current)
            current = {"id": unquote(raw.split(":", 1)[1])}
            key, items = "id", None
        elif raw.startswith("    - ") and items is not None and current is not None:
            items.append(unquote(raw[6:]))
        elif raw.startswith("  ") and ":" in raw and current is not None:
            k, _, v = raw[2:].partition(":")
            k, v = k.strip(), v.strip()
            if v == "|":
                key, block, items = k, [], None
            elif not v:
                current[k] = []
                key, items = k, current[k]
            elif v.startswith("[") and v.endswith("]"):
                current[k] = parse_flow_list(v)
                key, items = k, None
            else:
                current[k] = unquote(v)
                key, items = k, None
        else:
            raise ValueError(f"unparseable line: {raw!r}")
    flush_block()
    if current is not None:
        entries.append(current)
    return entries


# trace:exempt reason=internal-detail
def check_file(path: Path) -> list[str]:
    errors: list[str] = []
    try:
        entries = parse_catalog(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        return [f"{path}: {exc}"]
    if not entries:
        return [f"{path}: no entries"]
    seen = set()
    for entry in entries:
        eid = entry.get("id", "<missing>")
        keys = set(entry)
        if keys != REQUIRED_KEYS:
            errors.append(f"{path} [{eid}]: keys {sorted(keys)} != required")
        if eid in seen:
            errors.append(f"{path} [{eid}]: duplicate id")
        seen.add(eid)
        for list_key in ("tags", "problemClasses", "implementationIdeas"):
            vals = entry.get(list_key, [])
            if not isinstance(vals, list) or not vals or not all(
                isinstance(v, str) and v for v in vals
            ):
                errors.append(f"{path} [{eid}]: {list_key} must be a non-empty string list")
        summary = entry.get("mechanismSummary", "")
        if not isinstance(summary, str) or not summary.strip():
            errors.append(f"{path} [{eid}]: mechanismSummary empty")
        want = "sha256:" + hashlib.sha256(summary.rstrip("\n").encode()).hexdigest()
        if entry.get("hashline") != want:
            errors.append(f"{path} [{eid}]: hashline mismatch (want {want})")
        if not entry.get("snapcompact"):
            errors.append(f"{path} [{eid}]: snapcompact missing")
    missing = REQUIRED_IDS.get(path.name, frozenset()) - seen
    if missing:
        errors.append(f"{path}: missing required entries {sorted(missing)}")
    return errors


# trace:exempt reason=internal-detail
def main(argv: list[str]) -> int:
    root = Path(argv[argv.index("--dir") + 1]) if "--dir" in argv else Path("research")
    if not root.is_dir():
        print(f"research dir not found: {root}", file=sys.stderr)
        return 1
    errors: list[str] = []
    checked = 0
    for path in sorted(root.glob("*.yaml")):
        checked += 1
        file_errors = check_file(path)
        if file_errors:
            errors.extend(file_errors)
        else:
            count = len(parse_catalog(path.read_text(encoding="utf-8")))
            print(f"{path.name}: {count} entries ok")
    for err in errors:
        print(err, file=sys.stderr)
    if checked == 0:
        print(f"no catalogs in {root}", file=sys.stderr)
        return 1
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
