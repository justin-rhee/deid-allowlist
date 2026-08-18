import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyCorpus, verifyGateOpen } from "../src/verify.ts";
import type { Corpus } from "../src/verify.ts";
import { DEID_VERSION } from "../src/deid.ts";

test("verifyCorpus: a correctly-allowlisted corpus is green with zero leaks", () => {
  const corpus: Corpus = {
    cases: [
      {
        id: "case-1",
        allowlist: { id: "pass", status: "pass", noteDeid: "tokenize" },
        raw: { id: "r-1", status: "open", noteDeid: "call Jordan Lee at jordan.lee@example.com", secret: "raw text" },
        mustNotLeak: ["Jordan Lee", "jordan.lee@example.com", "raw text"],
        mustPreserveMeaning: ["call"],
      },
    ],
  };
  const result = verifyCorpus(corpus);
  assert.equal(result.status, "green");
  assert.equal(result.leakedCount, 0);
  assert.equal(result.meaningPreserved, true);
  assert.equal(result.deidVersion, DEID_VERSION);
});

test("verifyCorpus: a misconfigured allowlist is caught and reported red with the exact leak", () => {
  const corpus: Corpus = {
    cases: [
      {
        id: "case-red",
        // BUG: noteDeid should be "tokenize"; shipped as "pass" by mistake.
        allowlist: { id: "pass", noteDeid: "pass" },
        raw: { id: "r-2", noteDeid: "call Jordan Lee now" },
        mustNotLeak: ["Jordan Lee"],
      },
    ],
  };
  const result = verifyCorpus(corpus);
  assert.equal(result.status, "red");
  assert.equal(result.leakedCount, 1);
  assert.deepEqual(result.leaks, [{ caseId: "case-red", identifier: "Jordan Lee" }]);
});

test("stable tokens survive the full applyAllowlist path identically across two separate records", async () => {
  const { applyAllowlist } = await import("../src/deid.ts");
  const allowlist = { noteDeid: "tokenize" } as const;
  const out1 = applyAllowlist({ noteDeid: "Jordan Lee called" }, allowlist);
  const out2 = applyAllowlist({ noteDeid: "following up with Jordan Lee again" }, allowlist);
  const tok1 = String(out1.noteDeid).match(/<NAME_[0-9a-f]{8}>/)?.[0];
  const tok2 = String(out2.noteDeid).match(/<NAME_[0-9a-f]{8}>/)?.[0];
  assert.ok(tok1, "first record produced a token");
  assert.equal(tok1, tok2, "the same entity in two different records must produce the identical token, with no shared state");
});

// -------------------------------------------------------------------------------------------
// FALSIFICATION: prove verifyCorpus can actually go red — a verifier that always reports green
// regardless of input is worse than no verifier, because it manufactures false confidence.
// -------------------------------------------------------------------------------------------

test("FALSIFICATION — verifyCorpus catches a regression: correct allowlist (0 leaks) vs weakened allowlist (leak proven possible)", () => {
  const raw = { id: "r-3", noteDeid: "reach Jordan Lee at jordan.lee@example.com" };

  const correctAllowlist = { id: "pass", noteDeid: "tokenize" };
  const green = verifyCorpus({
    cases: [{ id: "c", allowlist: correctAllowlist, raw, mustNotLeak: ["Jordan Lee", "jordan.lee@example.com"] }],
  });
  assert.equal(green.status, "green");
  assert.equal(green.leakedCount, 0);

  // Same record, same mustNotLeak assertions, only the allowlist is weakened (tokenize -> pass) —
  // simulating exactly the human-error class this tool exists to catch before it ships.
  const weakenedAllowlist = { id: "pass", noteDeid: "pass" };
  const red = verifyCorpus({
    cases: [{ id: "c", allowlist: weakenedAllowlist, raw, mustNotLeak: ["Jordan Lee", "jordan.lee@example.com"] }],
  });
  assert.equal(red.status, "red");
  assert.equal(red.leakedCount, 2, "the weakened allowlist must actually leak — otherwise this test proves nothing about detection");
});

test("verifyCorpus: meaning-miss is reported when an expected substring does not survive projection", () => {
  const result = verifyCorpus({
    cases: [
      {
        id: "case-miss",
        allowlist: { id: "pass" }, // id is passed through, but the case expects "hello" to appear too
        raw: { id: "r-4" },
        mustPreserveMeaning: ["hello"],
      },
    ],
  });
  assert.equal(result.status, "red");
  assert.equal(result.meaningPreserved, false);
  assert.deepEqual(result.meaningMisses, [{ caseId: "case-miss", token: "hello" }]);
});

test("verifyGateOpen: true only for green + current version + fresh; false otherwise", () => {
  const now = 1_000_000_000_000;
  assert.equal(verifyGateOpen(null, now), false, "no run at all");
  assert.equal(verifyGateOpen({ status: "red", deidVersion: DEID_VERSION, ranAt: now }, now), false, "red run");
  assert.equal(verifyGateOpen({ status: "green", deidVersion: "deid-v0.9.0", ranAt: now }, now), false, "version mismatch");
  assert.equal(
    verifyGateOpen({ status: "green", deidVersion: DEID_VERSION, ranAt: now - 8 * 24 * 60 * 60 * 1000 }, now),
    false,
    "stale (older than 7 days)",
  );
  assert.equal(
    verifyGateOpen({ status: "green", deidVersion: DEID_VERSION, ranAt: now - 1 * 24 * 60 * 60 * 1000 }, now),
    true,
    "green, current version, fresh",
  );
});
