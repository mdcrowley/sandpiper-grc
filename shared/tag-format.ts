// Asset tag values and formats (wave 13, E37-02, E38-05): pure functions shared by the server
// (server/src), the web application (web/src) and the mobile app (mobile/), so the three always
// agree on how a value is compared, checked and read. No imports, no platform APIs.
//
// Import it as:
//   server  (server/src/modules/tags/x.ts):  import { valueKey } from '../../../../shared/tag-format.ts';
//   web     (web/src/modules/tags/x.tsx):     import { valueKey } from '../../../../shared/tag-format.ts';
//   mobile  (mobile/src/tags/x.ts):           import { valueKey } from '../../../shared/tag-format.ts';
//
// Patterns (a format's `pattern` and `extract_pattern`) are a small safe subset of regular
// expressions run by the matcher below, never by `RegExp`, so a pattern typed by an administrator
// cannot hang the server or the phone (see `compileSafePattern`).

/** How a value reached the application. */
export type TagSource = 'code' | 'text' | 'typed' | 'handheld';
export type TagCharacters = 'digits' | 'alphanumeric' | 'pattern';
export type CheckScheme = 'none' | 'mod10' | 'mod11' | 'mod36';
/** How tags of a format carry their value: any way, printed text only, a barcode or 2D code only, or both. */
export type TagCarrier = 'any' | 'text' | 'code' | 'both';

/** A tag format as the API gives it (`GET /api/asset-tags/formats`, `GET /api/mobile/settings`). */
export interface TagFormat {
  id: string;
  name: string;
  characters: TagCharacters;
  /** With characters 'pattern': a safe pattern the whole value key must match. */
  pattern: string | null;
  /** Printed before the number part, for example 'TA-'; compared by its value key ('TA'). */
  prefix: string;
  /** Length of the part after the prefix (check character included), in value-key characters. */
  lengthMin: number | null;
  lengthMax: number | null;
  checkCharacter: CheckScheme;
  carrier: TagCarrier;
  /** A safe pattern with one group `( )`: the part of a code's content that is the value. */
  extractPattern: string | null;
  /** Record types that use it; empty = every taggable type. */
  recordTypes: string[];
  active: boolean;
}

/** Longest tag value (as read). */
export const MAX_TAG_VALUE = 200;
/** Longest code content the extraction pattern is run on. */
export const MAX_CODE_CONTENT = 2000;
/** Longest pattern. */
export const MAX_PATTERN = 120;
/** Most steps the matcher takes on one input before giving up (no match). */
export const MATCH_STEP_BUDGET = 50_000;

// ---------- comparison ----------

// Whitespace, every kind of dash and hyphen, underscores and invisible control characters.
const IGNORED = /[\s\-_‐-―−﹘﹣－\p{Cc}\p{Cf}]/gu;

/**
 * The one comparison form of a tag value, for every source (code, text, typed, handheld): trimmed,
 * uppercase, without spaces, dashes, underscores or control characters. `tag_assignments.value_key`,
 * stock and lookups all use it, so "ta-118 342", "TA118342" and a code holding "TA_118342" are the
 * same tag. Leading zeros count ("004521" is not "4521").
 */
export function valueKey(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  return String(raw).normalize('NFKC').replace(IGNORED, '').toUpperCase();
}

/** A value as stored: trimmed, inner runs of whitespace made one space, at most MAX_TAG_VALUE characters; '' when empty. */
export function cleanValue(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  return String(raw).normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim().replace(/\s+/g, ' ');
}

// ---------- check characters ----------

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * The check character for `body` (the number part without its check character, as a value key), or
 * null when the scheme cannot apply to it (letters in a digits-only scheme, or empty).
 * - mod10: the Luhn algorithm (digits only), as most bought tags with a check digit use.
 * - mod11: weights 2, 3, 4, 5, 6, 7 repeating from the right (digits only); 10 is written 'X'.
 * - mod36: ISO/IEC 7064 MOD 37,36 hybrid system (digits and letters), one character 0-9 or A-Z.
 */
