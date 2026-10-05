# Homebrew formula for Seed (self-evolving coding-agent harness).
#
# Canonical source: contrib/brew/seed.rb in seed-harness.
# Install with: brew install carterlasalle/tap/seed
#
# After each new PyPI release, regenerate with contrib/brew/bump.sh.
# Installs `seed` (CLI via pipx-isolated seed-evolution + npm CLI) and
# `seed-guardian` (prebuilt Rust daemon binary).
#
# There is no explicit `version` stanza: Homebrew scans it from the sdist URL
# (`brew audit --strict` flags the duplication).

class Seed < Formula
  desc "Self-evolving coding-agent harness with an immutable Rust guardian"
  homepage "https://github.com/carterlasalle/seed-harness"
  # PLACEHOLDER — replaced by contrib/brew/bump.sh after the first PyPI release.
  url "https://files.pythonhosted.org/packages/00/00/seed-evolution-0.1.0.tar.gz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "Apache-2.0"

  livecheck do
    url "https://pypi.org/pypi/seed-evolution/json"
    strategy :json do |json|
      json["info"]["version"]
    end
  end

  depends_on "node"
  depends_on "pipx"
  depends_on "python@3.13"
  resource "seed-cli" do
    url "https://registry.npmjs.org/@carterlasalle/seed-cli/-/seed-cli-0.1.0.tgz"
    sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  end

  def install
    ENV["PIPX_HOME"] = libexec/"venvs"
    ENV["PIPX_BIN_DIR"] = libexec/"bin"
    python = formula_opt_bin("python@3.13")/"python3.13"
    # Python side: GEPA loop + oracles, installed isolated via pipx.
    system "pipx", "install", "--python", python, buildpath.to_s
    # Node side: the seed CLI from the npm tarball pinned in resources.
    resource("seed-cli").stage do
      system "npm", "install", *std_npm_args(prefix: libexec), buildpath.to_s
    end
    bin.install_symlink libexec/"bin/seed", libexec/"bin/seed-gepa"
    # Rust side: the guardian daemon ships via `cargo install seed-guardian`
    # from crates.io (same version pin as this formula's release tag).
  end

  test do
    assert_match "seed", shell_output("#{bin}/seed help")
  end
end
