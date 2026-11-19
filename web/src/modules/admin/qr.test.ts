import { describe, expect, it } from 'vitest';
import { encodeQr, formatBits, qrCapacity, qrPath, qrVersionFor, rsRemainder, versionBits } from './qr';

// Reads a finished symbol back: the format bits, then the codewords in placement order with
// the mask removed. Written independently of the encoder's own placement code, from the
// standard's description, so a placement mistake in one is not mirrored in the other.
function readBack(modules: boolean[][]) {
  const size = modules.length;
  const version = (size - 17) / 4;
  const bit = (row: number, col: number) => (modules[row][col] ? 1 : 0);
  // Format bits, first copy: bits 0-5 down column 8, then (7,8), (8,8), (8,7), then row 8 leftwards.
  const spots: [number, number][] = [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8], [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]];
  let format = 0;
  spots.forEach(([r, c], i) => { format |= bit(r, c) << i; });
  const mask = ((format ^ 0x5412) >> 10) & 7;

  // Which modules are not data: finders and separators, timing, format, the dark module and
  // (version 2 to 6 only, which is all this reader needs) the single alignment pattern.
  const reserved = (r: number, c: number) => {
    if ((r < 9 && c < 9) || (r < 9 && c >= size - 8) || (r >= size - 8 && c < 9)) return true;
    if (r === 6 || c === 6) return true;
    if (version >= 2) {
      const a = 4 * version + 10;
      if (Math.abs(r - a) <= 2 && Math.abs(c - a) <= 2) return true;
    }
    return false;
  };
  const flip = [
    (r: number, c: number) => (r + c) % 2 === 0, (r: number) => r % 2 === 0, (_: number, c: number) => c % 3 === 0,
    (r: number, c: number) => (r + c) % 3 === 0, (r: number, c: number) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r: number, c: number) => ((r * c) % 2) + ((r * c) % 3) === 0, (r: number, c: number) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r: number, c: number) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ][mask];
  const bits: number[] = [];
  let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < size; i++) {
      const row = up ? size - 1 - i : i;
      for (const c of [col, col - 1]) if (!reserved(row, c)) bits.push(bit(row, c) ^ (flip(row, c) ? 1 : 0));
    }
    up = !up;
  }
  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) codewords.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  return { format, mask, codewords };
}

describe('QR encoder', () => {
  it('computes Reed-Solomon codewords that match the published worked example', () => {
    // "HELLO WORLD", version 1-M: the data and error-correction codewords of the standard tutorial example.
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsRemainder(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it('builds format and version information as the tables give them', () => {
    expect(formatBits(0).toString(2).padStart(15, '0')).toBe('101010000010010'); // level M, mask 0
    expect(formatBits(5).toString(2).padStart(15, '0')).toBe('100000011001110'); // level M, mask 5
    expect(versionBits(7).toString(2).padStart(18, '0')).toBe('000111110010010100');
  });

  it('chooses the smallest version that holds the text', () => {
    expect(qrCapacity(1)).toBe(14);
    expect(qrVersionFor(14)).toBe(1);
    expect(qrVersionFor(15)).toBe(2);
    expect(qrVersionFor(5000)).toBe(0);
    expect(encodeQr('x'.repeat(700))).toBeNull();
  });

  it('draws the three finder patterns and the dark module', () => {
    const qr = encodeQr('otpauth://totp/Example:sam?secret=JBSWY3DPEHPK3PXP&issuer=Example');
    expect(qr).not.toBeNull();
    const { modules, size } = qr!;
    for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      expect(modules[top][left]).toBe(true);
      expect(modules[top + 1][left + 1]).toBe(false);
      expect(modules[top + 3][left + 3]).toBe(true);
    }
    expect(modules[size - 8][8]).toBe(true);
    expect(qrPath(qr!).startsWith('M4 4h7')).toBe(true); // the top row of the first finder, after a 4-module margin
  });

  it('stores the text so that it reads back, with valid error correction, under every mask', () => {
    const text = 'otpauth://totp/Sand:sam1'; // 24 bytes: version 2-M (holds 26), one block of 28 data codewords
    for (let mask = 0; mask < 8; mask++) {
      const qr = encodeQr(text, { mask })!;
      expect(qr.version).toBe(2);
      const read = readBack(qr.modules);
      expect(read.format).toBe(formatBits(mask));
      expect(read.mask).toBe(mask);
      const data = read.codewords.slice(0, 28);
      const ec = read.codewords.slice(28, 44);
      expect(rsRemainder(data, 16)).toEqual(ec);
      // Byte mode (0100), length 24, then the bytes.
      expect(data[0]).toBe(0x41);
      expect(data[1]).toBe(0x86);
      const bytes: number[] = [];
      for (let i = 0; i < 24; i++) bytes.push(((data[1 + i] & 0x0f) << 4) | (data[2 + i] >> 4));
      expect(String.fromCharCode(...bytes)).toBe(text);
    }
  });
});