export function checkCharacter(body: string, scheme: CheckScheme): string | null {
  if (scheme === 'none') return '';
  if (!body) return null;
  if (scheme === 'mod10' || scheme === 'mod11') {
    if (!/^[0-9]+$/.test(body)) return null;
    const digits = [...body].map(Number).reverse();
    if (scheme === 'mod10') {
      const sum = digits.reduce((s, d, i) => {
        if (i % 2 === 1) return s + d;
        const x = d * 2;
        return s + (x > 9 ? x - 9 : x);
      }, 0);
      return String((10 - (sum % 10)) % 10);
    }
    const sum = digits.reduce((s, d, i) => s + d * (2 + (i % 6)), 0);
    const c = (11 - (sum % 11)) % 11;
    return c === 10 ? 'X' : String(c);
  }
  // mod36: ISO/IEC 7064 hybrid, M = 36.
  if (!/^[0-9A-Z]+$/.test(body)) return null;
  let t = 36;
  for (const ch of body) {
    t = (t + ALNUM.indexOf(ch)) % 36;
    if (t === 0) t = 36;
    t = (t * 2) % 37;
  }
  return ALNUM[(37 - t) % 36];
}

/** Whether the last character of `withCheck` (a value key's number part) is right for the rest. */
export function validCheckCharacter(withCheck: string, scheme: CheckScheme): boolean {
  if (scheme === 'none') return true;
  if (withCheck.length < 2) return false;
  const expected = checkCharacter(withCheck.slice(0, -1), scheme);
  return expected !== null && expected === withCheck.slice(-1);
}

/** The value of number `n` of a sequence: prefix, the number zero-padded to `digits`, then its check character. */
export function sequenceValue(n: number | bigint, opts: { prefix?: string; digits: number; checkCharacter?: CheckScheme }): string {
  const body = String(n).padStart(opts.digits, '0');
  const check = checkCharacter(body, opts.checkCharacter ?? 'none') ?? '';
  return `${opts.prefix ?? ''}${body}${check}`;
}

// ---------- safe patterns ----------

type Atom =
  | { kind: 'char'; ch: string }
  | { kind: 'any' }
  | { kind: 'set'; negate: boolean; ranges: [number, number][] };
interface Item { atom: Atom; min: number; max: number; group: boolean }

/** A compiled safe pattern. */
export interface SafePattern {
  source: string;
  items: Item[];
  anchoredStart: boolean;
  anchoredEnd: boolean;
  /** Whether it has a group (the part an extraction pattern returns). */
  hasGroup: boolean;
}

export type PatternResult = { ok: true; pattern: SafePattern } | { ok: false; error: string };

const MAX_REPEAT = 200;
const MAX_UNBOUNDED = 4;

/**
 * Compiles a safe pattern, or says plainly what is not allowed. The subset: literal characters
 * (escape `\ . [ ] ( ) { } * + ? ^ $ |` with a backslash), `.` (any character), `\d` (a digit), `\w`
 * (a letter, digit or underscore), `\s` (a space), character sets `[A-Z0-9]` and `[^...]`; each of
 * these may be followed by one quantifier `?`, `*`, `+`, `{n}`, `{n,}` or `{n,m}` (at most 200); `^`
 * at the start and `$` at the end; and at most one group `( ... )` of these, not nested and not
 * itself repeated. No alternation (`|`), backreferences or lookaround. At most 120 characters and four
 * open-ended repeats. Matching also stops after a fixed number of steps, so no pattern can hang.
 */
