# deid-allowlist

[![tests](https://github.com/justin-rhee/deid-allowlist/actions/workflows/test.yml/badge.svg)](https://github.com/justin-rhee/deid-allowlist/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/deid-allowlist.svg)](https://www.npmjs.com/package/deid-allowlist) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![node >= 22](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg) ![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)

Strips every field you didn't explicitly allow from records before they sync off your machine, including fields added later.

```ts
import { applyAllowlist } from "deid-allowlist";

const record = { id: "T-1042", status: "open", body: "Maria Lopez asked about her refund",
                 email: "maria@example.com", added_later: "x" };

applyAllowlist(record, { id: "pass", status: "pass", body: "tokenize" }, { entityList: ["Maria Lopez"] });
// { id: "T-1042", status: "open", body: "<NAME_e808e01f3a63d8fa> asked about her refund" }
```

Tokens are keyed. Set a secret first, such as `export DEID_ALLOWLIST_KEY=$(openssl rand -hex 32)`, or pass `{ key }` in the third argument. There is no default key: tokenizing throws without one, and your token values will differ from the ones above.

I was syncing a few thousand personal records to a cloud backend, protected by a list of fields to strip. A strip list only covers the fields you thought of. Every field added later, by a schema change or a library that helpfully attaches metadata, sails through silently.

## Use it if

- you sync records derived from personal data to a service you don't run
- your protection is a list of fields to strip, and your schema grows faster than that list
- you want the guarantee to sit in something a person can read in full

## Install

```sh
npm install deid-allowlist
```

Node 22 or newer. No dependencies. It ships compiled JavaScript with type definitions. Rather vendor it? Copy `src/deid.ts` into your project instead: about 215 lines, and Node 22 reads TypeScript directly.

## How it works

1. each surface's allowlist marks fields as pass or tokenize, and anything not listed is dropped
2. tokenized names become the same token in every record, an HMAC of the value under your secret key with no lookup table, so you can tell two records share a person. Without the key nobody can test a guess against a token or turn it back into a name. With the key they can confirm a guess, so keep it out of your records and your repo, and rotate it if it leaks, which changes every token
3. an offline verifier plants fake identifiers in a corpus you define, runs the pipeline, and checks none survive
4. sync refuses to run unless that check is green, matches the current pipeline version, and is under seven days old

The verifier shares an author with the pipeline, so a green result means the failures I thought of didn't happen, never that none did. The guarantee lives in the allowlist.

## What it won't do

It's leakage reduction for records you control, not HIPAA or GDPR de-identification, and it has no legal or regulatory standing. Pointing it at regulated data would be worse than nothing, because it would feel like protection.

The name tokenizer is a heuristic with known misses, each pinned in the tests:

- names in all capitals or all lowercase pass through
- a surname that opens a sentence passes through
- two-letter names pass through
- a name with an apostrophe leaves its first fragment behind

A miss still leaks only inside a field a person already approved for sync, never one that wasn't supposed to leave. That's why the allowlist carries the guarantee instead of the tokenizer.

It ships no schema validation, one worked example rather than a library of surfaces, and no second deny layer.

## How I tested it

- 34 tests and a strict typecheck: `node --test tests/*.test.ts`
- the same planted record runs with each protection on and off: bypassing the allowlist, passing a field that should be tokenized, weakening the verifier's own allowlist
- every protection-off run leaks the complete planted set and every protection-on run leaks none, so no test can pass by accident

<details>
<summary>More on testing</summary>

The command line entry is tested as a real child process against real files, including through a symlink. The original had a launch guard that silently didn't fire under a symlink: nothing ran, nothing printed, and it exited 0, so a caller checking the exit code read a verification that never happened as a pass. That class of defect is removed here rather than patched. Design decisions: [docs/ADR.md](docs/ADR.md).

</details>

## License

MIT. See [LICENSE](LICENSE). No warranty. Security notes and how to report a problem: [SECURITY.md](SECURITY.md).

<!-- related:start -->
## Related

- [alert-redactor](https://github.com/justin-rhee/alert-redactor): builds alert text from exceptions without leaking record contents
- [transcript-redactor](https://github.com/justin-rhee/transcript-redactor): keeps credentials out of agent transcripts

Part of a small set of tools I pulled out of my own agent harness. I use them myself and read every issue. More on my [GitHub profile](https://github.com/justin-rhee).
<!-- related:end -->
