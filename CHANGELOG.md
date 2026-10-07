<!-- purpose: CHANGELOG.md: release notes per version. -->
<!-- trace:v1 id=impl.doc-changelog work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85 -->
# Changelog

## Unreleased

Install, update, and terminal integration.

- `scripts/install.sh` installs from a checkout in one command: toolchain
  check, dependencies, a `.env`, and `seed` + `seed-guardian` on `PATH`. It
  is idempotent, so it doubles as the repair path. Only the toolchain and
  the static gates can fail it — a stopped Docker daemon or guardian is
  reported, never fatal. It requires Node >= 22.18, matching the shim: Seed
  runs TypeScript directly, which Node strips without a flag only from
  22.18, so earlier Node 22 releases would install a `seed` that cannot
  start.
- `seed update` upgrades a source install in place (`git pull --ff-only`,
  then reinstall); `seed update --check` reports without changing anything.
  The update resolves the checkout from the installed CLI, never the working
  directory — `seed` runs from other projects, and updating whichever
  repository happened to be current would be wrong and unsafe. A registry
  install has no checkout, so it is told to use its package manager.
- The update reminder could never fire: `checkCachedUpdate` declared a
  return type, ended on a helper and fell off the end, so it always
  returned `undefined`. It now reports `installed -> latest`. `seed update
  --check` reads the cache through a separate query that neither throttles
  nor stamps a notification, so the entry-point reminder can no longer make
  an explicit check report "up to date".
- `.env` is actually read now. It was documented, and error messages told
  people to put values in it, but nothing loaded the file — only `doctor`
  regex-scraped one key for its own check. A model key placed exactly where
  the message said to put it silently did nothing and presented as a
  missing key. It resolves from the checkout when there is one and from
  `~/.seed/.env` otherwise, so a registry install reads a real path instead
  of walking up out of `node_modules`. Real environment variables still win.
- `.env.example` was missing its trailing newline, so appending a key with
  `>>` merged it into the last comment and the key vanished.
- The interactive session opens with a short boot animation; any key skips
  it, `SEED_NO_ANIM=1` disables it.
- Alternate-screen sessions open clicked http(s) links and show a
  jump-to-end label. Transcript search, text selection and copy were
  already supplied by pi-tui's alternate screen; they are now documented
  rather than merely present.
- Fixed a guardian connection leak that made `yarn test` unusable whenever a
  guardian was running. Every caller closed its client on the happy path
  only (`client.close()` after the call), so a throw leaked an open socket,
  and an open socket keeps the event loop alive. The CLI hid it behind
  `process.exit`; the test runner simply never returned. Connections now go
  through one helper that closes on every path. The suite went from never
  finishing to 204 tests in ~3s.
- The guardian socket path is resolved in one place and overridable with
  `SEED_GUARDIAN_SOCKET`. Guardian-backed tests point it at a socket nothing
  listens on, so they exercise the offline fallbacks instead of answering
  from whichever daemon the developer happens to be running.

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