export function compileSafePattern(source: string): PatternResult {
  if (typeof source !== 'string' || !source) return { ok: false, error: 'Type a pattern.' };
  if (source.length > MAX_PATTERN) return { ok: false, error: `A pattern can be at most ${MAX_PATTERN} characters.` };
  let i = 0;
  const items: Item[] = [];
  let anchoredStart = false;
  let anchoredEnd = false;
  let inGroup = false;
  let groups = 0;
  let unbounded = 0;
  if (source[0] === '^') { anchoredStart = true; i = 1; }
  const fail = (error: string): PatternResult => ({ ok: false, error });
  while (i < source.length) {
    const c = source[i];
    if (c === '$') {
      if (i !== source.length - 1) return fail('"$" may only end the pattern.');
      if (inGroup) return fail('Close the group before "$".');
      anchoredEnd = true; i++; continue;
    }
    if (c === '(') {
      if (inGroup) return fail('Groups cannot be nested.');
      if (groups) return fail('A pattern may have one group only.');
      if (source[i + 1] === '?') return fail('Lookaround and named groups are not allowed.');
      inGroup = true; groups++; i++; continue;
    }
    if (c === ')') {
      if (!inGroup) return fail('A ")" has no "(" before it.');
      inGroup = false; i++;
      if (source[i] !== undefined && '?*+{'.includes(source[i])) return fail('A group cannot be repeated.');
      continue;
    }
    if (c === '|') return fail('Alternatives ("|") are not allowed.');
    if ('?*+{'.includes(c)) return fail(`"${c}" must follow a character or set.`);
    if (c === '^') return fail('"^" may only start the pattern.');
    let atom: Atom;
    if (c === '.') { atom = { kind: 'any' }; i++; }
    else if (c === '\\') {
      const n = source[i + 1];
      if (n === undefined) return fail('The pattern ends with "\\".');
      if (n === 'd') atom = { kind: 'set', negate: false, ranges: [[48, 57]] };
      else if (n === 'w') atom = { kind: 'set', negate: false, ranges: [[48, 57], [65, 90], [97, 122], [95, 95]] };
      else if (n === 's') atom = { kind: 'set', negate: false, ranges: [[32, 32], [9, 13]] };
      else if (/[0-9bBDWSpPkuxc]/.test(n)) return fail(`"\\${n}" is not allowed.`);
      else atom = { kind: 'char', ch: n };
      i += 2;
    } else if (c === '[') {
      let j = i + 1;
      const negate = source[j] === '^';
      if (negate) j++;
      const ranges: [number, number][] = [];
      let closed = false;
      while (j < source.length) {
        let ch = source[j];
        if (ch === ']' && ranges.length) { closed = true; j++; break; }
        if (ch === '\\') {
          const n = source[j + 1];
          if (n === 'd') { ranges.push([48, 57]); j += 2; continue; }
          if (n === undefined) break;
          ch = n; j++;
        }
        const lo = ch.codePointAt(0)!;
        if (source[j + 1] === '-' && source[j + 2] !== undefined && source[j + 2] !== ']') {
          const hi = source[j + 2].codePointAt(0)!;
          if (hi < lo) return fail(`The range ${ch}-${source[j + 2]} is backwards.`);
          ranges.push([lo, hi]); j += 3;
        } else { ranges.push([lo, lo]); j++; }
      }
      if (!closed) return fail('A "[" is not closed.');
      atom = { kind: 'set', negate, ranges };
      i = j;
    } else { atom = { kind: 'char', ch: c }; i++; }
    let min = 1;
    let max = 1;
    const q = source[i];
    if (q === '?') { min = 0; max = 1; i++; }
    else if (q === '*') { min = 0; max = Infinity; i++; }
    else if (q === '+') { min = 1; max = Infinity; i++; }
    else if (q === '{') {
      const m = /^\{(\d{1,3})(,(\d{0,3}))?\}/.exec(source.slice(i));
      if (!m) return fail('Write a repeat as {n}, {n,} or {n,m}.');
      min = Number(m[1]);
      max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3]);
      if (min > MAX_REPEAT || (max !== Infinity && max > MAX_REPEAT)) return fail(`A repeat can be at most ${MAX_REPEAT}.`);
      if (max < min) return fail('In {n,m}, m must not be less than n.');
      i += m[0].length;
    }
    if (source[i] !== undefined && '?*+{'.includes(source[i])) return fail('A character can carry one repeat only.');
    if (max === Infinity && ++unbounded > MAX_UNBOUNDED) return fail(`At most ${MAX_UNBOUNDED} open-ended repeats (* + {n,}).`);
    items.push({ atom, min, max, group: inGroup });
  }
  if (inGroup) return fail('A "(" is not closed.');
  if (!items.length) return fail('Type a pattern.');
  return { ok: true, pattern: { source, items, anchoredStart, anchoredEnd, hasGroup: groups === 1 } };
}

