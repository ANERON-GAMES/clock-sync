import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_CAPACITY,
  DEFAULT_OUTLIER_MULTIPLE,
  DEFAULT_RTT_RATIO,
  MAX_CAPACITY,
  MIN_CAPACITY,
  OUTLIER_MIN_SAMPLES
} from "../src/index.js";
import * as api from "../src/index.js";

const root = new URL("..", import.meta.url);

test("public exports stay limited to the documented surface", () => {
  assert.deepEqual(Object.keys(api).sort(), [
    "ClockSync",
    "DEFAULT_CAPACITY",
    "DEFAULT_OUTLIER_MULTIPLE",
    "DEFAULT_RTT_RATIO",
    "MAX_CAPACITY",
    "MIN_CAPACITY",
    "OUTLIER_MIN_SAMPLES"
  ]);
  assert.equal(MIN_CAPACITY, 1);
  assert.equal(MAX_CAPACITY, 64);
  assert.equal(DEFAULT_CAPACITY, 8);
  assert.equal(DEFAULT_RTT_RATIO, 2);
  assert.equal(DEFAULT_OUTLIER_MULTIPLE, 3);
  assert.equal(OUTLIER_MIN_SAMPLES, 3);
  assert.equal(api.ClockSync.name, "ClockSync");
});

test("package metadata names the module and the author", () => {
  const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  assert.equal(pkg.name, "@aneron/clock-sync");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.author, "Vadim Gubin");
  assert.equal(pkg.type, "module");
  assert.equal(pkg.sideEffects, false);
  assert.equal(pkg.engines.node, ">=20");
  assert.equal(pkg.private, undefined);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.main, "./src/index.js");
  assert.equal(pkg.exports, "./src/index.js");
  assert.equal(pkg.repository.type, "git");
  assert.equal(pkg.repository.url, "git+https://github.com/ANERON-GAMES/clock-sync.git");
  assert.deepEqual(pkg.files, ["src", "LICENSE", "README.md"]);
  const license = readFileSync(new URL("LICENSE", root), "utf8");
  assert.equal(license.includes("Copyright (c) 2026 Vadim Gubin"), true);
  assert.equal(license.includes("anerongames"), false);
  const readme = readFileSync(new URL("README.md", root), "utf8");
  let position = -1;
  for (const heading of [
    "## Purpose",
    "## Install",
    "## Usage",
    "## API",
    "## Design",
    "## License"
  ]) {
    const found = readme.indexOf(heading);
    assert.equal(found > position, true, heading);
    position = found;
  }
  assert.equal(readme.includes("## Design notes"), false);
  assert.equal(readme.includes("## API reference"), false);
  assert.equal(readme.includes("`first.offset` is `1000`"), true);
  assert.equal(readme.includes("`first.spread` is `5`"), true);
  assert.equal(readme.includes("`atTwoHundred` is `1200`"), true);
  assert.equal(readme.includes("`slow.included` is `false`"), true);
  assert.equal(readme.includes("`spike.offset` is `935`"), true);
  assert.equal(readme.includes("The offset is `45`"), true);
  assert.equal(readme.includes("`stepped.size` is `4`"), true);
  assert.equal(readme.includes("`atSeventy` is `115`"), true);
  assert.equal(readme.includes("`windowed.size` is `2`"), true);
  assert.equal(readme.includes("`windowed.samples[0].clientSend` is `100`"), true);
  assert.equal(readme.includes("The offset is `15`"), true);
  assert.equal(readme.includes("The spread is `10`"), true);
});

test("source files do not contain comments, clocks, timers, or network calls", () => {
  const files = readdirSync(new URL("src/", root));
  assert.deepEqual(files, ["index.js"]);
  const source = readFileSync(new URL("src/index.js", root), "utf8");
  assert.equal(source.includes("/*"), false);
  assert.equal(source.includes("//"), false);
  assert.equal(source.includes("import "), false);
  assert.equal(source.includes("require("), false);
  assert.equal(source.includes("node:"), false);
  for (const token of [
    "Date",
    "setTimeout",
    "setInterval",
    "Math.random",
    "process",
    "fetch(",
    "globalThis",
    "queueMicrotask",
    "setImmediate",
    "performance"
  ]) {
    assert.equal(source.includes(token), false, token);
  }
});

test("the lockfile resolves only from the npm registry", () => {
  const lockPath = new URL("package-lock.json", root);
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  assert.equal(lock.lockfileVersion >= 2, true);
  const text = readFileSync(lockPath, "utf8");
  assert.equal(text.includes("git+"), false);
  assert.equal(text.includes("github:"), false);
  assert.equal(text.includes("registry.yarnpkg.com"), false);
  let resolved = 0;
  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }
      return;
    }
    if (value !== null && typeof value === "object") {
      if (typeof value.resolved === "string") {
        resolved += 1;
        assert.equal(
          value.resolved.startsWith("https://registry.npmjs.org/"),
          true,
          value.resolved
        );
      }
      for (const key of Object.keys(value)) {
        walk(value[key]);
      }
    }
  };
  walk(lock);
  assert.equal(resolved > 0, true);
});
