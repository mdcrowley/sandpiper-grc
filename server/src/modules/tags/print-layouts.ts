// Label stock for printing your own tags (E37-08, spec §3.5): the preset layouts, named by their
// dimensions (never by a supplier's product number), the checks a custom layout must pass, and where
// each label sits on the page. Every size is in millimeters; the PDF converts to points (72 per inch)
// and the thermal-printer format (ZPL) to printer dots.
import type { LabelLayout } from '../../../../shared/asset-tags-api.ts';

/** Points per millimeter (PDF user space). */
export const PT_PER_MM = 72 / 25.4;
const IN = 25.4;

/** US Letter and ISO A4 in millimeters. */
export const LETTER = { width: 215.9, height: 279.4 } as const;
export const A4 = { width: 210, height: 297 } as const;

/** Limits a custom layout must keep (anything larger is not label stock). */
export const LAYOUT_LIMITS = {
  /** Smallest label side that can carry a 5 mm value at all. */
  labelMinMm: 8,
  /** Largest page or label side (a 17 × 22 in sheet; a 6 in roll is well inside). */
  pageMaxMm: 600,
  /** Most labels across or down one sheet. */
  gridMax: 40,
  /** Tolerance when checking that the labels fit on the page (rounding of inch sizes). */
  fitToleranceMm: 0.05,
} as const;

const fmt = (mm: number) => String(Math.round(mm * 10) / 10);
const inch = (v: number) => {
  // 2.625 → "2 5/8", 1.333 → "1 1/3", 0.5 → "1/2".
  const whole = Math.floor(v + 1e-9);
  const frac = v - whole;
  const parts: [number, string][] = [[0, ''], [1 / 8, '1/8'], [1 / 4, '1/4'], [1 / 3, '1/3'], [3 / 8, '3/8'], [1 / 2, '1/2'], [5 / 8, '5/8'], [2 / 3, '2/3'], [3 / 4, '3/4'], [7 / 8, '7/8']];
  const near = parts.reduce((best, p) => (Math.abs(p[0] - frac) < Math.abs(best[0] - frac) ? p : best));
  if (!near[1]) return String(whole);
  return whole ? `${whole} ${near[1]}` : near[1];
};

interface SheetSpec { key: string; paper: 'Letter' | 'A4'; labelW: number; labelH: number; cols: number; rows: number; top: number; left: number; gapX: number; gapY: number; inches: boolean }

function sheet(s: SheetSpec): LabelLayout {
  const page = s.paper === 'Letter' ? LETTER : A4;
  const size = s.inches
    ? `${inch(s.labelW / IN)} × ${inch(s.labelH / IN)} in (${fmt(s.labelW)} × ${fmt(s.labelH)} mm)`
    : `${fmt(s.labelW)} × ${fmt(s.labelH)} mm`;
  return {
    id: s.key, name: `${s.paper} sheet, ${s.cols * s.rows} labels of ${size}`, kind: 'sheet',
    pageWidthMm: page.width, pageHeightMm: page.height, labelWidthMm: s.labelW, labelHeightMm: s.labelH,
    columns: s.cols, rows: s.rows, marginTopMm: s.top, marginLeftMm: s.left, gapXMm: s.gapX, gapYMm: s.gapY, preset: true,
  };
}

function roll(key: string, w: number, h: number, inches: boolean): LabelLayout {
  const size = inches ? `${inch(w / IN)} × ${inch(h / IN)} in (${fmt(w)} × ${fmt(h)} mm)` : `${fmt(w)} × ${fmt(h)} mm`;
  return {
    id: key, name: `Roll, one label of ${size}`, kind: 'roll',
    pageWidthMm: w, pageHeightMm: h, labelWidthMm: w, labelHeightMm: h,
    columns: 1, rows: 1, marginTopMm: 0, marginLeftMm: 0, gapXMm: 0, gapYMm: 0, preset: true,
  };
}

/**
 * The preset layouts: common Letter and A4 sheets and common label-printer roll sizes, each described
 * by its dimensions. Keys are stable (a saved print setting may name one).
 */
