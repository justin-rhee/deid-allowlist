/**
 * Built-package test: imports the public entry points through the package name, the way an npm
 * consumer does, from the compiled dist. It builds first so a plain `npm test` is enough.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, symlinkSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

test("the build emits the pipeline and the verifier with types", () => {
  const build = spawnSync(process.execPath, [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.build.json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  for (const f of ["deid.js", "deid.d.ts", "verify.js", "verify.d.ts"]) {
    assert.ok(existsSync(join(ROOT, "dist", f)), `dist/${f} missing`);
  }
});

test('"deid-allowlist/verify" imports from the built package and runs', () => {
  const dir = mkdtempSync(join(tmpdir(), "deid-allowlist-pkg-"));
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(ROOT, join(dir, "node_modules", "deid-allowlist"), "dir");
  const script = `
    import { verifyCorpus, verifyGateOpen } from "deid-allowlist/verify";
    import { applyAllowlist } from "deid-allowlist";
    const r = verifyCorpus({ cases: [{ id: "c", allowlist: { id: "pass" }, raw: { id: "1", s: "Jordan Lee" }, mustNotLeak: ["Jordan Lee"] }] });
    console.log(JSON.stringify({ status: r.status, gate: typeof verifyGateOpen, pass: applyAllowlist({ id: 1 }, { id: "pass" }) }));
  `;
  const proc = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, DEID_ALLOWLIST_KEY: "test-key-0123456789abcdef0123456789abcdef" },
  });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(JSON.parse(proc.stdout), { status: "green", gate: "function", pass: { id: 1 } });
});