function atomMatches(atom: Atom, cp: number): boolean {
  if (atom.kind === 'any') return true;
  if (atom.kind === 'char') return atom.ch.codePointAt(0) === cp;
  const inSet = atom.ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
  return atom.negate ? !inSet : inSet;
}

/** The result of running a safe pattern: whether it matched, the whole match and the group. */
export interface SafeMatch { matched: boolean; whole: string | null; group: string | null; budgetExceeded: boolean }

/**
 * Runs a compiled pattern on `text`. With `whole: true` the pattern must match all of the text (as if
 * it were written with ^ and $); otherwise it is searched for, leftmost first, with greedy repeats.
 * Gives up (no match, `budgetExceeded`) after MATCH_STEP_BUDGET steps.
 */
export function safeMatch(p: SafePattern, text: string, opts: { whole?: boolean } = {}): SafeMatch {
  const cps = [...text].map((c) => c.codePointAt(0)!);
  const startAnchor = opts.whole || p.anchoredStart;
  const endAnchor = opts.whole || p.anchoredEnd;
  let steps = 0;
  let exceeded = false;
  let gStart = -1;
  let gEnd = -1;
  const groupFirst = p.items.findIndex((it) => it.group);
  const groupLast = p.items.length - 1 - [...p.items].reverse().findIndex((it) => it.group);

  // Backtracking over a flat list of single-atom repeats, with a step budget.
  const run = (k: number, pos: number): number => {
    if (++steps > MATCH_STEP_BUDGET) { exceeded = true; return -1; }
    if (k === p.items.length) return !endAnchor || pos === cps.length ? pos : -1;
    const it = p.items[k];
    let n = 0;
    while (n < it.max && pos + n < cps.length && atomMatches(it.atom, cps[pos + n])) {
      n++;
      if (++steps > MATCH_STEP_BUDGET) { exceeded = true; return -1; }
    }
    for (; n >= it.min; n--) {
      const end = run(k + 1, pos + n);
      if (exceeded) return -1;
      if (end >= 0) {
        if (k === groupFirst) gStart = pos;
        if (k === groupLast) gEnd = pos + n;
        return end;
      }
    }
    return -1;
  };

  const lastStart = startAnchor ? 0 : cps.length;
  for (let s = 0; s <= lastStart; s++) {
    gStart = -1; gEnd = -1;
    const end = run(0, s);
    if (exceeded) return { matched: false, whole: null, group: null, budgetExceeded: true };
    if (end >= 0) {
      const slice = (a: number, b: number) => String.fromCodePoint(...cps.slice(a, b));
      return {
        matched: true, whole: slice(s, end),
        group: p.hasGroup && gStart >= 0 && gEnd >= gStart ? slice(gStart, gEnd) : null,
        budgetExceeded: false,
      };
    }
  }
  return { matched: false, whole: null, group: null, budgetExceeded: false };
}

// ---------- formats ----------

export type FormatMismatch = 'empty' | 'too_long' | 'carrier' | 'prefix' | 'characters' | 'length' | 'check' | 'pattern' | 'bad_pattern';

