# Homebrew formula for Seed (self-evolving coding-agent harness).
# trace:v1 id=impl.brew-seed-formula work=WORK-SEED-6VF90M7B satisfies=REQ-SEED-EZPD6B85
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
  url "https://files.pythonhosted.org/packages/88/9e/099a8a873cbb6e1d705e380bb5e51db637d8f486028239d73ff0e12d279e/seed_evolution-0.1.5.tar.gz"
  sha256 "a01e9fe695e013e64e8bee426df47d062cac0a421ebe350a49c1447e947ec6f0"
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
    url "https://registry.npmjs.org/@carterlasalle/seed-cli/-/seed-cli-0.1.5.tgz"
    sha256 "8b7012b410c1c83e872a7feec0fcce74106cf682c7070c6c433faabc5894f3d7"
  end

  def install
    ENV["PIPX_HOME"] = libexec/"venvs"
    ENV["PIPX_BIN_DIR"] = libexec/"bin"
    python = formula_opt_bin("python@3.13")/"python3.13"
    # Python side: GEPA loop + oracles, installed isolated via pipx.
    system "pipx", "install", "--python", python, buildpath.to_s
    # Node side: the seed CLI from the npm tarball pinned in resources.
    # Copy the staged tree into the prefix first: `npm install <dir>`
    # symlinks the package dir itself, and the stage dir dies with the
    # build tempdir. A physical copy keeps real files under libexec.
    resource("seed-cli").stage do
      mkdir_p libexec/"npm"
      cp_r Dir.pwd, libexec/"npm/package"
    end
    system "npm", "install", *std_npm_args(prefix: (libexec/"npm/package").to_s), (libexec/"npm/package").to_s
    bin.install_symlink libexec/"npm/package/dist/cli.js" => "seed"
    bin.install_symlink libexec/"bin/seed-gepa"
    # from crates.io (same version pin as this formula's release tag).
  end

  test do
    assert_match "seed", shell_output("#{bin}/seed help")
  end
end
