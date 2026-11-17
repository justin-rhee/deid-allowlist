/**
 * deid-allowlist — core (pure).
 *
 * A de-identification pipeline for records leaving a machine, built on a field ALLOWLIST rather
 * than a filter. The guarantee is: any field not explicitly named in a surface's allowlist is
 * DROPPED before the record leaves. That is the whole guarantee — it lives in the boring,
 * human-maintained allowlist, not in the tokenizer below.
 *
 *   1. Fields marked "pass" are structured/enumerated data (ids, statuses, counts, timestamps,
 *      enum labels) and sync verbatim — they carry no free text by construction.
 *   2. Fields marked "tokenize" are free-text fields an operator has explicitly approved to sync.
 *      They pass through deterministic entity tokenization first (see below).
 *   3. Fields marked "drop", and any field simply absent from the allowlist, never leave.
 *
 * The tokenizer is a best-effort heuristic layer on top of an already-approved field — regex and
 * capitalization patterns, not real named-entity recognition. It WILL miss things (ALL-CAPS
 * names, lowercase names, very short names — see tests/deid.test.ts for documented gaps). Do not
 * mistake a well-tokenized field for a proof of absence; the allowlist is what makes the
 * guarantee, because a field the tokenizer misses inside a "tokenize" field is still a narrower
 * failure than a field that should never have been synced at all.
 *
 * Stable tokens: the SAME source entity under the SAME key always maps to the SAME token (a
 * truncated HMAC-SHA256 of its type + normalized text), so relationships between records survive
 * de-identification with no stored mapping table and no state carried between calls. The key is
 * secret and caller-supplied (ctx.key, or the DEID_ALLOWLIST_KEY environment variable); there is
 * no default. Without the key a token cannot be tested against guessed values, and a different
 * key gives different tokens.
 *
 * Deterministic: no fs/network. Uses node:crypto HMAC only, and reads one environment variable.
 */
import { createHmac } from "node:crypto";

/** Bump on any change to tokenization or field-handling behavior. A verifier result stamped with
 *  an older version should be treated as stale — see verify.ts's freshness/version gate. */
export const DEID_VERSION = "deid-v2.0.0";

export type FieldMode = "pass" | "tokenize" | "drop";

/** One surface's allowlist: field name -> how it may leave. A field absent from this map is
 *  implicitly "drop" — applyAllowlist() only ever emits keys that are present here. */
export type SurfaceAllowlist = Record<string, FieldMode>;

/** Operator-supplied context. `entityList` is an optional set of known personal proper nouns
 *  (names, places, employers) the caller maintains privately and passes in at call time — this
 *  module never reads it from disk or stores it. When present, exact word-boundary matches are
 *  tokenized first, before the general heuristic pass. Empty by default; the mechanical and
 *  heuristic passes still run without it. */
export type DeidContext = {
  entityList?: readonly string[];
  /** Secret key for token HMACs, at least 32 characters (or bytes). Falls back to the
   *  DEID_ALLOWLIST_KEY environment variable. There is no default: with neither set,
   *  tokenizing throws. Keep it out of the records and out of version control. */
  key?: string | Uint8Array;
};

export const KEY_ENV_VAR = "DEID_ALLOWLIST_KEY";
export const MIN_KEY_LENGTH = 32;
const TOKEN_HEX_LENGTH = 16;

function resolveKey(ctx: DeidContext): string | Uint8Array {
  const key = ctx.key ?? process.env[KEY_ENV_VAR];
  if (key === undefined || key.length === 0) {
    throw new Error(
      `deid-allowlist needs a secret key to make tokens: pass { key } or set ${KEY_ENV_VAR} (e.g. openssl rand -hex 32)`,
    );
  }
  if (key.length < MIN_KEY_LENGTH) {
    throw new Error(`deid-allowlist key is too short: use at least ${MIN_KEY_LENGTH} characters (e.g. openssl rand -hex 32)`);
  }
  return key;
}

// ---------------------------------------------------------------------------------------------
// Stable tokenization: entity -> <TYPE_xxxxxxxxxxxxxxxx>. Deterministic (keyed HMAC), meaning-preserving.
// ---------------------------------------------------------------------------------------------
type Tok = (type: string, normalized: string) => string;

function makeToken(key: string | Uint8Array): Tok {
  return (type, normalized) => stableToken(key, type, normalized);
}

function stableToken(key: string | Uint8Array, type: string, normalized: string): string {
  const h = createHmac("sha256", key).update(`${type} ${normalized}`).digest("hex").slice(0, TOKEN_HEX_LENGTH);
  return `<${type}_${h}>`;
}

// Mechanical identifier patterns (deterministic, high-precision). Order matters: more specific
// first so a URL is not shredded into a date, etc.
const RE_URL = /\bhttps?:\/\/[^\s<>"')]+/gi;
const RE_EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const RE_HANDLE = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{2,})/g;
// Phone: a leading digit, then >=5 digits/phone-separators, then a trailing digit, bounded so it
// does not glue onto surrounding letters or a name token. A digit-count guard (7..15) in the
// callback rejects short numeric runs. Handles paren formats like "+1 (319) 555-0142".
const RE_PHONE = /(?<![\dA-Za-z_<])\+?\d[\d\s().\-]{5,}\d(?![\dA-Za-z_>])/g;
const RE_ISO_DATE = /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g;
const RE_US_DATE = /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g;
const RE_MONTH_DATE =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi;

