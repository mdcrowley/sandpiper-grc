// Working out tag values from what the camera read (spec §5.5, E38-05). Pure functions: the camera
// (src/camera) turns each frame or still picture into `FrameReads` (decoded codes and lines of text,
// with where they are), and these rules turn that into readings: values, how they were read and how
// far they can be trusted. The value rules themselves (formats, check characters, look-alikes,
// extraction) are shared with the server and the web in ../../../shared/tag-format.ts.
//
//  1. Codes are exact. A format's extraction pattern takes the value out of a code that holds more;
//     otherwise the whole content is the value. A code is enough on its own.
//  2. Printed text is compared with the formats that tags may carry as text, check character
//     included; digits-only formats correct look-alike letters (O→0, I/l→1, S→5, B→8); letters-and-
//     digits formats send look-alike variants to the server instead. Text needs two consecutive
//     frames that agree (./reader.ts) unless it comes from a still picture.
//  3. Without any format, text is only offered for the person to confirm, never acted on by itself.
//  4. A code and text on the same tag that agree confirm each other ("both"); when they disagree the
//     code wins and the text is dropped.
import {
  carrierAllows, cleanValue, extractFromCode, lookAlikeVariants, matchFormat, MAX_TAG_VALUE, valueKey,
  type TagFormat,
} from '../../../shared/tag-format.ts';

/** A rectangle in the upright picture's pixels (origin top left). */
export interface Box { x: number; y: number; width: number; height: number }

/** The code types the camera reads (spec §5.1), as the code reader names them. */
export const CODE_TYPES = [
  'qr-code', 'data-matrix', 'pdf-417', 'aztec', 'code-128', 'code-39', 'code-93',
  'ean-8', 'ean-13', 'upc-a', 'upc-e', 'itf', 'codabar',
] as const;
export type CodeType = (typeof CODE_TYPES)[number] | 'unknown';

/** Names for people. */
export const CODE_TYPE_LABELS: Record<CodeType, string> = {
  'qr-code': 'QR code', 'data-matrix': 'Data Matrix', 'pdf-417': 'PDF417', aztec: 'Aztec',
  'code-128': 'Code 128', 'code-39': 'Code 39', 'code-93': 'Code 93', 'ean-8': 'EAN-8', 'ean-13': 'EAN-13',
  'upc-a': 'UPC-A', 'upc-e': 'UPC-E', itf: 'ITF', codabar: 'Codabar', unknown: 'Barcode',
};

/** A decoded barcode or 2D code. */
export interface CodeRead { type: CodeType; content: string; box?: Box }
/** A line of printed text as the text recognizer gives it. */
export interface TextLine { text: string; box?: Box }

/** Everything read in one camera frame or one still picture. */
export interface FrameReads {
  /** Size of the upright picture the boxes refer to. */
  width: number;
  height: number;
  codes: CodeRead[];
  lines: TextLine[];
  /** A still picture: read once, so text does not need a second frame to agree. */
  still?: boolean;
}

/** How a reading was made: a code, printed text, or both agreeing. */
export type ReadHow = 'code' | 'text' | 'both';

/**
 * How far a reading can be trusted:
 * - `exact`: a decoded code (with or without a format) — looked up at once.
 * - `checked`: text that a format accepts with its check character — looked up at once (after two frames).
 * - `format`: text that a format without a check character accepts — the person confirms it first.
 * - `confirm`: text read without any format — offered for the person to confirm, never acted on alone.
 */
export type Trust = 'exact' | 'checked' | 'format' | 'confirm';

export interface Reading {
  /** valueKey of the value: what readings are compared by. */
  key: string;
  /** The value to show and send (as read, cleaned; look-alikes corrected for digits formats). */
  value: string;
  how: ReadHow;
  /** For a code: its type. */
  codeType?: CodeType;
  trust: Trust;
  /** The format it matched, if any. */
  formatId: string | null;
  /** Values to ask the server about, best first (the value, then look-alike variants), at least one. */
  variants: string[];
  box?: Box;
  /** A code type without a check character (CODES_WITHOUT_CHECK), not yet confirmed by printed text. */
  weak?: boolean;
}

/** Whether a reading may be looked up and acted on without the person confirming it. */
export function actsAlone(r: Pick<Reading, 'trust'>): boolean {
  return r.trust === 'exact' || r.trust === 'checked';
}

