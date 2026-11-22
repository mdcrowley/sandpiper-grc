import { describe, expect, it } from 'vitest';
import { CodeError, darkRuns, encode, looksLikeAddress, QUIET_ZONE, symbolWidth } from './print-codes.ts';
import { CAP_HEIGHT, LEGIBILITY, type Box, type LabelOptions, type LabelPlan, PlanError, planLabel } from './print-label.ts';
import { A4, checkLayout, labelBoxes, LETTER, pagesFor, perPage, positionBox, PRESET_LAYOUTS, PT_PER_MM } from './print-layouts.ts';
import { pdfMeasure } from './print-pdf.ts';

const measure = pdfMeasure();
const base: LabelOptions = { code: 'code128', topLine: null, logo: false, textHeightMm: 5 };
const pt = (mm: number) => Math.round(mm * PT_PER_MM * 100) / 100;

describe('preset layouts', () => {
  it('are named by their dimensions, never by a product number', () => {
    for (const l of PRESET_LAYOUTS) {
      expect(l.preset).toBe(true);
      expect(l.name).toMatch(/\d+(\.\d+)? × \d+(\.\d+)? mm/);
      expect(l.name).toMatch(l.kind === 'sheet' ? /^(Letter|A4) sheet, \d+ labels of / : /^Roll, one label of /);
    }
    expect(new Set(PRESET_LAYOUTS.map((l) => l.id)).size).toBe(PRESET_LAYOUTS.length);
  });

  it('put every label on the page, in points, with sheets on Letter or A4 and rolls at the label size', () => {
    for (const l of PRESET_LAYOUTS) {
      if (l.kind === 'roll') {
        expect([l.pageWidthMm, l.pageHeightMm]).toEqual([l.labelWidthMm, l.labelHeightMm]);
        expect(perPage(l)).toBe(1);
        continue;
      }
      expect([[LETTER.width, LETTER.height], [A4.width, A4.height]]).toContainEqual([l.pageWidthMm, l.pageHeightMm]);
      const last = positionBox(l, perPage(l));
      expect(pt(last.x + last.width)).toBeLessThanOrEqual(pt(l.pageWidthMm));
      expect(pt(last.y + last.height)).toBeLessThanOrEqual(pt(l.pageHeightMm));
      // Labels do not overlap: each next label starts at or after the end of the one before.
      const second = positionBox(l, 2);
      if (l.columns > 1) expect(second.x).toBeGreaterThanOrEqual(l.marginLeftMm + l.labelWidthMm - 1e-9);
      // The check checkLayout makes accepts every preset.
      expect(checkLayout({ ...l }).ok).toBe(true);
    }
  });

  it('place labels at known points', () => {
    const geometry = Object.fromEntries(PRESET_LAYOUTS.map((l) => {
      const first = positionBox(l, 1);
      const last = positionBox(l, perPage(l));
      return [l.id, { page: [pt(l.pageWidthMm), pt(l.pageHeightMm)], label: [pt(l.labelWidthMm), pt(l.labelHeightMm)], first: [pt(first.x), pt(first.y)], last: [pt(last.x), pt(last.y)] }];
    }));
    expect(geometry).toMatchSnapshot();
    // Letter, 30 labels of 2 5/8 × 1 in: 3/16 in left margin, 1/8 in between columns, 1/2 in top margin.
    expect(geometry['letter-30-2.625x1']).toEqual({ page: [612, 792], label: [189, 72], first: [13.5, 36], last: [409.5, 684] });
    // A4, 21 labels of 63.5 × 38.1 mm.
    expect(geometry['a4-21-63.5x38.1'].page).toEqual([595.28, 841.89]);
  });

  it('start at a chosen label on a partly used sheet and count pages', () => {
    const l = PRESET_LAYOUTS.find((p) => p.id === 'letter-30-2.625x1')!;
    const boxes = labelBoxes(l, 5, 29);
    expect(boxes.map((b) => [b.page, b.position])).toEqual([[1, 29], [1, 30], [2, 1], [2, 2], [2, 3]]);
    expect(pagesFor(l, 5, 29)).toBe(2);
    expect(pagesFor(l, 30, 1)).toBe(1);
    expect(pagesFor(l, 31, 1)).toBe(2);
    const roll = PRESET_LAYOUTS.find((p) => p.kind === 'roll')!;
    expect(labelBoxes(roll, 3, 9).map((b) => b.page)).toEqual([1, 2, 3]);
  });

  it('check custom layouts', () => {
    expect(checkLayout({ name: 'Too wide', kind: 'sheet', pageWidthMm: 210, pageHeightMm: 297, labelWidthMm: 70, labelHeightMm: 30, columns: 4, rows: 5 })).toMatchObject({ ok: false, fields: { columns: expect.stringContaining('wide') } });
    expect(checkLayout({ name: '', kind: 'sheet' })).toMatchObject({ ok: false, fields: { name: expect.any(String), labelWidthMm: expect.any(String) } });
    const roll = checkLayout({ name: 'Small roll', kind: 'roll', labelWidthMm: '40', labelHeightMm: 20, columns: 9 });
    expect(roll).toEqual({ ok: true, layout: expect.objectContaining({ pageWidthMm: 40, pageHeightMm: 20, columns: 1, rows: 1 }) });
    expect(checkLayout({ name: 'Tiny', kind: 'roll', labelWidthMm: 5, labelHeightMm: 20 }).ok).toBe(false);
  });
});

