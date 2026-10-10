# deid-allowlist

[![tests](https://github.com/justin-rhee/deid-allowlist/actions/workflows/test.yml/badge.svg)](https://github.com/justin-rhee/deid-allowlist/actions/workflows/test.yml)

One plain allowlist for records that sync off your machine: **drops every field you didn't explicitly allow**, **tokenizes entities deterministically**, and **refuses to run sync unless an offline leak check is green**. It is about 400 lines of TypeScript, no dependencies, no network, and the core reads nothing from disk.

It was built for syncing a few thousand personal records to a cloud backend, where the standing protection was a list of fields to strip. That's backwards: a strip list protects you against the fields you thought of, and every field added later, by a schema change or a feature or a library that helpfully attaches metadata, sails straight through, silently, on a Tuesday when someone adds a column. The inversion is the whole package: name what may leave, and everything else is dropped by default, including the field that didn't exist when you wrote the list.

## Use it if

- you sync records derived from personal data to a service you don't run
- your current protection is a list of fields to strip, and your schema gains columns faster than anyone updates that list
- you want the guarantee to sit in something a human can read in full

## How it works

Each surface declares an allowlist mapping field names to one of three modes: pass through untouched, tokenize, or absent. Absent isn't a mode you write; it's what happens to everything you didn't mention. Fields marked tokenize go through deterministic entity tokenization: the same entity produces the same token in every record, derived by hash rather than stored in a mapping table, so you can still see that two records refer to the same person without keeping anything that turns the token back into a name. There's no reverse lookup because there's no table.

An offline verifier plants synthetic identifiers in a corpus you define, runs the full pipeline, and asserts none of them survive. Sync refuses to run unless that check is green, matches the current pipeline version, and is less than seven days old; the version stamp exists so changing the pipeline invalidates the evidence rather than inheriting it.

The verifier's own header says it can't prove what it checks, and that sentence is there deliberately rather than buried. The verifier shares an author with the pipeline and tests the leaks its author thought to plant, so a green result means "the anticipated failures didn't happen", never "no failure happened". The guarantee lives in the allowlist, a list a human maintains and can read in full, not in the clever part.

## What it won't do

This is leakage reduction for records you control. It's not HIPAA or GDPR de-identification, not a certified method, and has no legal or regulatory standing; pointing it at regulated data would be worse than using nothing at all, because it would feel like protection.

The tokenizer is a regex heuristic with demonstrated misses, pinned in the test suite as known gaps rather than prose:

- names in all capitals pass through unchanged
- names in all lowercase pass through unchanged
- a surname that happens to open a sentence passes through, because a capitalized first word is genuinely ambiguous
- two letter names pass through, since the pattern requires three
- a name with an apostrophe partially survives, leaving the leading fragment

Read that list next to the design claim rather than after it: a field marked tokenize that the heuristic misses still leaks only inside a field a human already approved for sync, never a field that was never supposed to leave. That's the difference between a bounded miss and an unbounded one, and it's why the allowlist carries the guarantee instead of the tokenizer.

It ships no schema validation, because the original had one tied to a private surface registry with no neutral worked example; add your own on top of your allowlist. It ships one worked example, a support ticket surface, rather than a library of surfaces; writing your own allowlists is the tedious part, and that's the part doing the work. There's no second deny layer: the original scanned for literal fragments of one operator's private file layout, which isn't a general technique and didn't survive extraction.

## How I tested it

24 of 24 tests pass, and a strict typecheck reports no errors: `node --test tests/*.test.ts`.

The headline claim is falsified at three separate levels rather than asserted once. The same planted record runs through the pipeline with the protection in place and again with it deliberately removed, and the leak counts are compared:

- bypassing the allowlist with a naive object spread leaks 0 of 3 planted identifiers, against 3 of 3 without it
- marking a field as pass through instead of tokenize leaks 0 of 3, against 3 of 3
- weakening one field in the verifier's own allowlist comes back green with 0 of 2 leaked, against red with 2 of 2

Every protection off run leaks the complete planted set, never a partial catch, so none of those tests can pass by accident.

The command line entry point is tested as a real child process against real files, including through a symlink. The original had a launch guard that compared a module URL against a process argument, which silently doesn't fire under a symlink: nothing runs, nothing prints, and the process exits 0, so a caller checking the exit code reads a verification that never happened as a pass. That defect class is removed here rather than patched. Design decisions and what changed while building it: [docs/ADR.md](docs/ADR.md).

## Install

Copy all three files out of `src/` and keep them together: `src/deid.ts` is the pipeline, `src/verify.ts` holds the check, and `src/runVerify.ts` is the command line entry point. They import each other, so taking one alone will not work. Node with native TypeScript support, or add a transpile step.

Define an allowlist per surface, run your records through `applyAllowlist`, and wire `runVerify` into whatever gates your sync. Point it at a set of your own planted identifiers, because these prove nothing about your data. Confirm it's doing something before you trust it: take a record, remove a field from the allowlist, and check that the field disappears from the output. If it survives, the allowlist isn't on the path.

## License

MIT. See [LICENSE](LICENSE). No warranty. Security notes and how to report a problem: [SECURITY.md](SECURITY.md).

This little tool is one of a handful I pulled out of my own day-to-day agent setup. I use them all myself, so when something breaks I usually notice fast. But if you run into any issues, or anything that looks off, open an issue. I read every one. More tools on my [GitHub profile](https://github.com/justin-rhee).