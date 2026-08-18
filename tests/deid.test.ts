import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenizeEntities, deidField, applyAllowlist, DEID_VERSION } from "../src/deid.ts";

test("dates are tokenized (iso, us, month-name)", () => {
  for (const d of ["2026-03-14", "03/14/2026", "March 14 2026", "Mar 14"]) {
    const out = tokenizeEntities(`due ${d} ok`);
    assert.ok(!out.includes(d), `date leaked: ${d} -> ${out}`);
    assert.match(out, /<DATE_[0-9a-f]{8}>/);
  }
});

test("emails, urls, handles, phones tokenized", () => {
  assert.doesNotMatch(tokenizeEntities("ping a@b.example now"), /a@b\.example/);
  assert.doesNotMatch(tokenizeEntities("see https://x.example/p"), /https:\/\/x\.example/);
  assert.doesNotMatch(tokenizeEntities("dm @handle_99 now"), /@handle_99/);
  assert.doesNotMatch(tokenizeEntities("call +1 (415) 555-0199 today"), /555-0199/);
});

test("multi-word proper nouns tokenized, surrounding meaning preserved", () => {
  const out = tokenizeEntities("Wire Jordan Lee export to Springfield Heights");
  assert.ok(!out.includes("Jordan Lee"), out);
  assert.ok(!out.includes("Springfield Heights"), out);
  assert.ok(out.includes("Wire"), "sentence-initial stopword preserved");
  assert.ok(out.includes("export"), "lowercase verb preserved");
});

test("same entity maps to the same stable token, within and across calls (meaning-preserving)", () => {
  const a = tokenizeEntities("Jordan Lee here");
  const b = tokenizeEntities("and Jordan Lee there");
  const tokA = a.match(/<NAME_[0-9a-f]{8}>/)?.[0];
  const tokB = b.match(/<NAME_[0-9a-f]{8}>/)?.[0];
  assert.ok(tokA, "first call produced a NAME token");
  assert.equal(tokA, tokB, "the same entity across two independent calls must map to the same token");
});

test("operator entity list catches sentence-initial names the heuristic alone would miss", () => {
  const withoutList = tokenizeEntities("Devon went home");
  assert.ok(withoutList.includes("Devon"), "sentence-initial single word is not tokenized by the heuristic alone");
  const withList = tokenizeEntities("Devon went home", { entityList: ["Devon"] });
  assert.ok(!withList.includes("Devon"), withList);
});

test("deidField: drop returns undefined; pass verbatim; tokenize on array", () => {
  assert.equal(deidField("x", "drop"), undefined);
  assert.equal(deidField(42, "pass"), 42);
  const arr = deidField(["Jordan Lee note", "plain"], "tokenize") as string[];
  assert.ok(!arr[0]!.includes("Jordan Lee"));
  assert.equal(arr[1], "plain");
});

test("applyAllowlist drops non-allowlisted fields (the guarantee)", () => {
  const out = applyAllowlist(
    { id: "r-1", state: "open", secretBody: "raw text", noteDeid: "call Springfield Heights office" },
    { id: "pass", state: "pass", noteDeid: "tokenize" },
  );
  assert.equal(out.id, "r-1");
  assert.equal(out.state, "open");
  assert.ok(!("secretBody" in out), "non-allowlisted field must be dropped");
  assert.ok(!String(out.noteDeid).includes("Springfield Heights"));
});

test("deid version constant present", () => {
  assert.match(DEID_VERSION, /^deid-v/);
});

// -------------------------------------------------------------------------------------------
// FALSIFICATION: the headline promise is zero leakage under the allowlist. These tests exercise
// that promise with the protection ON, then deliberately turn the protection OFF and re-run —
// a test that still passes with the protection removed never tested the protection at all.
// -------------------------------------------------------------------------------------------