describe('codes', () => {
  it('hold the value and never an address', () => {
    for (const v of ['https://example.test/a', 'http://x', 'www.example.test', 'mailto:a@b.test', 'tel:5550100', 'someone@example.test', 'ftp://x']) {
      expect(looksLikeAddress(v)).toBe(true);
      expect(() => encode('qr', v)).toThrow(CodeError);
    }
    for (const v of ['TA-118342', 'K7Q2M9', 'SB-004512', '0100004']) expect(looksLikeAddress(v)).toBe(false);
  });

  it('refuse characters a scanner cannot be trusted with', () => {
    expect(() => encode('code128', 'TA-11é')).toThrow(/characters/);
  });

  it('encode each symbology with its quiet zone', () => {
    const lin = encode('code128', 'TA-118342');
    expect(lin.kind).toBe('linear');
    expect(lin.quiet).toBe(QUIET_ZONE.code128);
    // Code 128: start, data, check and stop symbols are 11 modules each, the stop 13.
    expect((lin.kind === 'linear' ? lin.modules.length : 0) % 11).toBe(2);
    const qr = encode('qr', 'TA-118342');
    expect(qr).toMatchObject({ kind: 'matrix', cols: 21, rows: 21, quiet: 4 });
    const dm = encode('datamatrix', 'TA-118342');
    expect(dm).toMatchObject({ kind: 'matrix', cols: 14, rows: 14, quiet: 2 });
    expect(symbolWidth(qr)).toBe(29);
    expect(darkRuns([true, true, false, true, false, false, true])).toEqual([[0, 2], [3, 1], [6, 1]]);
  });
});

/** Boxes a plan uses, to check that nothing overlaps. */
function parts(p: LabelPlan): Record<string, Box> {
  const out: Record<string, Box> = {};
  const textBox = (t: { x: number; width: number; baseline: number; capHeight: number }) => ({ x: t.x, y: t.baseline - t.capHeight, width: t.width, height: t.capHeight });
  if (p.logo) out.logo = p.logo;
  if (p.topLine) out.topLine = textBox(p.topLine);
  out.value = textBox(p.value);
  if (p.code) {
    const s = p.code.symbol;
    const w = (s.kind === 'linear' ? s.modules.length + 2 * s.quiet : s.cols + 2 * s.quiet) * p.code.module;
    out.code = { x: p.code.x, y: p.code.y, width: w, height: p.code.height };
  }
  return out;
}
const overlap = (a: Box, b: Box) => a.x < b.x + b.width - 1e-6 && b.x < a.x + a.width - 1e-6 && a.y < b.y + b.height - 1e-6 && b.y < a.y + a.height - 1e-6;

