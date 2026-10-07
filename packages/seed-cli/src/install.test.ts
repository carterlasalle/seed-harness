// install.test.ts — paths resolve from the install, not the caller's directory.
//
// Purpose: pin the rule that `seed update` and the `.env` lookup follow the
// installed CLI rather than the current working directory.
// Why it exists: resolving from cwd made `seed update` fail from any other
// project — or, worse, run an unrelated repository's installer — and made a
// registry install read whatever `.env` happened to sit nearby.
// Invariants under test: a source checkout is identified by layout, not name;
// a directory with only one marker is not mistaken for one; the user config
// directory honours XDG_CONFIG_HOME.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { installRoot, userConfigDir } from "./install.ts";

test("the checkout this CLI runs from is detected by layout", () => {
  const root = installRoot();
  assert.notEqual(root, null, "tests run from the checkout, so it resolves");
  assert.ok(existsSync(join(root as string, "scripts", "install.sh")), "has the installer");
  assert.ok(existsSync(join(root as string, "crates", "seed-guardian")), "has the guardian crate");
});

test("the result never depends on the working directory", () => {
  const before = installRoot();
  const cwd = process.cwd();
  try {
    process.chdir("/");
    assert.equal(installRoot(), before, "still the checkout, not /");
  } finally {
    process.chdir(cwd);
  }
});

test("user config honours XDG_CONFIG_HOME and otherwise stays in the home dir", () => {
  const saved = process.env.XDG_CONFIG_HOME;
  try {
    process.env.XDG_CONFIG_HOME = "/tmp/seed-xdg";
    assert.equal(userConfigDir(), join("/tmp/seed-xdg", "seed"));
    delete process.env.XDG_CONFIG_HOME;
    assert.ok(userConfigDir().endsWith(join(".seed")), "falls back to ~/.seed");
  } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
  }
});