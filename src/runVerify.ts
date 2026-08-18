/**
 * deid-allowlist — offline verification runner (impure CLI shell).
 *
 * Runs the full de-id pipeline against a planted-identifier corpus with no network and no
 * database — the check works standalone, before anything real ever syncs:
 *
 *   node src/runVerify.ts <corpus.json> [result.json] [halt.flag]
 *
 * Loads the corpus, calls verifyCorpus() (pure, see verify.ts), optionally writes the full
 * result to <result.json>, and optionally writes/clears a halt-flag file at <halt.flag> — present
 * when the run is red, absent when green, so a caller's sync loop can fail-closed on the flag's
 * mere existence without re-parsing the result file. Exits 0 on green, 1 on red, 2 on a usage or
 * load error (bad path, unparseable JSON) — a caller's gate should treat anything but a clean 0
 * as "do not sync."
 *
 * This file is a CLI entry point ONLY: it runs unconditionally when loaded and is not meant to be
 * imported as a library. (An earlier version of this pattern gated execution on
 * `import.meta.url === file://${process.argv[1]}`, which silently does not run when the script is
 * invoked through a symlink — Node resolves import.meta.url through the symlink but leaves
 * process.argv[1] as the literal invoked path, so the two never match. That produces a script
 * that prints nothing and exits 0 under a perfectly normal invocation style, which is worse than
 * a crash. Import the pure functions from verify.ts and deid.ts instead; run this file as a
 * process, never as a module.)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { verifyCorpus } from "./verify.ts";
import type { Corpus } from "./verify.ts";

function ensureDirFor(path: string): void {
  const d = dirname(path);
  if (d && d !== "." && !existsSync(d)) mkdirSync(d, { recursive: true });
}

function usage(): never {
  process.stderr.write(
    "usage: node src/runVerify.ts <corpus.json> [result.json] [halt.flag]\n" +
      "  corpus.json  planted-identifier corpus to run the pipeline against (required)\n" +
      "  result.json  where to write the full VerifyResult (optional; stdout summary always prints)\n" +
      "  halt.flag    path to write/clear a fail-closed halt marker (optional)\n",
  );
  process.exit(2);
}

function main(): void {
  const [, , corpusPath, resultPath, haltFlagPath] = process.argv;
  if (!corpusPath) usage();

  let corpus: Corpus;
  try {
    corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as Corpus;
  } catch (err) {
    process.stderr.write(`could not load corpus at ${corpusPath}: ${(err as Error).message}\n`);
    process.exit(2);
  }
  if (!corpus || !Array.isArray(corpus.cases)) {
    process.stderr.write(`corpus at ${corpusPath} has no "cases" array — nothing to verify\n`);
    process.exit(2);
  }

  const result = verifyCorpus(corpus);
  const ranAt = Date.now();

  if (resultPath) {
    ensureDirFor(resultPath);
    writeFileSync(resultPath, JSON.stringify({ ranAt, ...result }, null, 2));
  }

  if (haltFlagPath) {
    ensureDirFor(haltFlagPath);
    if (result.status === "red") {
      writeFileSync(haltFlagPath, `red ${ranAt} leaked=${result.leakedCount} meaningPreserved=${result.meaningPreserved}\n`);
    } else if (existsSync(haltFlagPath)) {
      rmSync(haltFlagPath);
    }
  }

  process.stdout.write(
    `de-id verification: ${result.status.toUpperCase()} — planted=${result.plantedCount} leaked=${result.leakedCount} ` +
      `meaningPreserved=${result.meaningPreserved} deidVersion=${result.deidVersion}\n`,
  );
  if (result.status === "red") {
    process.stdout.write(`leaks=${JSON.stringify(result.leaks)} meaningMisses=${JSON.stringify(result.meaningMisses)}\n`);
  }
  if (result.notes.length) process.stdout.write(`notes=${JSON.stringify(result.notes)}\n`);

  process.exit(result.status === "green" ? 0 : 1);
}

main();
