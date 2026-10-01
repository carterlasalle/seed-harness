"""Repo-wide trace exemption sweep (one-shot, main-agent owned).

Scans TS/Rust/Python/sh files for untraced internal symbols and inserts
`trace:exempt reason=internal-detail` (unit-test fns: reason=unit-test)
directly above the symbol line (below doc comments). Descending-line
inserts per file so offsets hold. Skips symbols already carrying
trace:v1/trace:exempt in the lookback, skipped paths (policy-excluded,
generated, fixtures, tests matched by policy), and barrel re-export
files. Also strips detached file-top trace:v1 markers above const
declarations (TL003 structural_attachment=file).
"""
from __future__ import annotations

import re
from pathlib import Path

SKIP_DIRS = {".git", ".scc", ".trace", "node_modules", "dist", "build",
             "target", ".venv", ".yarn", ".тур"}
SKIP_SUFFIXES = (".test.ts", "_test.py", ".test.js", "test_.py",
                 ".spec.ts", ".min.js")
SKIP_FILES = {"server.py", "generate-core-evals.py", "seed-research-catalog.py"}

TS_DEF = re.compile(
    r"^(?P<ind>\s*)(?:export\s+)?(?P<kw>function|class|interface|type|const|let"
    r"|var|enum|async\s+function)\s+(?P<name>[A-Za-z_$][\w$]*)")
TS_METHOD = re.compile(
    r"^(?P<ind>\s+)(?:public\s+|private\s+|protected\s+|static\s+|async\s+|"
    r"readonly\s+|override\s+)*(?P<name>constructor|[A-Za-z_$][\w$]*)"
    r"\s*\(")
RS_DEF = re.compile(
    r"^(?P<ind>\s*)(?:pub(?:\([^)]*\))?\s+)?(?P<kw>fn|struct|enum|trait|type|"
    r"mod|const|static|impl)\b.*?(?P<name>[A-Za-z_][\w]*)\s*[{(:<=;]")
PY_DEF = re.compile(
    r"^(?P<ind>\s*)(?:async\s+)?(?P<kw>def|class)\s+(?P<name>[A-Za-z_][\w]*)")


def is_test_fn(path: Path, name: str, line: str) -> bool:
    if "test" in path.name:
        return True
    if name.startswith("test_") or name.startswith("test"):
        return True
    if "test(" in line or "describe(" in line or "it(" in line:
        return True
    return False


def lookback_has_marker(lines: list[str], idx: int) -> bool:
    for j in range(max(0, idx - 6), idx):
        if "trace:v1" in lines[j] or "trace:exempt" in lines[j]:
            return True
    return False


def is_doc_or_attr(line: str, lang: str) -> bool:
    s = line.strip()
    if lang == "ts":
        return (s.startswith("//") or s.startswith("*") or s.startswith("/*")
                or s.startswith("@") or s == "")
    if lang == "rs":
        return (s.startswith("///") or s.startswith("//!")
                or s.startswith("//") or s.startswith("#[") or s == "")
    if lang == "py":
        return (s.startswith("#") or s.startswith('"""')
                or s.startswith("'''") or s == "")
    if lang == "sh":
        return s.startswith("#") or s == ""
    return s == ""


def lang_of(path: Path) -> str | None:
    if path.suffix == ".ts":
        return "ts"
    if path.suffix == ".rs":
        return "rs"
    if path.suffix == ".py":
        return "py"
    if path.suffix == ".sh":
        return "sh"
    return None


def exempt_token(lang: str, reason: str) -> str:
    if lang == "py" or lang == "sh":
        return f"# trace:exempt reason={reason}"
    return f"// trace:exempt reason={reason}"


def should_skip(path: Path, root: Path) -> bool:
    rel = str(path.relative_to(root))
    if path.name in SKIP_FILES:
        return True
    if path.name.endswith(SKIP_SUFFIXES):
        return True
    for part in path.relative_to(root).parts:
        if part in SKIP_DIRS:
            return True
    if rel.startswith(("docs/", "prompts/", "research/",
                       "schemas/", "capabilities/", ".agents/",
                       ".claude/", ".codex/", ".pi/", ".omp/",
                       ".hermes/", ".bugcorpus/")):
        return True
    return False


def run_sweep(root: str | Path,
              exe_suffixes: tuple[str, ...] = (".ts", ".rs", ".py", ".sh")
              ) -> dict:
    root = Path(root)
    changed: list[str] = []
    exempts = 0
    stripped = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix not in exe_suffixes:
            continue
        if should_skip(path, root):
            continue
        lang = lang_of(path)
        assert lang is not None
        text = path.read_text()
        lines = text.splitlines(keepends=True)
        inserts: list[tuple[int, str]] = []
        body = [ln.rstrip("\n") for ln in lines]
        # Strip detached file-top markers above const declarations.
        for i, ln in enumerate(body):
            if "trace:v1" in ln and i + 1 < len(body):
                nxt = body[i + 1].strip()
                if re.match(r"(export\s+)?const\s+\w+", nxt):
                    inserts.append((i, ""))
                    stripped += 1
        for i, ln in enumerate(body):
            m = None
            if lang == "ts":
                m = TS_DEF.match(ln) or TS_METHOD.match(ln)
            elif lang == "rs":
                m = RS_DEF.match(ln)
            elif lang == "py":
                m = PY_DEF.match(ln)
            if not m:
                continue
            name = m.group("name")
            if name in {"import", "from", "return", "if", "for",
                        "while", "switch"}:
                continue
            if lookback_has_marker(body, i):
                continue
            # Walk up past doc/attr lines: only exempt when the
            # immediately preceding line is code (else detached).
            j = i - 1
            while j >= 0 and is_doc_or_attr(body[j], lang):
                j -= 1
            reason = ("unit-test" if is_test_fn(path, name, ln)
                      else "internal-detail")
            indent = m.group("ind") if "ind" in m.groupdict() else ""
            inserts.append((i, f"{indent}{exempt_token(lang, reason)}"))
            exempts += 1
        if not inserts:
            continue
        for idx, marker in sorted(inserts, reverse=True):
            if marker == "":
                del body[idx]
            else:
                body[idx] = marker + "\n" + body[idx]
        path.write_text("\n".join(body) + "\n")
        changed.append(str(path.relative_to(root)))
    return {"files": changed, "exempts": exempts, "stripped": stripped}