export type FormatMatch =
  | { ok: true; key: string; prefix: string; numberPart: string; checked: boolean }
  | { ok: false; reason: FormatMismatch };

/** Whether a format accepts values from this source: the carrier applies to the camera (code, text) only. */
export function carrierAllows(carrier: TagCarrier, source: TagSource): boolean {
  if (source === 'typed' || source === 'handheld') return true;
  if (carrier === 'any' || carrier === 'both') return true;
  return carrier === source;
}

/**
 * Whether `value` (as read, typed or decoded) is a value of `format` read this way. Everything is
 * compared by value key: the prefix's key must start it, the rest (the number part, check character
 * included) must be digits (`digits`) or letters and digits (`alphanumeric`) within the length, and
 * its check character must be right. A `pattern` format's pattern must match the whole value key.
 * For a code, apply `extractFromCode` first.
 */
export function matchFormat(value: string, format: TagFormat, source: TagSource): FormatMatch {
  const cleaned = cleanValue(value);
  if (!cleaned) return { ok: false, reason: 'empty' };
  if (cleaned.length > MAX_TAG_VALUE) return { ok: false, reason: 'too_long' };
  if (!carrierAllows(format.carrier, source)) return { ok: false, reason: 'carrier' };
  const key = valueKey(cleaned);
  const prefix = valueKey(format.prefix);
  if (!key.startsWith(prefix)) return { ok: false, reason: 'prefix' };
  const numberPart = key.slice(prefix.length);
  if (!numberPart) return { ok: false, reason: 'empty' };
  if (format.characters === 'pattern') {
    const compiled = compileSafePattern(format.pattern ?? '');
    if (!compiled.ok) return { ok: false, reason: 'bad_pattern' };
    if (!safeMatch(compiled.pattern, key, { whole: true }).matched) return { ok: false, reason: 'pattern' };
  } else {
    // Digits only, except that a mod 11 check character may be X.
    const fits = format.characters === 'alphanumeric'
      ? /^[0-9A-Z]+$/.test(numberPart)
      : format.checkCharacter === 'mod11' ? /^[0-9]*[0-9X]$/.test(numberPart) : /^[0-9]+$/.test(numberPart);
    if (!fits) return { ok: false, reason: 'characters' };
  }
  if ((format.lengthMin !== null && numberPart.length < format.lengthMin) || (format.lengthMax !== null && numberPart.length > format.lengthMax)) {
    return { ok: false, reason: 'length' };
  }
  if (format.checkCharacter !== 'none' && !validCheckCharacter(numberPart, format.checkCharacter)) return { ok: false, reason: 'check' };
  return { ok: true, key, prefix, numberPart, checked: format.checkCharacter !== 'none' };
}

/** The active formats that apply to a record type (all active ones without a type). */
export function formatsFor(formats: TagFormat[], recordType?: string): TagFormat[] {
  return formats.filter((f) => f.active && (!recordType || !f.recordTypes.length || f.recordTypes.includes(recordType)));
}

/** The first active format `value` matches, with the match; null when none does. */
export function firstMatchingFormat(value: string, formats: TagFormat[], source: TagSource): { format: TagFormat; match: Extract<FormatMatch, { ok: true }> } | null {
  for (const format of formats) {
    if (!format.active) continue;
    const match = matchFormat(value, format, source);
    if (match.ok) return { format, match };
  }
  return null;
}

/**
 * The value a barcode or 2D code holds: the format's extraction pattern's group when the pattern is
 * found in the content, otherwise the whole content (trimmed). Never opens or follows anything the
 * code holds; content beyond MAX_CODE_CONTENT characters is not searched.
 */