export const PRESET_LAYOUTS: readonly LabelLayout[] = [
  // Letter (8 1/2 × 11 in). Margins and gaps are the usual ones for these sheet sizes.
  sheet({ key: 'letter-30-2.625x1', paper: 'Letter', labelW: 2.625 * IN, labelH: 1 * IN, cols: 3, rows: 10, top: 0.5 * IN, left: 0.1875 * IN, gapX: 0.125 * IN, gapY: 0, inches: true }),
  sheet({ key: 'letter-20-4x1', paper: 'Letter', labelW: 4 * IN, labelH: 1 * IN, cols: 2, rows: 10, top: 0.5 * IN, left: 0.15625 * IN, gapX: 0.1875 * IN, gapY: 0, inches: true }),
  sheet({ key: 'letter-14-4x1.333', paper: 'Letter', labelW: 4 * IN, labelH: (4 / 3) * IN, cols: 2, rows: 7, top: (5 / 6) * IN, left: 0.15625 * IN, gapX: 0.1875 * IN, gapY: 0, inches: true }),
  sheet({ key: 'letter-10-4x2', paper: 'Letter', labelW: 4 * IN, labelH: 2 * IN, cols: 2, rows: 5, top: 0.5 * IN, left: 0.15625 * IN, gapX: 0.1875 * IN, gapY: 0, inches: true }),
  sheet({ key: 'letter-80-1.75x0.5', paper: 'Letter', labelW: 1.75 * IN, labelH: 0.5 * IN, cols: 4, rows: 20, top: 0.5 * IN, left: 0.28125 * IN, gapX: 0.3125 * IN, gapY: 0, inches: true }),
  // A4 (210 × 297 mm).
  sheet({ key: 'a4-65-38.1x21.2', paper: 'A4', labelW: 38.1, labelH: 21.2, cols: 5, rows: 13, top: 10.7, left: 4.75, gapX: 2.5, gapY: 0, inches: false }),
  sheet({ key: 'a4-44-48.5x25.4', paper: 'A4', labelW: 48.5, labelH: 25.4, cols: 4, rows: 11, top: 8.8, left: 8, gapX: 0, gapY: 0, inches: false }),
  sheet({ key: 'a4-24-70x37', paper: 'A4', labelW: 70, labelH: 37, cols: 3, rows: 8, top: 0.5, left: 0, gapX: 0, gapY: 0, inches: false }),
  sheet({ key: 'a4-21-63.5x38.1', paper: 'A4', labelW: 63.5, labelH: 38.1, cols: 3, rows: 7, top: 15.15, left: 7.25, gapX: 2.5, gapY: 0, inches: false }),
  sheet({ key: 'a4-14-99.1x38.1', paper: 'A4', labelW: 99.1, labelH: 38.1, cols: 2, rows: 7, top: 15.15, left: 4.65, gapX: 2.5, gapY: 0, inches: false }),
  // Rolls for label printers: one label per page at the label's exact size.
  roll('roll-25.4x25.4', 1 * IN, 1 * IN, true),
  roll('roll-38.1x25.4', 1.5 * IN, 1 * IN, true),
  roll('roll-50.8x25.4', 2 * IN, 1 * IN, true),
  roll('roll-57x32', 57, 32, false),
  roll('roll-76.2x50.8', 3 * IN, 2 * IN, true),
  roll('roll-101.6x50.8', 4 * IN, 2 * IN, true),
];

export function presetLayout(id: string): LabelLayout | undefined {
  return PRESET_LAYOUTS.find((l) => l.id === id);
}

/** The fields of a layout an administrator enters (a saved custom layout). */
export type LayoutInput = Omit<LabelLayout, 'id' | 'preset'>;

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

/**
 * Checks a custom layout. Returns the clean layout, or field messages. A roll layout is one label per
 * page, so its page is the label and it has no grid; a sheet's labels must all fit on the page.
 */