const TRUST_ORDER: Record<Trust, number> = { exact: 0, checked: 1, format: 2, confirm: 3 };
const MAX_TOKENS = 12;
const MAX_WINDOW = 3;

// ---------- codes ----------

/**
 * The reading a decoded code gives. With formats: the first format (that tags may carry as a code)
 * whose extraction and rules accept it; otherwise the whole content (still exact: it may be another
 * identifier such as a serial number, which the server can find). Content longer than a tag value
 * (a web address the label maker put in, say) gives no reading unless a format extracts the value.
 */
export function readCode(raw: CodeRead, formats: TagFormat[]): Reading | null {
  // Codabar's start and stop characters (A to D) frame the value; some readers include them.
  const code = raw.type === 'codabar' && /^[A-D].+[A-D]$/i.test(raw.content.trim())
    ? { ...raw, content: raw.content.trim().slice(1, -1) } : raw;
  for (const f of formats) {
    if (!f.active || !carrierAllows(f.carrier, 'code')) continue;
    const { value } = extractFromCode(code.content, f);
    if (matchFormat(value, f, 'code').ok) return codeReading(code, value, f.id);
  }
  const whole = extractFromCode(code.content, null).value;
  if (!whole || whole.length > MAX_TAG_VALUE || !valueKey(whole)) return null;
  return codeReading(code, whole, null);
}

/**
 * Code types without a mandatory check character (Code 39, Codabar, ITF): a reader can decode a damaged
 * or small one into a wrong value, as the tag photo test set showed on Code 39. Like text, they count
 * when two frames agree or printed text on the tag agrees; read once from a still picture, the person
 * confirms them.
 */
export const CODES_WITHOUT_CHECK: CodeType[] = ['code-39', 'codabar', 'itf'];

function codeReading(code: CodeRead, value: string, formatId: string | null): Reading {
  return {
    key: valueKey(value), value, how: 'code', codeType: code.type, trust: 'exact', formatId, variants: [value], box: code.box,
    ...(CODES_WITHOUT_CHECK.includes(code.type) ? { weak: true } : {}),
  };
}

// ---------- text ----------

/** Pieces of a line worth comparing: every run of one to three neighboring words, and the whole line. */
export function linePieces(text: string): string[] {
  const tokens = cleanValue(text).split(' ').filter(Boolean).slice(0, MAX_TOKENS)
    // Punctuation the recognizer reads around a value: "Tag: 004521." → "004521".
    .map((t) => t.replace(/^[^0-9A-Za-z]+|[^0-9A-Za-z]+$/g, (m) => (/^-+$/.test(m) ? m : '')))
    .filter(Boolean);
  const out = new Set<string>();
  for (let size = Math.min(MAX_WINDOW, tokens.length); size >= 1; size--) {
    for (let i = 0; i + size <= tokens.length; i++) out.add(tokens.slice(i, i + size).join(' '));
  }
  return [...out];
}

/** Text formats: active formats whose tags may carry the value as printed text. */
export function textFormats(formats: TagFormat[]): TagFormat[] {
  return formats.filter((f) => f.active && carrierAllows(f.carrier, 'text'));
}

/** Readings from one line of text checked against the formats (none when no format accepts any piece). */
export function readTextWithFormats(line: TextLine, formats: TagFormat[]): Reading[] {
  const found = new Map<string, Reading>();
  for (const piece of linePieces(line.text)) {
    for (const f of formats) {
      const variants = lookAlikeVariants(piece, f);
      if (!variants.length) continue;
      // For digits formats the one variant is the corrected value; for the others the value as read
      // comes first when it passes, then the swaps (fewest first).
      const value = variants[0];
      const key = valueKey(value);
      const match = matchFormat(value, f, 'text');
      if (!match.ok) continue;
      const trust: Trust = match.checked ? 'checked' : 'format';
      const prev = found.get(key);
      if (prev && TRUST_ORDER[prev.trust] <= TRUST_ORDER[trust]) continue;
      found.set(key, { key, value: displayValue(piece, value), how: 'text', trust, formatId: f.id, variants, box: line.box });
    }
  }
  return dropContained([...found.values()]);
}

/**
 * Without formats: runs of tag-like words (a word with a digit, or a short word of letters just
 * before one, such as "TA" in "TA 118342"), 3 to 40 letters, digits and dashes, offered for the
 * person to confirm. Words without a digit are left out: they are labels ("Property of"), not tags.
 */