export function extractFromCode(content: string, format: Pick<TagFormat, 'extractPattern'> | null): { value: string; extracted: boolean } {
  const whole = cleanValue(content);
  if (!format?.extractPattern || content.length > MAX_CODE_CONTENT) return { value: whole, extracted: false };
  const compiled = compileSafePattern(format.extractPattern);
  if (!compiled.ok) return { value: whole, extracted: false };
  const m = safeMatch(compiled.pattern, content);
  if (!m.matched) return { value: whole, extracted: false };
  const part = cleanValue(compiled.pattern.hasGroup ? m.group : m.whole);
  return part ? { value: part, extracted: true } : { value: whole, extracted: false };
}

/** Without any format: printed text is offered (for the person to confirm) when it is 3 to 40 letters, digits and dashes. */
export function plainTextCandidate(text: string): string | null {
  const v = cleanValue(text);
  return /^[0-9A-Za-z][0-9A-Za-z\- ]{1,38}[0-9A-Za-z]$/.test(v) && valueKey(v).length >= 3 ? v : null;
}

// ---------- look-alike characters ----------

/** Characters text recognition confuses with digits, and the digit each stands for. */
export const DIGIT_LOOKALIKES: Record<string, string> = { O: '0', o: '0', I: '1', l: '1', i: '1', S: '5', s: '5', B: '8' };
/** Pairs ambiguous in letters-and-digits values (each may be either). */
const AMBIGUOUS: Record<string, string> = { '0': 'O', O: '0', '1': 'I', I: '1', '5': 'S', S: '5', '8': 'B', B: '8' };

/**
 * Corrections of text read by the camera, as value keys that match the format, best first; at most
 * `max`. Without a format: the text's own key only.
 * - Digits-only formats: in the part after the prefix, O becomes 0, I and l become 1, S becomes 5 and
 *   B becomes 8 (one corrected value).
 * - Letters-and-digits and pattern formats: the value itself, then values with ambiguous characters
 *   (0/O, 1/I, 5/S, 8/B) swapped, fewest swaps first, for the server to try (§5.5 step 5).
 * Only variants that pass the format (its check character included) are returned.
 */
export function lookAlikeVariants(text: string, format: TagFormat | null, max = 8): string[] {
  const cleaned = cleanValue(text);
  if (!cleaned) return [];
  if (!format) return [valueKey(cleaned)];
  const passes = (v: string) => matchFormat(v, format, 'text').ok;
  const prefixKey = valueKey(format.prefix);
  if (format.characters === 'digits') {
    // Correct only after the prefix, so letters of the prefix are kept.
    const raw = cleaned.replace(IGNORED, '');
    const head = raw.slice(0, prefixKey.length);
    if (head.toUpperCase() !== prefixKey) return [];
    const fixed = valueKey(head + [...raw.slice(prefixKey.length)].map((c) => DIGIT_LOOKALIKES[c] ?? c).join(''));
    return passes(fixed) ? [fixed] : [];
  }
  const key = valueKey(cleaned);
  if (!key.startsWith(prefixKey)) return [];
  const body = key.slice(prefixKey.length);
  const positions = [...body].map((c, i) => (AMBIGUOUS[c] ? i : -1)).filter((i) => i >= 0).slice(0, 12);
  const out: string[] = [];
  const seen = new Set<string>();
  // Breadth first by number of swaps: 0, 1, 2, ... until `max` variants pass or the swaps run out.
  let frontier: number[][] = [[]];
  for (let swaps = 0; swaps <= positions.length && out.length < max; swaps++) {
    const next: number[][] = [];
    for (const combo of frontier) {
      const chars = [...body];
      for (const p of combo) chars[p] = AMBIGUOUS[chars[p]];
      const candidate = prefixKey + chars.join('');
      if (!seen.has(candidate)) {
        seen.add(candidate);
        if (passes(candidate)) { out.push(candidate); if (out.length >= max) break; }
      }
      const last = combo.length ? positions.indexOf(combo[combo.length - 1]) : -1;
      for (let j = last + 1; j < positions.length; j++) next.push([...combo, positions[j]]);
    }
    frontier = next.slice(0, 4096);
  }
  return out;
}