describe('label plans and legibility', () => {
  const codes: LabelOptions['code'][] = ['none', 'code128', 'qr', 'datamatrix'];

  it('keep the value at least the minimum text height, inside the label, with nothing overlapping', () => {
    let planned = 0;
    for (const l of PRESET_LAYOUTS) {
      for (const code of codes) {
        for (const extras of [{}, { topLine: 'Property of the operator' }, { topLine: 'Property of the operator', logo: true }]) {
          let p: LabelPlan;
          try { p = planLabel(l.labelWidthMm, l.labelHeightMm, 'TA-118342', { ...base, code, ...extras }, measure); } catch (err) {
            expect(err).toBeInstanceOf(PlanError);
            continue;
          }
          planned += 1;
          expect(p.value.capHeight).toBeGreaterThanOrEqual(LEGIBILITY.textHeightMm - 1e-3);
          expect(p.value.fontSize).toBeCloseTo(p.value.capHeight / CAP_HEIGHT, 2);
          const boxes = parts(p);
          for (const [name, b] of Object.entries(boxes)) {
            expect(b.x, `${l.id} ${code} ${name}`).toBeGreaterThanOrEqual(-1e-6);
            expect(b.y, `${l.id} ${code} ${name}`).toBeGreaterThanOrEqual(-1e-6);
            expect(b.x + b.width, `${l.id} ${code} ${name}`).toBeLessThanOrEqual(l.labelWidthMm + 1e-6);
            expect(b.y + b.height, `${l.id} ${code} ${name}`).toBeLessThanOrEqual(l.labelHeightMm + 1e-6);
          }
          const names = Object.keys(boxes);
          for (let i = 0; i < names.length; i += 1) for (let j = i + 1; j < names.length; j += 1) {
            expect(overlap(boxes[names[i]], boxes[names[j]]), `${l.id} ${code}: ${names[i]} over ${names[j]}`).toBe(false);
          }
          // The value's measured width fits its area.
          expect(measure(p.value.text, true) * p.value.fontSize).toBeLessThanOrEqual(p.value.width + 1e-3);
          if (p.code?.symbol.kind === 'linear') {
            expect(p.code.module).toBeGreaterThanOrEqual(LEGIBILITY.linearModuleMinMm);
            expect(p.code.height).toBeGreaterThanOrEqual(LEGIBILITY.barHeightMinMm);
          } else if (p.code) {
            expect(p.code.module).toBeGreaterThanOrEqual(LEGIBILITY.matrixModuleMinMm);
          }
        }
      }
    }
    expect(planned).toBeGreaterThan(PRESET_LAYOUTS.length * 4);
  });

  it('fits text and a code on every preset of at least 1 in tall', () => {
    for (const l of PRESET_LAYOUTS.filter((p) => p.labelHeightMm >= 25.4 && p.labelWidthMm >= 38)) {
      for (const code of codes) expect(() => planLabel(l.labelWidthMm, l.labelHeightMm, 'TA-118342', { ...base, code }, measure), `${l.id} ${code}`).not.toThrow();
    }
  });

  it('refuses rather than shrinks below the minimum text height, and says why', () => {
    // 1 3/4 × 1/2 in: room for the value, not for bars and the value.
    expect(() => planLabel(44.45, 12.7, 'TA-118342', base, measure)).toThrow(/does not fit legibly/);
    expect(planLabel(44.45, 12.7, 'TA-118342', { ...base, code: 'none' }, measure).value.capHeight).toBeGreaterThanOrEqual(5);
    expect(() => planLabel(44.45, 12.7, 'TA-118342', { ...base, code: 'none', textHeightMm: 12 }, measure)).toThrow(PlanError);
    // A long value on a narrow label cannot make a Code 128 with modules of 0.2 mm.
    expect(() => planLabel(38.1, 25.4, 'TA-118342-SPARE-UNIT-07', base, measure)).toThrow(/too long for a Code 128/);
  });

  it('grows the value to fill the space, up to the limits', () => {
    const p = planLabel(101.6, 50.8, 'K7Q2M9', { ...base, code: 'none' }, measure);
    expect(p.value.capHeight).toBeGreaterThan(10);
    expect(p.value.capHeight).toBeLessThanOrEqual(LEGIBILITY.valueMaxTextOnlyMm);
  });

  it('puts a 2D code beside the value on a wide label and above it on a square one', () => {
    const wide = planLabel(66.675, 25.4, 'TA-118342', { ...base, code: 'qr' }, measure);
    expect(wide.value.x).toBeGreaterThan(wide.code!.x + wide.code!.height - 1e-6);
    const square = planLabel(25.4, 25.4, 'K7Q2M9', { ...base, code: 'datamatrix', textHeightMm: 4 }, measure);
    expect(square.value.baseline - square.value.capHeight).toBeGreaterThan(square.code!.y + square.code!.height - 1e-6);
  });

  it('shortens a long line above rather than overflowing', () => {
    const p = planLabel(50.8, 25.4, 'TA-118342', { ...base, code: 'none', topLine: 'Property of the regional operator, fleet engineering department' }, measure);
    expect(p.topLine!.text.endsWith('…')).toBe(true);
    expect(measure(p.topLine!.text, true) * p.topLine!.fontSize).toBeLessThanOrEqual(p.topLine!.width + 1e-3);
  });
});