export function readTextWithoutFormats(line: TextLine): Reading[] {
  const tokens = cleanValue(line.text).split(' ').filter(Boolean).slice(0, MAX_TOKENS)
    .map((t) => t.replace(/^[^0-9A-Za-z]+|[^0-9A-Za-z]+$/g, ''));
  const hasDigit = (t: string) => /[0-9]/.test(t);
  const isTagWord = (t: string) => /^[0-9A-Za-z-]+$/.test(t);
  const runs: string[][] = [];
  let run: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const startsRun = !run.length && /^[A-Za-z]{1,4}-?$/.test(t) && hasDigit(tokens[i + 1] ?? '') && isTagWord(tokens[i + 1] ?? '');
    if (isTagWord(t) && (hasDigit(t) || startsRun)) run.push(t);
    else { if (run.length) runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  const out: Reading[] = [];
  for (const r of runs) {
    const value = r.join(' ');
    const key = valueKey(value);
    if (key.length < 3 || key.length > 40 || !/[0-9]/.test(key)) continue;
    if (out.some((o) => o.key === key)) continue;
    out.push({ key, value, how: 'text', trust: 'confirm', formatId: null, variants: [value], box: line.box });
  }
  return out;
}

/** Keeps the value as printed when only spacing or case differ from the corrected value, else the corrected one. */
function displayValue(piece: string, corrected: string): string {
  return valueKey(piece) === valueKey(corrected) ? cleanValue(piece).toUpperCase() : corrected;
}

/** Drops readings whose key is part of a longer reading's key from the same line ("118342" inside "TA118342"). */
function dropContained(readings: Reading[]): Reading[] {
  return readings.filter((r) => !readings.some((o) => o !== r && o.key.length > r.key.length && o.key.includes(r.key) && TRUST_ORDER[o.trust] <= TRUST_ORDER[r.trust]));
}

// ---------- one frame ----------

/** Whether a text box lies on or next to a code's box (the same tag). */
export function sameTag(code: Box | undefined, text: Box | undefined, codes: number): boolean {
  if (!code || !text) return codes === 1;
  // The printed value sits next to its code; a wide barcode's neighbor on a shelf must not count as the same tag.
  const margin = Math.min(code.width, code.height) * 0.75;
  return text.x < code.x + code.width + margin && text.x + text.width > code.x - margin
    && text.y < code.y + code.height + margin && text.y + text.height > code.y - margin;
}

export interface FrameReadings {
  /** Readings from codes (some now "both"). */
  codes: Reading[];
  /** Readings from text that no code on the same tag decided (still subject to two-frame agreement). */
  texts: Reading[];
}

/**
 * Everything one frame (or still picture) offers, before two-frame agreement. `formats` are the
 * active formats (`GET /api/mobile/settings`); an empty list means none are configured.
 */
export function readFrame(frame: FrameReads, formats: TagFormat[]): FrameReadings {
  const active = formats.filter((f) => f.active);
  const codes: Reading[] = [];
  for (const c of frame.codes) {
    const r = readCode(c, active);
    if (r && !codes.some((o) => o.key === r.key)) codes.push(r);
  }
  const tf = textFormats(active);
  const texts: Reading[] = [];
  for (const line of frame.lines) {
    const found = active.length ? (tf.length ? readTextWithFormats(line, tf) : []) : readTextWithoutFormats(line);
    for (const r of found) {
      // A code on the same tag decides: agreeing text confirms it, disagreeing text is ignored.
      const near = codes.filter((c) => sameTag(c.box, r.box, codes.length));
      const agrees = near.find((c) => c.key === r.key || r.variants.some((v) => valueKey(v) === c.key));
      if (agrees) { agrees.how = 'both'; delete agrees.weak; continue; }
      if (near.length) continue;
      if (codes.some((c) => c.key === r.key)) continue;
      const prev = texts.find((o) => o.key === r.key);
      if (prev) { if (TRUST_ORDER[r.trust] < TRUST_ORDER[prev.trust]) Object.assign(prev, r); continue; }
      texts.push(r);
    }
  }
  return { codes, texts };
}

/** Readings in display order: codes and checked text first, then the rest. */
export function sortReadings(readings: Reading[]): Reading[] {
  return [...readings].sort((a, b) => TRUST_ORDER[a.trust] - TRUST_ORDER[b.trust]);
}
