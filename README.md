# deid-allowlist

This is leakage reduction for records you control. It's not HIPAA or GDPR de-identification, it's not a certified method, and it has no legal or regulatory standing. If you're looking for something to point at regulated data, this isn't it, and treating it that way would be worse than using nothing at all, because it would feel like protection.

What it actually does: drops every field you didn't explicitly allow, before a record leaves your machine.

I was about to sync a few thousand personal records to a cloud backend, and the thing standing between them and the internet was a list of fields I had told it to strip.

That's backwards, and it took me an embarrassingly long time to see why. A strip list protects you against the fields you thought of. Every field added later, by a schema change or a new feature or a library that helpfully attaches metadata, sails straight through, because nothing in the design has an opinion about fields nobody enumerated. The failure is silent and it arrives on a Tuesday when someone adds a column.

The inversion is the whole package. Name what may leave. Everything else is dropped by default, including the field that didn't exist when you wrote the list.

If you sync anything derived from personal data to a service you don't run, you have made this choice already, whether or not you made it deliberately.

So this is the inverted list and the offline check that gates it, about 400 lines of TypeScript.

## Use it if

- you sync records derived from personal data to a service you don't run
- your current protection is a list of fields to strip
- your schema gains columns faster than anyone updates that list
- you want the guarantee to sit in something a human can read in full

## How it works

Each surface declares an allowlist mapping field names to one of three modes: pass through untouched, tokenize, or absent. Absent isn't a mode you write. It's what happens to everything you didn't mention.

Fields marked tokenize go through deterministic entity tokenization. The same entity produces the same token in every record, derived by hash rather than stored in a mapping table, so you can still see that two records refer to the same person without keeping anything that turns the token back into a name. There's no reverse lookup because there's no table.

An offline verifier plants synthetic identifiers in a corpus you define, runs the full pipeline, and asserts none of them survive. Sync refuses to run unless that check is green, matches the current pipeline version, and is less than seven days old. The version stamp exists so that changing the pipeline invalidates the evidence rather than inheriting it.

The verifier's own header says it can't prove what it checks, and I want to be direct about why that sentence is there rather than burying it. The verifier shares an author with the pipeline. It tests the leaks I thought to plant. A leak I didn't imagine isn't in the corpus, so a green result means "the anticipated failures didn't happen", never "no failure happened". The guarantee lives in the allowlist, which is a list a human maintains and can read in full, and not in the clever part.

## What it won't do

The tokenizer is a regex heuristic with demonstrated misses, and these are in the test suite as pinned known gaps rather than as prose:

- names in all capitals pass through unchanged
- names in all lowercase pass through unchanged
- a surname that happens to open a sentence passes through, because a capitalized first word is genuinely ambiguous
- two letter names pass through, since the pattern requires three
- a name with an apostrophe partially survives, leaving the leading fragment

Read that list next to the design claim rather than after it. A field marked tokenize that the heuristic misses still leaks only inside a field a human already approved for sync. It never leaks a field that was never supposed to leave. That's the difference between a bounded miss and an unbounded one, and it's the reason the allowlist carries the guarantee instead of the tokenizer.

It ships no schema validation. The original had it, tied one to one with a private surface registry, and there's no neutral worked example that wouldn't just be somebody else's schema. Add your own on top of your allowlist.

It ships one worked example, a support ticket surface, rather than a library of surfaces. You're expected to write your own allowlists, and if that feels like the tedious part, that's the part doing the work.

There's no second deny layer. The original had one, scanning for literal fragments of one operator's private file layout, which isn't a general technique and didn't survive extraction. If you want defense in depth, design it against your own data rather than transplanting a shape.

## How I tested it

24 of 24 tests pass, and a strict typecheck reports no errors:

```
$ node --test tests/*.test.ts
# pass 24
# fail 0
```

The headline claim is falsified at three separate levels rather than asserted once. The same planted record runs through the pipeline with the protection in place and again with it deliberately removed, and the leak counts are compared:

- bypassing the allowlist with a naive object spread leaks 0 of 3 planted identifiers, against 3 of 3 without it
- marking a field as pass through instead of tokenize leaks 0 of 3, against 3 of 3
- weakening one field in the verifier's own allowlist comes back green with 0 of 2 leaked, against red with 2 of 2

Every protection off run leaks the complete planted set, never a partial catch, so none of those tests can pass by accident.

The command line entry point is tested as a real child process against real files, including through a symlink. The original had a launch guard that compared a module URL against a process argument, which silently doesn't fire under a symlink: nothing runs, nothing prints, and the process exits 0, so a caller checking the exit code reads a verification that never happened as a pass. That defect class is removed here rather than patched.

## Install

Copy all three files out of `src/` and keep them together: `src/deid.ts` is the pipeline, `src/verify.ts` holds the check, and `src/runVerify.ts` is the command line entry point. They import each other, so taking one alone will not work. Node with native TypeScript support, or add a transpile step. No dependencies, no network, and the core reads nothing from disk.

Define an allowlist per surface, run your records through `applyAllowlist`, and wire `runVerify` into whatever gates your sync. Point it at a set of your own planted identifiers, because mine prove nothing about your data.

Confirm it's doing something before you trust it. Take a record, remove a field from the allowlist, and check that the field disappears from the output. If it survives, the allowlist isn't on the path.

## License

MIT. See [LICENSE](LICENSE). No warranty. Security notes and how to report a problem: [SECURITY.md](SECURITY.md).

---

One of a set of small tools I've pulled out of a bigger system I run, where agents write the code and plain scripts decide when it's actually done. I keep the final call for myself, and I'd rather a check be annoying than silent. More of them on my [GitHub profile](https://github.com/justin-rhee).