// Sentence-initial / common capitalized words that are NOT personal entities and, when they lead
// a run of capitalized words, must NOT be absorbed into the name token (so "Wire Jordan Lee"
// tokenizes only "Jordan Lee" and preserves the verb "Wire"). This is a small, generic set of
// imperative verbs, articles, and pronouns for task/ticket-style text that often begins with a
// command word. Deliberately small; the heuristic still errs toward over-tokenizing when in
// doubt (a false-positive tokenization is safe — a false negative is the thing that matters).
const LEADING_STOPWORDS = new Set<string>([
  "The", "A", "An", "This", "That", "These", "Those", "It", "We", "You", "They", "Our", "My", "His", "Her", "Their",
  "Wire", "Ship", "Build", "Add", "Fix", "Refactor", "Update", "Create", "Remove", "Delete", "Rename",
  "Move", "Port", "Migrate", "Implement", "Enable", "Disable", "Harden", "Sync", "Draft", "Review",
  "When", "Because", "After", "Before", "During", "While", "If", "Once",
]);

// Consecutive Capitalized-Word sequences (2+), OR a single capitalized word that is not a
// stopword and not the first token of the string. Aggressive by design.
const RE_PROPER_SEQ = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
const RE_PROPER_SINGLE = /\b([A-Z][a-z]{2,})\b/g;

function tokenizeMechanical(text: string, stableToken: Tok): string {
  let t = text;
  t = t.replace(RE_URL, (m) => stableToken("URL", m.toLowerCase()));
  t = t.replace(RE_EMAIL, (m) => stableToken("EMAIL", m.toLowerCase()));
  t = t.replace(RE_HANDLE, (_m, pre: string, h: string) => `${pre}${stableToken("HANDLE", h.toLowerCase())}`);
  t = t.replace(RE_ISO_DATE, (m) => stableToken("DATE", m.replace(/\//g, "-")));
  t = t.replace(RE_US_DATE, (m) => stableToken("DATE", m.replace(/\//g, "-")));
  t = t.replace(RE_MONTH_DATE, (m) => stableToken("DATE", m.toLowerCase().replace(/\s+/g, " ").trim()));
  t = t.replace(RE_PHONE, (m) => {
    const digits = m.replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15 ? stableToken("PHONE", digits) : m;
  });
  return t;
}

/** Tokenize a run of capitalized words, but strip leading stopwords (verbs/articles) so they are
 *  preserved and not absorbed into the NAME token. */
function tokenizeSequence(seq: string, stableToken: Tok): string {
  const words = seq.split(/\s+/);
  let lead = 0;
  while (lead < words.length && LEADING_STOPWORDS.has(words[lead]!)) lead++;
  if (lead >= words.length) return seq; // all stopwords — nothing to tokenize
  const kept = words.slice(0, lead);
  const nameWords = words.slice(lead);
  const token = stableToken("NAME", nameWords.join(" ").toLowerCase());
  return kept.length ? `${kept.join(" ")} ${token}` : token;
}

function tokenizeProperNouns(text: string, stableToken: Tok): string {
  let t = text.replace(RE_PROPER_SEQ, (m) => tokenizeSequence(m, stableToken));
  t = t.replace(RE_PROPER_SINGLE, (m, w: string, offset: number) => {
    if (offset === 0) return m; // sentence-initial lone capital is usually not an identifier
    if (LEADING_STOPWORDS.has(w)) return m;
    return stableToken("NAME", w.toLowerCase());
  });
  return t;
}

function tokenizeEntityList(text: string, entityList: readonly string[], stableToken: Tok): string {
  let t = text;
  for (const raw of entityList) {
    const e = raw.trim();
    if (!e) continue;
    const esc = e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${esc}\\b`, "gi");
    t = t.replace(re, stableToken("NAME", e.toLowerCase()));
  }
  return t;
}

/**
 * Tokenize free text deterministically. Order: operator entity-list (exact known entities) ->
 * mechanical identifiers (dates/emails/urls/handles/phones) -> proper-noun heuristic. The result
 * is stable and meaning-preserving (same entity -> same token everywhere).
 */
export function tokenizeEntities(text: string, ctx: DeidContext = {}): string {
  if (typeof text !== "string" || text.length === 0) return text;
  const tok = makeToken(resolveKey(ctx));
  let t = text;
  if (ctx.entityList && ctx.entityList.length) t = tokenizeEntityList(t, ctx.entityList, tok);
  t = tokenizeMechanical(t, tok);
  t = tokenizeProperNouns(t, tok);
  return t;
}

/** Apply one field's mode. `drop` returns undefined (caller omits the key). */
export function deidField(value: unknown, mode: FieldMode, ctx: DeidContext = {}): unknown {
  if (mode === "drop") return undefined;
  if (mode === "pass") return value;
  // tokenize
  if (typeof value === "string") return tokenizeEntities(value, ctx);
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? tokenizeEntities(v, ctx) : v));
  return value; // non-string structured value marked tokenize: pass through (nothing to tokenize)
}

/**
 * Apply a surface allowlist to a source record. Returns a NEW object containing ONLY allowlisted
 * fields, each processed by its mode. Fields absent from the allowlist are DROPPED — this is the
 * central guarantee of the whole package: it is enforced here, by construction, not by scanning
 * for what to remove.
 *
 * The caller is responsible for adding any envelope/metadata fields (e.g. a record id, a sync
 * timestamp, this module's DEID_VERSION) — this function only ever touches allowlisted fields.
 */
export function applyAllowlist(
  record: Record<string, unknown>,
  allowlist: SurfaceAllowlist,
  ctx: DeidContext = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, mode] of Object.entries(allowlist)) {
    if (!(field in record)) continue;
    const processed = deidField(record[field], mode, ctx);
    if (processed !== undefined) out[field] = processed;
  }
  return out;
}
