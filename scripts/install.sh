#!/usr/bin/env bash
# trace:v1 id=ops.install-script title="Install Seed from this checkout, idempotently"
# scripts/install.sh — install Seed from this checkout, idempotently.
#
#   scripts/install.sh              # install or upgrade in place
#   SEED_BIN_DIR=~/.bin scripts/install.sh
#   scripts/install.sh --no-verify  # skip the post-install doctor run
#
# One command where the README used to list five: toolchain check, JS/Python/
# Rust dependencies, a `.env` if you have none, and `seed` + `seed-guardian`
# on your PATH. Re-running it is the supported upgrade path, which is what
# `seed update` calls.
#
# Requires: node >= 22, corepack, uv, cargo (all checked, each with the reason).
# Writes only under SEED_BIN_DIR (default ~/.local/bin) and this checkout.

set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin_dir="${SEED_BIN_DIR:-$HOME/.local/bin}"
verify=1
for arg in "$@"; do
  case "$arg" in
    --no-verify) verify=0 ;;
    -h | --help)
      # Line 1 is the shebang and line 2 is the trace marker; neither is help.
      sed -n '3,16p' "$0" | grep -v 'trace:v1' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'install.sh: unknown argument %s\n' "$arg" >&2
      exit 1
      ;;
  esac
done

say() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33mnote:\033[0m %s\n' "$*" >&2; }
bad() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; }

# Each tool is checked with the reason it is needed, so a missing one is
# actionable rather than a bare "command not found" three steps later.
require() {
  local cmd="$1" why="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    bad "$cmd is not on PATH — needed to $why"
    return 1
  fi
}

say "==> Checking toolchain"
missing=0
require node "run the CLI and TUI" || missing=1
require cargo "build the guardian daemon" || missing=1
require uv "manage the Python evolution package" || missing=1
require corepack "activate the pinned Yarn" || missing=1
if [ "$missing" -ne 0 ]; then
  bad "install the missing tools and re-run (see README > Prerequisites)"
  exit 1
fi

node_version="$(node -v | sed 's/^v//')"
node_major="${node_version%%.*}"
node_minor="$(printf '%s' "$node_version" | cut -d. -f2)"
# The shim runs the TypeScript entry point directly. Node strips types without
# a flag only from 22.18, so 22.0-22.17 would install a `seed` that cannot
# start.
if [ "$node_major" -lt 22 ] || { [ "$node_major" -eq 22 ] && [ "$node_minor" -lt 18 ]; }; then
  bad "node $node_version is too old — Seed runs TypeScript directly, which needs >= 22.18"
  exit 1
fi
printf '    node %s, %s, %s\n' "$(node -v)" "$(uv --version)" "$(cargo --version | cut -d' ' -f1,2)"

say "==> Installing JS workspaces"
corepack enable >/dev/null 2>&1 || true
(cd "$repo" && yarn install --immutable)

say "==> Building the guardian"
(cd "$repo" && cargo build --workspace --quiet)

say "==> Syncing the Python package"
(cd "$repo" && uv sync --locked --project python/seed_evolution --quiet)

if [ ! -f "$repo/.env" ]; then
  cp "$repo/.env.example" "$repo/.env"
  say "==> Wrote .env from .env.example"
  printf '    Add OPENROUTER_API_KEY to it before running a model turn.\n'
fi

say "==> Linking commands into $bin_dir"
mkdir -p "$bin_dir"
# The shims resolve the checkout at install time, so `seed` works from any
# directory without this script staying on PATH.
cat >"$bin_dir/seed" <<SHIM
#!/usr/bin/env bash
exec node "$repo/packages/seed-cli/src/cli.ts" "\$@"
SHIM
cat >"$bin_dir/seed-guardian" <<SHIM
#!/usr/bin/env bash
exec "$repo/target/debug/seed-guardian" "\$@"
SHIM
chmod +x "$bin_dir/seed" "$bin_dir/seed-guardian"

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *)
    printf '\n'
    bad "$bin_dir is not on your PATH; add it to use \`seed\`:"
    # Literal `$PATH` on purpose: this line is meant to be pasted.
    # shellcheck disable=SC2016
    printf '    export PATH="%s:$PATH"\n' "$bin_dir"
    ;;
esac

if [ "$verify" -eq 1 ]; then
  say "==> Verifying"
  # The guardian is not started here: doctor reports it as a check so a
  # stopped daemon is visible rather than fatal.
  # Run from the checkout: doctor validates the repository's schemas and
  # capability manifests, so the caller's directory would misreport those as
  # failures.
  doctor_out="$(cd "$repo" && "$bin_dir/seed" doctor 2>&1)" && doctor_ok=1 || doctor_ok=0
  printf '%s\n' "$doctor_out"
  if [ "$doctor_ok" -eq 1 ]; then
    printf '\n'
    say "Installed. Run \`seed\` for the interactive session."
  else
    # Only the toolchain and the static gates decide whether the install
    # worked. Docker (eval sandboxes) and a running guardian are features you
    # opt into, so a stopped daemon must not fail an otherwise good install.
    fatal=""
    for name in node yarn uv python rust sqlite schemas capability-manifests; do
      case "$doctor_out" in
        *"FAIL $name:"*) fatal="$fatal $name" ;;
      esac
    done
    printf '\n'
    if [ -n "$fatal" ]; then
      bad "core checks failed:$fatal — fix them and run \`seed doctor\`"
      exit 1
    fi
    warn "installed, but some checks need attention (see FAIL lines above)"
    printf "    Docker is needed only for \`seed eval run\`; the guardian daemon for guardian-backed commands.\n"
  fi
fi