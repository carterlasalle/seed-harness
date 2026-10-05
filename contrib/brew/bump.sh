#!/usr/bin/env bash
# Regenerate contrib/brew/seed.rb for a new release.
#
#   contrib/brew/bump.sh            # latest versions from PyPI + npm
#   contrib/brew/bump.sh 0.1.0      # specific version (all three registries)
#
# Requires: curl, jq, shasum (all present on stock macOS + Homebrew).
# Updates the sdist url/sha256 AND the seed-cli resource url/sha256,
# which must move in lockstep on every release.

set -euo pipefail

version="${1:-}"
if [[ -z "$version" ]]; then
  version="$(curl -s https://pypi.org/pypi/seed-evolution/json | jq -r .info.version)"
fi

formula="$(cd "$(dirname "$0")" && pwd)/seed.rb"
meta="$(curl -s "https://pypi.org/pypi/seed-evolution/${version}/json")"
url="$(printf '%s' "$meta" | jq -r '.urls[] | select(.packagetype == "sdist") | .url')"
sha256="$(curl -sL "$url" | shasum -a 256 | awk '{print $1}')"

npm_meta="$(curl -s "https://registry.npmjs.org/@carterlasalle%2fseed-cli")"
npm_tarball="$(printf '%s' "$npm_meta" | jq -r ".versions[\"${version}\"].dist.tarball")"
npm_tmp="$(mktemp -d)"
curl -sL "$npm_tarball" -o "$npm_tmp/cli.tgz"
npm_sha="$(shasum -a 256 "$npm_tmp/cli.tgz" | awk '{print $1}')"
rm -rf "$npm_tmp"

python3 - "$formula" "$url" "$sha256" "$npm_tarball" "$npm_sha" <<'PY'
import re
import sys

path, url, sha256, npm_tarball, npm_sha = sys.argv[1:]
text = open(path, encoding="utf-8").read()
lines = text.split("\n")
out = []
in_resource = False
for line in lines:
    if line.strip().startswith('resource "seed-cli"'):
        in_resource = True
    if in_resource and line.strip().startswith("url "):
        line = f'    url "{npm_tarball}"'
    if in_resource and line.strip().startswith("sha256 "):
        line = f'    sha256 "{npm_sha}"'
        in_resource = False
    out.append(line)
text = "\n".join(out)
text = re.sub(r'^  url "https://files\.pythonhosted\.org.*"$', f'  url "{url}"', text, count=1, flags=re.M)
text = re.sub(r'^  sha256 "0+$".*$', f'  sha256 "{sha256}"', text, count=1, flags=re.M)
open(path, "w", encoding="utf-8").write(text)
PY

echo "contrib/brew/seed.rb -> $version"
grep -E '^  (url|sha256)|resource|url "https' "$formula" || true
