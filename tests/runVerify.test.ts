/**
 * Script-level tests: these run src/runVerify.ts as an actual child process (`node <path>`), the
 * same way a real caller would invoke it — never by importing its main() function. A sibling
 * extraction once shipped a CLI whose entry-point check silently no-op'd under a symlink
 * invocation, and every test still passed because the tests imported main() directly instead of
 * running the compiled script. These tests specifically guard against that class of defect,
 * including one that invokes the script through a symlink.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(import.meta.dirname, "..", "src", "runVerify.ts");
const CLEAN_CORPUS = resolve(import.meta.dirname, "fixtures", "example-corpus-clean.json");
const LEAKY_CORPUS = resolve(import.meta.dirname, "fixtures", "example-corpus-leaky.json");

function run(args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

test("script run against a clean corpus: exit 0, prints GREEN, writes result file, no halt flag", () => {
  const dir = mkdtempSync(join(tmpdir(), "deid-allowlist-test-"));
  const resultPath = join(dir, "result.json");
  const haltPath = join(dir, "halt.flag");

  const proc = run([CLEAN_CORPUS, resultPath, haltPath]);
  assert.equal(proc.status, 0, `expected exit 0, got ${proc.status}; stderr=${proc.stderr}`);
  assert.match(proc.stdout, /GREEN/);

  assert.ok(existsSync(resultPath), "result file must be written");
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert.equal(result.status, "green");
  assert.equal(result.leakedCount, 0);

  assert.ok(!existsSync(haltPath), "halt flag must not exist after a green run");
  rmSync(dir, { recursive: true, force: true });
});

test("script run against a leaky corpus: exit 1, prints RED, writes halt flag", () => {
  const dir = mkdtempSync(join(tmpdir(), "deid-allowlist-test-"));
  const resultPath = join(dir, "result.json");
  const haltPath = join(dir, "halt.flag");

  const proc = run([LEAKY_CORPUS, resultPath, haltPath]);
  assert.equal(proc.status, 1, `expected exit 1, got ${proc.status}; stderr=${proc.stderr}`);
  assert.match(proc.stdout, /RED/);
  assert.match(proc.stdout, /leaks=/);

  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert.equal(result.status, "red");
  assert.ok(result.leakedCount > 0);

  assert.ok(existsSync(haltPath), "halt flag must be written after a red run");
  const flagContent = readFileSync(haltPath, "utf8");
  assert.match(flagContent, /^red /);
  rmSync(dir, { recursive: true, force: true });
});

test("script run with no arguments: exit 2 (usage error), nothing crashes silently", () => {
  const proc = run([]);
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /usage:/);
});

test("script run against a nonexistent corpus path: exit 2, clear error, not a silent success", () => {
  const proc = run(["/nonexistent/path/does-not-exist.json"]);
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /could not load corpus/);
});

test("script run THROUGH A SYMLINK still executes and reports correctly (guards the fragile-entry-point defect class)", () => {
  const dir = mkdtempSync(join(tmpdir(), "deid-allowlist-symlink-test-"));
  const linkPath = join(dir, "runVerify-link.ts");
  symlinkSync(SCRIPT, linkPath);

  const resultPath = join(dir, "result.json");
  const proc = spawnSync(process.execPath, [linkPath, CLEAN_CORPUS, resultPath], { encoding: "utf8" });

  assert.equal(proc.status, 0, `symlink invocation must still run and exit 0; got ${proc.status}, stderr=${proc.stderr}`);
  assert.match(proc.stdout, /GREEN/, "symlink invocation must still print output, not silently no-op");
  assert.ok(existsSync(resultPath), "symlink invocation must still write the result file");

  rmSync(dir, { recursive: true, force: true });
});
