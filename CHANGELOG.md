<!-- purpose: CHANGELOG.md: release notes per version. -->
<!-- trace:v1 id=impl.doc-changelog work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85 -->
# Changelog

## 0.2.0 — 2026-10-06

Interactive frontend. `seed` on a real terminal is now a product rather
than a usage message: header, transcript with semantic cards, composer,
status bar, and dialogs, while piped/`--json`/explicit subcommands stay
headless.

One rule holds it together: the UI is a projection of a single live
registry. The slash menu and the Ctrl+P palette read the same command
entries, so registering a command makes it appear in both on the next
render; the same holds for models, settings, skills, tools, themes, and
keybindings. A debounced `fs.watch` keeps filesystem-backed domains live,
so a skill or capability dropped on disk shows up without a reload.

- `seed-tui` is a new package, and the only one permitted to depend on
  `@earendil-works/pi-tui`; `scripts/verify-boundaries.ts` fails CI on a Pi
  import anywhere else and keeps the registry subpath free of terminal-UI
  imports so headless callers never load a TUI.
- Guardian-policy settings render locked and refuse in-session edits: the
  evolvable organism must not move its own grading criteria through the UI.
- Reasoning effort reaches the model call; `off` sends no parameter at all.
- `/tools` reports router visibility, score, rank, and the visible limit.
- Lab model roles (task, scientist, mutator, judge, challenge) are
  separately configurable settings.
- Sessions persist and resume; `/sessions` shows the resume tree and `/new`
  forks. `/image` renders inline when the terminal can. Mouse is opt-in.
- The guardian gains read-only `candidate.list` and `archive.list`: candidate
  metadata and Pareto archive membership only, never hidden oracle outputs.
- The update reminder compares against the version actually installed
  instead of a hardcoded literal, and session/run ids come from the CSPRNG.

Note: 0.1.1 through 0.1.5 shipped without changelog entries.

## 0.1.0 — 2026-10-01

First increment: guardian daemon (RPC, WAL store, gates, archive,
promotion), organism runtime (python primitive, sessions, ephemeral,
telemetry), capability registry + BM25 router, lab loop, CLI, GEPA
contract, 60-task corpus, CI gates. No license change (none declared yet).
