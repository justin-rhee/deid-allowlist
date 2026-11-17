# Security policy. deid-allowlist

## Posture

deid-allowlist is provided as-is, with NO WARRANTY (see LICENSE). Use it as one
control among several, never as a sole guarantee.

This is a security-oriented tool, so the honest ceiling applies: it **reduces,
does not eliminate**, the risk it addresses. Behavioral rules are defense-in-depth
on top of a structural limit, and the structural limit only holds if the host
environment actually enforces it (e.g. actually withholds the tools/permissions
the design assumes are withheld). State that assumption; do not let it read as a
promise the code can't keep.

## Validation status

I ran the offline test suite: all 34 tests pass, with `npm test` (`node --test tests/*.test.ts`), plus a strict typecheck with `npx tsc --noEmit -p tsconfig.build.json`. The tests cover the allowlist drop, the tokenizer and its documented misses, keyed tokens, the verifier, the command line entry, and importing the built package. They do not cover real-world data, other languages or name formats, a leaked or weak key, or any legal or regulatory standard. The planted-identifier corpus is small and written by me.

## Reporting a vulnerability

Report privately to https://github.com/justin-rhee. Please do not open a public issue for a
suspected vulnerability. give a reasonable window for a fix first.
