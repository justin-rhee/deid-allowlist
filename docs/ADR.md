# Architecture Decision Records (ADRs)

Why this is shaped the way it is, including two inherited defects the extraction found and one I caught myself before it shipped.

## A strip list only protects against the fields I already thought of

I was about to sync a few thousand personal records to a cloud backend, and the thing standing between them and the internet was a list of fields I'd told it to strip. That's backwards: a field added later, by a schema change or a library that attaches metadata, sails through a strip list with no opinion about a field nobody enumerated. The failure is silent, and it shows up the day someone adds a column.

So `applyAllowlist` inverts it: name what may leave, mapped to pass, tokenize, or drop, and the function only emits keys present in that map, so an absent field is dropped by construction, not caught by a scan. The private version also carried a nine-surface registry, a deny layer keyed to one operator's file paths, and schema validation tied to both; none of the three survived extraction, replaced by one neutral worked example, since a deny layer built from one person's paths isn't a general technique.

## The guarantee sits in a list I can read, not in the regex under it

Fields marked tokenize run through a heuristic, capitalization and word-boundary patterns rather than real named-entity recognition, with demonstrated misses: an all-caps name passes through unchanged, so does a lowercase one, a sentence-opening surname passes through since a capitalized first word is ambiguous, a two-letter name passes through since the pattern needs three, and an apostrophe in a name leaks its leading fragment. The first three are pinned into the suite as known-gap tests, so a future pattern change is deliberate, not silent regression; the last two are documented, not asserted, since pinning an exact hash fragment would buy no real safety.

None of that undermines the allowlist. A field the tokenizer misses inside a field marked tokenize is a narrower failure than a field never supposed to leave, which is why the guarantee lives in the list, not the regex.

## The verifier admits it can't prove what it checks

`verify.ts` opens by admitting it shares an author with the pipeline it checks: green means the leaks I thought to plant didn't happen, never that no leak of any kind happened. `verifyGateOpen` refuses a stale pass: status must be green, the recorded `deidVersion` must match the current version, and the run must be under seven days old. The version check makes changing the tokenizer invalidate old evidence instead of inheriting it; the age check exists because a green run from months back stops meaning much.

## Checking the exit code was reading a verification that never ran

The original CLI guarded its execution by comparing `import.meta.url` against `process.argv[1]`, meaning to run only when invoked directly. Under a symlink the two resolve differently: Node follows the link for the URL, but the argument stays the literal typed path, so the comparison never matches and the process exits 0, printing nothing. A caller checking the exit code alone reads that silence as a pass. I removed the guard rather than patch the comparison: `runVerify.ts` now ships CLI-only, running unconditionally when loaded, and a test invokes it through a real symlink to confirm it still reports green. Running the original to watch the defect fire would have written into the extraction's off-limits state directory, so this receipt rests on a faithful reproduction of the guard line, not the original itself failing.

## I found my own vacuous test before it shipped

A draft test called an unused stub and asserted a condition true no matter what the code did, ran, passed, and checked nothing. I caught it on a second read, deleted it, and replaced it with a real test that plants one entity across two records and confirms both produce the same token. The corpus tests follow the same instinct at scale: the allowlist, the tokenizer, and the verifier are each run with the protection removed as well as intact, so a passing suite is checked against a version of itself built to fail.
