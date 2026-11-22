import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { planLabel } from './print-label.ts';
import { PRESET_LAYOUTS } from './print-layouts.ts';
import { pdfMeasure } from './print-pdf.ts';
import { graphicField, moduleDots, pngToBitmap, renderZpl, zplField } from './print-zpl.ts';

const measure = pdfMeasure();
const roll = PRESET_LAYOUTS.find((l) => l.id === 'roll-50.8x25.4')!;
const planFor = (value: string, code: 'none' | 'code128' | 'qr' | 'datamatrix', topLine: string | null = null) =>
  planLabel(roll.labelWidthMm, roll.labelHeightMm, value, { code, topLine, logo: false, textHeightMm: 5 }, measure);

/** A small PNG: 8 × 2 pixels, RGBA, the left half black, the right half white or transparent. */
function png(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows: number[] = [];
  for (let y = 0; y < 2; y += 1) {
    rows.push(y === 0 ? 0 : 1); // filter none, then sub
    for (let x = 0; x < 8; x += 1) {
      const px = x < 4 ? [0, 0, 0, 255] : y === 0 ? [255, 255, 255, 255] : [0, 0, 0, 0];
      if (y === 1 && x > 0) {
        const prev = x - 1 < 4 ? [0, 0, 0, 255] : [0, 0, 0, 0];
        rows.push(...px.map((v, i) => (v - prev[i] + 256) & 0xff));
      } else rows.push(...px);
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
}

describe('ZPL', () => {
  it('prints a text-only label at the label size (snapshot)', () => {
    expect(renderZpl({ plans: [planFor('TA-118342', 'none', 'Property of the operator')], dpi: 203, logo: null })).toMatchSnapshot();
  });

  it('prints a Data Matrix label at 300 dpi (snapshot)', () => {
    expect(renderZpl({ plans: [planFor('K7Q2M9', 'datamatrix')], dpi: 300, logo: null })).toMatchSnapshot();
  });

  it('prints a Code 128 label with bars of whole dots (snapshot)', () => {
    const zpl = renderZpl({ plans: [planFor('SB-004512', 'code128')], dpi: 203, logo: null });
    expect(zpl).toMatchSnapshot();
    // 2 in × 1 in at 203 dpi.
    expect(zpl).toContain('^PW406\n^LL203');
  });

  it('makes one label format per value, with the same fields as the PDF plan', () => {
    const plans = ['TA-118342', 'TA-118343', 'TA-118344'].map((v) => planFor(v, 'qr'));
    const zpl = renderZpl({ plans, dpi: 203, logo: null });
    expect(zpl.match(/\^XA/g)).toHaveLength(3);
    expect(zpl.match(/\^XZ/g)).toHaveLength(3);
    for (const p of plans) {
      // The value centered in the plan's area, baseline where the PDF has it, at the plan's font size.
      const dpmm = 203 / 25.4;
      const h = Math.round(p.value.fontSize * dpmm);
      expect(zpl).toContain(`^FT${Math.round(p.value.x * dpmm)},${Math.round(p.value.baseline * dpmm)}^A0N,${h},${h}^FB${Math.round(p.value.width * dpmm)},1,0,C^FH^FD${p.value.text}^FS`);
    }
  });

  it('never lets a value be read as a command', () => {
    expect(zplField('A^XZ~JR_1\\')).toBe('A_5EXZ_7EJR_5F1_5C');
    const zpl = renderZpl({ plans: [planFor('AB^XZ', 'none')], dpi: 203, logo: null });
    expect(zpl.match(/\^XZ/g)).toHaveLength(1);
  });

  it('keeps modules whole dots and not below the legibility minimum when there is room', () => {
    expect(moduleDots(0.375, 100, 37.5, 8, 0.2)).toBe(3);
    // Never wider than planned: 0.36 mm at 8 dots per mm is 2 dots (rounding up would overflow).
    expect(moduleDots(0.36, 154, 0.36 * 154, 8, 0.2)).toBe(2);
    // Rounding would give 1 dot (0.125 mm) — raised to 2 dots (0.25 mm) when the space allows.
    expect(moduleDots(0.19, 100, 30, 8, 0.2)).toBe(2);
    // No room: never wider than the space.
    expect(moduleDots(0.5, 100, 20, 8, 0.2)).toBe(1);
  });

  it('turns a PNG logo into a one-bit graphic', () => {
    const bmp = pngToBitmap(png())!;
    expect(bmp).toMatchObject({ width: 8, height: 2 });
    // Black on the left; white or transparent (printed as white) on the right.
    expect(bmp.black.map((b) => (b ? 1 : 0)).join('')).toBe('1111000011110000');
    expect(graphicField(bmp, 8, 2, 10, 20, 'left')).toBe('^FO10,20^GFA,2,2,1,F0F0^FS');
    expect(pngToBitmap(Buffer.from('not a png'))).toBeNull();
  });
});
