// What goes where on one printed tag (E37-08, spec §3.5): the value in large type, an optional code
// holding the same value, an optional line above and the organization's logo. The plan is pure
// geometry in millimeters from the label's top-left corner; the PDF and the ZPL renderers draw the
// same plan, so both outputs have the same fields at the same sizes.
//
// Legibility rules (for people and for phone cameras):
//  - the value is printed in a plain bold sans-serif (Helvetica Bold in the PDF, the printer's
//    scalable font 0 in ZPL), where 0 is narrower than O and 1 has a flag that I lacks;
//  - the value's capital letters are at least the minimum text height (default 5 mm) tall, or the
//    print is refused with the reason, never shrunk below it;
//  - black on white only, nothing printed over the logo or over a code's quiet zone;
//  - codes keep their quiet zones (Code 128: 10 modules, QR: 4, Data Matrix: 2) and a module of at
//    least 0.2 mm (Code 128) or 0.3 mm (QR, Data Matrix), and Code 128 bars at least 5 mm tall.
import type { LabelCode } from '../../../../shared/asset-tags-api.ts';
import { type CodeSymbol, encode, symbolHeight, symbolWidth } from './print-codes.ts';

/** Helvetica Bold: capital height and descender as fractions of the font size (its AFM metrics). */
export const CAP_HEIGHT = 0.718;
export const DESCENDER = 0.207;

export const LEGIBILITY = {
  /** Default minimum height of the value's capitals. */
  textHeightMm: 5,
  /** The smallest minimum an administrator may choose (below this people and cameras misread). */
  textHeightMinMm: 3,
  textHeightMaxMm: 25,
  /** The value grows to fill the space up to this capital height (beside or under a code). */
  valueMaxWithCodeMm: 10,
  /** The value grows up to this capital height on a text-only label. */
  valueMaxTextOnlyMm: 20,
  linearModuleMinMm: 0.2,
  linearModuleMaxMm: 0.5,
  matrixModuleMinMm: 0.3,
  matrixModuleMaxMm: 1.0,
  barHeightMinMm: 5,
  barHeightMaxMm: 15,
  /** The line above: capital height range. */
  topLineMinMm: 1.5,
  topLineMaxMm: 2.6,
} as const;

export interface LabelOptions {
  code: LabelCode;
  topLine: string | null;
  /** Leave room for the logo (only when the organization has one). */
  logo: boolean;
  /** Minimum capital height of the value, in millimeters. */
  textHeightMm: number;
}

/** Text width in ems (at font size 1) in the value's font. */
export type MeasureEm = (text: string, bold: boolean) => number;

export interface TextPlacement {
  text: string;
  /** Left edge of the area the text is centered in, its width, and the baseline. */
  x: number; width: number; baseline: number;
  capHeight: number;
  /** The font size in millimeters (capHeight / CAP_HEIGHT). */
  fontSize: number;
}
export interface Box { x: number; y: number; width: number; height: number }
export interface CodePlacement {
  symbol: CodeSymbol;
  /** Top-left of the symbol including its quiet zone. */
  x: number; y: number;
  /** Module width (and height for 2D symbols). */
  module: number;
  /** Bar height of a linear symbol (equal to the symbol's height for 2D). */
  height: number;
}
export interface LabelPlan {
  width: number; height: number;
  logo: Box | null;
  topLine: TextPlacement | null;
  value: TextPlacement;
  code: CodePlacement | null;
}

export class PlanError extends Error {
  constructor(public code: 'too_small' | 'too_long' | 'code', message: string) { super(message); }
}

const r2 = (v: number) => Math.round(v * 1000) / 1000;
/** Rounded down, so a rounded size never grows past what fits. */
const fl = (v: number) => Math.floor(v * 1000) / 1000;

/** Inner padding: the printable area stays clear of die-cut edges and printer drift. */
export function paddingFor(width: number, height: number): number {
  return Math.min(3, Math.max(1, Math.min(width, height) * 0.06));
}