export function checkLayout(raw: Record<string, unknown>): { ok: true; layout: LayoutInput } | { ok: false; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) fields.name = 'Give the layout a name.';
  else if (name.length > 120) fields.name = 'Keep the name under 120 characters.';
  const kind = raw.kind === 'roll' ? 'roll' : raw.kind === 'sheet' ? 'sheet' : null;
  if (!kind) fields.kind = 'Choose sheet or roll.';
  const L = LAYOUT_LIMITS;
  const size = (key: string, min: number, label: string) => {
    const v = num(raw[key]);
    if (!Number.isFinite(v)) { fields[key] = `Enter the ${label} in millimeters.`; return 0; }
    if (v < min || v > L.pageMaxMm) { fields[key] = `The ${label} must be between ${min} and ${L.pageMaxMm} mm.`; return 0; }
    return Math.round(v * 100) / 100;
  };
  const gap = (key: string, label: string) => {
    const v = raw[key] === undefined || raw[key] === null || raw[key] === '' ? 0 : num(raw[key]);
    if (!Number.isFinite(v) || v < 0 || v > L.pageMaxMm) { fields[key] = `The ${label} must be 0 or more millimeters.`; return 0; }
    return Math.round(v * 100) / 100;
  };
  const count = (key: string, label: string) => {
    const v = num(raw[key]);
    if (!Number.isInteger(v) || v < 1 || v > L.gridMax) { fields[key] = `The number of ${label} must be a whole number from 1 to ${L.gridMax}.`; return 1; }
    return v;
  };
  const labelWidthMm = size('labelWidthMm', L.labelMinMm, 'label width');
  const labelHeightMm = size('labelHeightMm', L.labelMinMm, 'label height');
  let layout: LayoutInput;
  if (kind === 'roll') {
    layout = {
      name, kind, pageWidthMm: labelWidthMm, pageHeightMm: labelHeightMm, labelWidthMm, labelHeightMm,
      columns: 1, rows: 1, marginTopMm: 0, marginLeftMm: 0, gapXMm: 0, gapYMm: 0,
    };
  } else {
    layout = {
      name, kind: 'sheet',
      pageWidthMm: size('pageWidthMm', 50, 'page width'), pageHeightMm: size('pageHeightMm', 50, 'page height'),
      labelWidthMm, labelHeightMm,
      columns: count('columns', 'columns'), rows: count('rows', 'rows'),
      marginTopMm: gap('marginTopMm', 'top margin'), marginLeftMm: gap('marginLeftMm', 'left margin'),
      gapXMm: gap('gapXMm', 'gap between columns'), gapYMm: gap('gapYMm', 'gap between rows'),
    };
    if (!Object.keys(fields).length) {
      const right = layout.marginLeftMm + layout.columns * layout.labelWidthMm + (layout.columns - 1) * layout.gapXMm;
      const bottom = layout.marginTopMm + layout.rows * layout.labelHeightMm + (layout.rows - 1) * layout.gapYMm;
      if (right > layout.pageWidthMm + L.fitToleranceMm) fields.columns = `The labels are ${fmt(right)} mm wide with the left margin; the page is ${fmt(layout.pageWidthMm)} mm.`;
      if (bottom > layout.pageHeightMm + L.fitToleranceMm) fields.rows = `The labels reach ${fmt(bottom)} mm down the page; the page is ${fmt(layout.pageHeightMm)} mm.`;
    }
  }
  return Object.keys(fields).length ? { ok: false, fields } : { ok: true, layout };
}

/** A label's place on its page, in millimeters from the page's top-left corner. */
export interface LabelBox { page: number; position: number; x: number; y: number; width: number; height: number }

/** Labels per page of a layout. */
export const perPage = (l: Pick<LabelLayout, 'columns' | 'rows'>) => l.columns * l.rows;

/** Where the label at a 1-based position on a page sits (positions run across, then down). */
export function positionBox(l: LabelLayout, position: number, page = 1): LabelBox {
  const i = position - 1;
  const col = i % l.columns;
  const row = Math.floor(i / l.columns);
  return {
    page, position,
    x: l.marginLeftMm + col * (l.labelWidthMm + l.gapXMm),
    y: l.marginTopMm + row * (l.labelHeightMm + l.gapYMm),
    width: l.labelWidthMm, height: l.labelHeightMm,
  };
}

/**
 * The boxes `count` labels fill, starting at a 1-based position on the first page (sheets only:
 * "Start at label" for a partly used sheet; rolls always start a new label).
 */
export function labelBoxes(l: LabelLayout, count: number, startAt = 1): LabelBox[] {
  const n = perPage(l);
  const first = l.kind === 'sheet' ? Math.min(Math.max(1, Math.floor(startAt)), n) - 1 : 0;
  const boxes: LabelBox[] = [];
  for (let k = 0; k < count; k += 1) {
    const slot = first + k;
    boxes.push(positionBox(l, (slot % n) + 1, Math.floor(slot / n) + 1));
  }
  return boxes;
}

/** Pages a print needs. */
export function pagesFor(l: LabelLayout, count: number, startAt = 1): number {
  if (!count) return 0;
  const n = perPage(l);
  const first = l.kind === 'sheet' ? Math.min(Math.max(1, Math.floor(startAt)), n) - 1 : 0;
  return Math.ceil((first + count) / n);
}

/** A saved layout row as the API gives it. */
export function layoutFromRow(r: Record<string, unknown>): LabelLayout {
  const n = (v: unknown) => Number(v);
  return {
    id: String(r.id), name: String(r.name), kind: r.kind === 'roll' ? 'roll' : 'sheet',
    pageWidthMm: n(r.page_width_mm), pageHeightMm: n(r.page_height_mm), labelWidthMm: n(r.label_width_mm), labelHeightMm: n(r.label_height_mm),
    columns: n(r.columns), rows: n(r.rows), marginTopMm: n(r.margin_top_mm), marginLeftMm: n(r.margin_left_mm),
    gapXMm: n(r.gap_x_mm), gapYMm: n(r.gap_y_mm), preset: false,
  };
}