test("FALSIFICATION 1/2 — allowlist drop: protection on = 0 leaks, protection off = leak proven possible", () => {
  const record = {
    id: "abc123",
    status: "open",
    secretNotes: "call Jordan Lee at jordan.lee@example.com or +1 (415) 555-0199",
  };
  const allowlist = { id: "pass", status: "pass" }; // secretNotes intentionally NOT allowlisted

  // Protection ON: applyAllowlist enforces the allowlist — secretNotes must never appear.
  const protectedOut = applyAllowlist(record, allowlist);
  const protectedLeaks = ["Jordan Lee", "jordan.lee@example.com", "555-0199"].filter((s) =>
    JSON.stringify(protectedOut).includes(s),
  );
  assert.equal(protectedLeaks.length, 0, `protection ON must leak nothing, got: ${protectedLeaks}`);
  assert.ok(!("secretNotes" in protectedOut), "the field itself must not appear");

  // Protection OFF: the exact bug class the allowlist exists to prevent — a naive merge that
  // bypasses applyAllowlist entirely (e.g. `{ ...record }` instead of going through the allowlist).
  const unprotectedOut = { ...record };
  const unprotectedLeaks = ["Jordan Lee", "jordan.lee@example.com", "555-0199"].filter((s) =>
    JSON.stringify(unprotectedOut).includes(s),
  );
  assert.equal(unprotectedLeaks.length, 3, "protection OFF must actually leak — otherwise this test proves nothing");
});

test("FALSIFICATION 2/2 — tokenizer: protection on (tokenize mode) = 0 leaks, protection off (pass mode) = leak proven possible", () => {
  const record = {
    id: "abc123",
    status: "open",
    secretNotes: "call Jordan Lee at jordan.lee@example.com or +1 (415) 555-0199",
  };

  // Protection ON: secretNotes is allowlisted, but only via tokenize — the tokenizer must run.
  const onOut = applyAllowlist(record, { id: "pass", status: "pass", secretNotes: "tokenize" });
  const onLeaks = ["Jordan Lee", "jordan.lee@example.com", "555-0199"].filter((s) =>
    JSON.stringify(onOut).includes(s),
  );
  assert.equal(onLeaks.length, 0, `tokenize mode must leak nothing, got: ${onLeaks}`);

  // Protection OFF: the same field misconfigured as "pass" (tokenizer never runs on it) — the
  // exact mistake a human maintaining an allowlist by hand can make.
  const offOut = applyAllowlist(record, { id: "pass", status: "pass", secretNotes: "pass" });
  const offLeaks = ["Jordan Lee", "jordan.lee@example.com", "555-0199"].filter((s) =>
    JSON.stringify(offOut).includes(s),
  );
  assert.equal(offLeaks.length, 3, "pass mode on free text must actually leak — otherwise this test proves nothing");
});

// -------------------------------------------------------------------------------------------
// Documented gaps: the tokenizer is a regex/capitalization heuristic, not real NER. These lock in
// KNOWN, current limitations so a future change to the regex heuristics is a deliberate decision,
// not a silent regression — and so nobody mistakes "tokenized" for "provably absent."
// -------------------------------------------------------------------------------------------

test("KNOWN GAP: ALL-CAPS names are not tokenized by the proper-noun heuristic", () => {
  const out = tokenizeEntities("contact ED SMITH about the invoice");
  assert.ok(out.includes("ED SMITH"), "documents current behavior: this is a real, unfixed miss, not a guarantee");
});

test("KNOWN GAP: lowercase names are not tokenized by the proper-noun heuristic", () => {
  const out = tokenizeEntities("contact ed smith about the invoice");
  assert.ok(out.includes("ed smith"), "documents current behavior: this is a real, unfixed miss, not a guarantee");
});

test("KNOWN GAP: a name that is also the first word of the string is not tokenized", () => {
  const out = tokenizeEntities("Smith called about the invoice");
  assert.ok(out.startsWith("Smith "), "sentence-initial single capitalized word is treated as ambiguous, not tokenized");
});
