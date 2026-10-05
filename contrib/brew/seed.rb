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
  url "https://files.pythonhosted.org/packages/46/23/adffbd00e4f1dc544a66d707904dcf1b9a53c05909ee20dac13e1169ef1b/seed_evolution-0.1.4.tar.gz"
  sha256 "bd6112539bf94d7d19a6deae4b771a5f097bc63b6ecfcf9027427cba15e0a939"
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
    url "https://registry.npmjs.org/@carterlasalle/seed-cli/-/seed-cli-0.1.4.tgz"
    sha256 "d7a12852aaabd02270cb3aaa5ba69d675c9d5152bd64cea5e58f5816cdeba1ef"
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
