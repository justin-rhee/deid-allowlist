/**
 * deid-allowlist — offline verification core (pure).
 *
 * Read this before trusting a green result: this verifier is written by the same person who
 * wrote the pipeline it checks. A synthetic planted-identifier corpus can prove that specific,
 * anticipated leaks do NOT happen; it cannot prove that no leak of any kind can ever happen. A
 * green run here is NECESSARY, NOT SUFFICIENT. The real guarantee is the field allowlist
 * (applyAllowlist in ./deid.ts) — this module exists to catch regressions in it, not to replace
 * it. Do not point this at data you don't already trust the allowlist for.
 *
 * Given a corpus of cases — each a raw record, the allowlist it will be projected through, and
 * the set of identifiers that must never appear in the output — this module asserts:
 *   (a) ZERO planted identifiers leak into the projected content (the leakage test), and
 *   (b) meaning-preserving substrings survive the projection (the meaning test).
 *
 * PURE: corpus object in, result out. No fs/network/clock. Unit-tested offline. The impure
 * runner (runVerify.ts) supplies a corpus from a file and reports pass/fail as a process exit
 * code and a written result file.
 */
import { applyAllowlist } from "./deid.ts";
import type { DeidContext, SurfaceAllowlist } from "./deid.ts";
import { DEID_VERSION } from "./deid.ts";

export type CorpusCase = {
  /** Human-readable case id, surfaced in any leak/miss reported against it. */
  id: string;
  /** The allowlist this case's raw record is projected through. Each case names its own so one
   *  corpus file can exercise several different allowlists side by side. */
  allowlist: SurfaceAllowlist;
  /** The source record, including fields NOT on the allowlist — those are the ones proving the
   *  drop behavior actually drops. */
  raw: Record<string, unknown>;
  /** Planted identifiers (names, emails, ids, etc.) that must not appear anywhere in the
   *  projected output, in any field. */
  mustNotLeak?: string[];
  /** Substrings that must survive into the projected output (e.g. a plain word around a
   *  tokenized name, or a structured field's value) — proves tokenization isn't over-eager. */
  mustPreserveMeaning?: string[];
};

export type Corpus = {
  /** Optional: the deid version this corpus was authored against. Purely informational here —
   *  the freshness/version gate below is what a caller should actually enforce before syncing. */
  authoredForVersion?: string;
  cases: CorpusCase[];
};

export type Leak = { caseId: string; identifier: string };
export type MeaningMiss = { caseId: string; token: string };

export type VerifyResult = {
  status: "green" | "red";
  deidVersion: string;
  plantedCount: number;
  leakedCount: number;
  meaningPreserved: boolean;
  leaks: Leak[];
  meaningMisses: MeaningMiss[];
  notes: string[];
};

/** Serialize projected content to a single scannable string. Scanning the serialized form (not
 *  walking field-by-field) means a leak hiding in a nested structure is still caught. */
function contentString(content: Record<string, unknown>): string {
  return JSON.stringify(content);
}

/**
 * Run the full allowlist + tokenization pipeline over every case in the corpus and check for
 * leaked identifiers and lost meaning. This function IS the core of the offline verifier —
 * runVerify.ts just calls this against a corpus loaded from disk and reports the result.
 */
export function verifyCorpus(corpus: Corpus, ctx: DeidContext = {}): VerifyResult {
  const leaks: Leak[] = [];
  const meaningMisses: MeaningMiss[] = [];
  const notes: string[] = [];
  let plantedCount = 0;
  let meaningPreserved = true;

  for (const c of corpus.cases) {
    const planted = c.mustNotLeak ?? [];
    plantedCount += planted.length;

    const projected = applyAllowlist(c.raw, c.allowlist, ctx);
    const projectedString = contentString(projected);

    for (const id of planted) {
      if (id.length > 0 && projectedString.includes(id)) {
        leaks.push({ caseId: c.id, identifier: id });
      }
    }
    for (const token of c.mustPreserveMeaning ?? []) {
      if (!projectedString.includes(token)) {
        meaningMisses.push({ caseId: c.id, token });
        meaningPreserved = false;
      }
    }
    if (planted.length === 0 && (!c.mustPreserveMeaning || c.mustPreserveMeaning.length === 0)) {
      notes.push(`case ${c.id}: no mustNotLeak or mustPreserveMeaning assertions — this case verifies nothing`);
    }
  }

  const leakedCount = leaks.length;
  const status: "green" | "red" = leakedCount === 0 && meaningPreserved ? "green" : "red";

  return { status, deidVersion: DEID_VERSION, plantedCount, leakedCount, meaningPreserved, leaks, meaningMisses, notes };
}

/** The record shape a caller persists after running the verifier (see runVerify.ts). */
export type VerifyRunRecord = {
  status: "green" | "red";
  deidVersion: string;
  ranAt: number; // epoch ms
};

/**
 * Freshness + version gate. A caller's sync path should refuse to run unless this returns true:
 * the latest verification run must be green, must have run against the CURRENT deid version (a
 * stale-but-green run from before a tokenizer change proves nothing about the current code), and
 * must be no older than maxAgeMs (default 7 days) — an old green run stops meaning "the pipeline
 * is currently trustworthy" the longer nobody has re-run it.
 */
export function verifyGateOpen(
  row: VerifyRunRecord | null,
  now: number,
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000,
): boolean {
  if (!row) return false;
  if (row.status !== "green") return false;
  if (row.deidVersion !== DEID_VERSION) return false;
  if (now - row.ranAt > maxAgeMs) return false;
  return true;
}
