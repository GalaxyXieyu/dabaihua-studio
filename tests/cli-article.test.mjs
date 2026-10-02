/**
 * Runs the superme CLI article tests (Python stdlib unittest, tests/cli/test_article.py)
 * so they are part of `npm test`. Skips when python3 is not installed.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const probe = spawnSync("python3", ["--version"], { encoding: "utf8" });

test("superme article CLI unittest suite", { skip: probe.status !== 0 ? "python3 not available" : false }, () => {
  const run = spawnSync("python3", ["-m", "unittest", "discover", "-s", "tests/cli", "-p", "test_*.py"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stderr, /\nOK/);
});