/** Shortens text with an ellipsis until it fits `width` at `capHeight`. */
function fitLine(text: string, width: number, capHeight: number, measure: MeasureEm, bold: boolean): string {
  const size = capHeight / CAP_HEIGHT;
  if (measure(text, bold) * size <= width) return text;
  let s = text;
  while (s.length > 1 && measure(`${s}…`, bold) * size > width) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** The largest capital height at which `text` fits `width`. */
function capForWidth(text: string, width: number, measure: MeasureEm, bold = true): number {
  const em = measure(text, bold);
  return em > 0 ? (width / em) * CAP_HEIGHT : Infinity;
}

const mmText = (v: number) => `${Math.round(v * 10) / 10} mm`;

/**
 * Plans one label. Throws PlanError when the value cannot be printed legibly on this label size with
 * these options (the message says why and what to change).
 */
export function planLabel(width: number, height: number, value: string, opts: LabelOptions, measure: MeasureEm): LabelPlan {
  const L = LEGIBILITY;
  const tMin = opts.textHeightMm;
  const pad = paddingFor(width, height);
  let top = pad;
  const innerW = width - 2 * pad;
  let logo: Box | null = null;
  let topLine: TextPlacement | null = null;

  // Header: the logo at the left and the line above beside it (never over each other).
  const hasTop = Boolean(opts.topLine && opts.topLine.trim());
  if (hasTop || opts.logo) {
    const headerH = Math.min(7, Math.max(3, (height - 2 * pad) * 0.22));
    let textX = pad;
    if (opts.logo) {
      const logoW = hasTop ? Math.min(headerH * 3, innerW * 0.35) : Math.min(headerH * 4, innerW * 0.6);
      logo = { x: hasTop ? pad : pad + (innerW - logoW) / 2, y: top, width: r2(logoW), height: r2(headerH) };
      textX = pad + logoW + 1;
    }
    if (hasTop) {
      const areaW = width - pad - textX;
      const text = opts.topLine!.trim();
      let cap = Math.min(L.topLineMaxMm, headerH * 0.62, capForWidth(text, areaW, measure, true));
      cap = Math.max(L.topLineMinMm, cap);
      const shown = fitLine(text, areaW, cap, measure, true);
      topLine = { text: shown, x: r2(textX), width: areaW, baseline: r2(top + (headerH + cap) / 2), capHeight: fl(cap), fontSize: fl(cap / CAP_HEIGHT) };
    }
    top += headerH + 0.8;
  }
  const body: Box = { x: pad, y: top, width: innerW, height: height - pad - top };
  const tooSmall = (why: string) => new PlanError('too_small',
    `"${value}" does not fit legibly on a ${mmText(width)} × ${mmText(height)} label: ${why}. Choose a larger label, a smaller minimum text height, ${opts.code === 'none' ? 'or leave out the line above or the logo' : 'a different code, or text only'}.`);

  const valueAt = (area: Box, cap: number): TextPlacement => ({
    text: value, x: r2(area.x), width: area.width, baseline: r2(area.y + (area.height + cap) / 2), capHeight: fl(cap), fontSize: fl(cap / CAP_HEIGHT),
  });

  if (opts.code === 'none') {
    const cap = Math.min(L.valueMaxTextOnlyMm, capForWidth(value, body.width, measure), body.height / (1 + DESCENDER / CAP_HEIGHT * 0.5));
    if (cap < tMin - 1e-6) throw tooSmall(`the value can be at most ${mmText(cap)} tall here, below the minimum of ${mmText(tMin)}`);
    return { width, height, logo, topLine, value: valueAt(body, cap), code: null };
  }

  let symbol: CodeSymbol;
  try { symbol = encode(opts.code, value); } catch (err) { throw new PlanError('code', (err as Error).message); }
  const modules = symbolWidth(symbol);

  if (symbol.kind === 'linear') {
    // Bars on top, the value under them.
    const module = Math.min(L.linearModuleMaxMm, body.width / modules);
    if (module < L.linearModuleMinMm - 1e-9) {
      throw new PlanError('too_long', `"${value}" is too long for a Code 128 barcode on a ${mmText(width)} wide label (it needs ${mmText(modules * L.linearModuleMinMm + 2 * pad)}). Choose a wider label, a QR or Data Matrix code, or text only.`);
    }
    const textBlock = 1.3; // capital height plus the gap above it, in capital heights
    const cap = Math.min(L.valueMaxWithCodeMm, capForWidth(value, body.width, measure), (body.height - L.barHeightMinMm) / textBlock);
    if (cap < tMin - 1e-6) throw tooSmall(`with bars at least ${mmText(L.barHeightMinMm)} tall, the value can be at most ${mmText(Math.max(0, cap))} tall, below the minimum of ${mmText(tMin)}`);
    const barH = Math.min(L.barHeightMaxMm, body.height - cap * textBlock);
    const groupH = barH + cap * textBlock;
    const y0 = body.y + (body.height - groupH) / 2;
    const symW = modules * module;
    return {
      width, height, logo, topLine,
      code: { symbol, x: r2(body.x + (body.width - symW) / 2), y: r2(y0), module: r2(module), height: r2(barH) },
      value: { text: value, x: r2(body.x), width: body.width, baseline: r2(y0 + barH + cap * textBlock), capHeight: fl(cap), fontSize: fl(cap / CAP_HEIGHT) },
    };
  }

  // A 2D code: beside the value on a wide label, above it otherwise.
  const rowsN = symbolHeight(symbol);
  const side = (s: number) => ({ module: s / Math.max(modules, rowsN), size: s });
  const gap = 1;
  if (body.width >= body.height * 1.5) {
    const valueW = (cap: number) => (measure(value, true) * cap) / CAP_HEIGHT;
    let s = Math.min(body.height, Math.max(modules, rowsN) * L.matrixModuleMaxMm, body.width * 0.5);
    // Give the value room for its minimum height first.
    s = Math.min(s, body.width - gap - valueW(tMin));
    const { module } = side(s);
    if (module >= L.matrixModuleMinMm - 1e-9) {
      const textArea: Box = { x: body.x + s + gap, y: body.y, width: body.width - s - gap, height: body.height };
      const cap = Math.min(L.valueMaxWithCodeMm, capForWidth(value, textArea.width, measure), body.height / 1.3);
      if (cap >= tMin - 1e-6) {
        return {
          width, height, logo, topLine,
          code: { symbol, x: r2(body.x), y: r2(body.y + (body.height - s) / 2), module: r2(module), height: r2(s) },
          value: valueAt(textArea, cap),
        };
      }
    }
  }
  const minSide = Math.max(modules, rowsN) * L.matrixModuleMinMm;
  const cap = Math.min(L.valueMaxWithCodeMm, capForWidth(value, body.width, measure), (body.height - minSide - gap) / 1.3);
  if (cap < tMin - 1e-6) throw tooSmall(`with a ${opts.code === 'qr' ? 'QR' : 'Data Matrix'} code at least ${mmText(minSide)} square, the value can be at most ${mmText(Math.max(0, cap))} tall, below the minimum of ${mmText(tMin)}`);
  const s = Math.min(body.height - cap * 1.3 - gap, body.width, Math.max(modules, rowsN) * L.matrixModuleMaxMm);
  const { module } = side(s);
  const groupH = s + gap + cap * 1.3;
  const y0 = body.y + (body.height - groupH) / 2;
  return {
    width, height, logo, topLine,
    code: { symbol, x: r2(body.x + (body.width - s) / 2), y: r2(y0), module: r2(module), height: r2(s) },
    value: { text: value, x: r2(body.x), width: body.width, baseline: r2(y0 + s + gap + cap * 1.3), capHeight: fl(cap), fontSize: fl(cap / CAP_HEIGHT) },
  };
}
