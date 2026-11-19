// A small QR code encoder, written for this application (no package).
//
// Scope: byte mode (the text as UTF-8), error-correction level M, versions 1 to 20, which is far more
// than a set-up address for an authenticator app needs. The steps follow ISO/IEC 18004:
//   1. data bits: mode, length, bytes, terminator, padding;
//   2. Reed-Solomon error correction over GF(256), block by block, then interleaving;
//   3. the fixed patterns (finders, timing, alignment, format and version information);
//   4. the data laid in a zigzag from the bottom right;
//   5. all eight masks tried, the one with the lowest penalty kept.
//
// `encodeQr` returns the modules; `qrPath` turns them into one SVG path. Nothing here touches the DOM.

export interface QrCode {
  version: number;
  /** Modules per side, without the quiet zone. */
  size: number;
  /** The mask that was chosen, 0 to 7. */
  mask: number;
  /** modules[row][column]; true is dark. */
  modules: boolean[][];
}

export const QR_MIN_VERSION = 1;
export const QR_MAX_VERSION = 20;

// ---------- arithmetic in GF(256), reducing polynomial x^8 + x^4 + x^3 + x^2 + 1 ----------

const EXP = new Uint8Array(510);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    EXP[i + 255] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
}

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

/** The generator polynomial of the given degree, highest power first (the leading 1 included). */
function generator(degree: number): number[] {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= gfMul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

/** The Reed-Solomon error-correction codewords for one block of data. */
export function rsRemainder(data: ArrayLike<number>, degree: number): number[] {
  const gen = generator(degree);
  const rem = new Array<number>(degree).fill(0);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let j = 0; j < degree; j++) rem[j] ^= gfMul(gen[j + 1], factor);
  }
  return rem;
}

// ---------- tables for level M ----------

/** Per version: error-correction codewords per block, then (blocks, data codewords per block) for each group. */
const BLOCKS_M: Record<number, [ec: number, n1: number, d1: number, n2: number, d2: number]> = {
  1: [10, 1, 16, 0, 0], 2: [16, 1, 28, 0, 0], 3: [26, 1, 44, 0, 0], 4: [18, 2, 32, 0, 0], 5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0], 7: [18, 4, 31, 0, 0], 8: [22, 2, 38, 2, 39], 9: [22, 3, 36, 2, 37], 10: [26, 4, 43, 1, 44],
  11: [30, 1, 50, 4, 51], 12: [22, 6, 36, 2, 37], 13: [22, 8, 37, 1, 38], 14: [24, 4, 40, 5, 41], 15: [24, 5, 41, 5, 42],
  16: [28, 7, 45, 3, 46], 17: [28, 10, 46, 1, 47], 18: [26, 9, 43, 4, 44], 19: [26, 3, 44, 11, 45], 20: [26, 3, 41, 13, 42],
};

/** Centres of the alignment patterns, per version (version 1 has none). */
const ALIGNMENT: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46],
  10: [6, 28, 50], 11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62], 14: [6, 26, 46, 66], 15: [6, 26, 48, 70],
  16: [6, 26, 50, 74], 17: [6, 30, 54, 78], 18: [6, 30, 56, 82], 19: [6, 30, 58, 86], 20: [6, 34, 62, 90],
};

export const qrSize = (version: number) => 17 + 4 * version;

/** How many data codewords a version holds at level M. */
export function qrDataCodewords(version: number): number {
  const [, n1, d1, n2, d2] = BLOCKS_M[version];
  return n1 * d1 + n2 * d2;
}

/** How many codewords (data and error correction together) a version holds. */
export function qrTotalCodewords(version: number): number {
  const [ec, n1, d1, n2, d2] = BLOCKS_M[version];
  return n1 * (d1 + ec) + n2 * (d2 + ec);
}

/** Bits used for the length in byte mode. */
const lengthBits = (version: number) => (version <= 9 ? 8 : 16);

/** The largest number of bytes that fits in a version. */
export function qrCapacity(version: number): number {
  return Math.floor((qrDataCodewords(version) * 8 - 4 - lengthBits(version)) / 8);
}

// ---------- format and version information ----------

/** The 15 format bits for level M and a mask: 5 data bits, 10 check bits (BCH), then the fixed pattern. */
export function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // 00 is level M
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 version bits (versions 7 and above): 6 data bits and 12 check bits (BCH). */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

// ---------- codewords ----------

/** The data codewords for `bytes` in byte mode, padded to the version's capacity. */
function dataCodewords(bytes: Uint8Array, version: number): number[] {
  const capacity = qrDataCodewords(version);
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, lengthBits(version));
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacity * 8 - bits.length)); // terminator
  while (bits.length % 8 !== 0) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    out.push(byte);
  }
  for (let pad = 0xec; out.length < capacity; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** Splits the data into blocks, adds error correction to each, and interleaves the result. */
function interleave(data: number[], version: number): number[] {
  const [ec, n1, d1, n2, d2] = BLOCKS_M[version];
  const blocks: number[][] = [];
  const checks: number[][] = [];
  let at = 0;
  for (let i = 0; i < n1 + n2; i++) {
    const length = i < n1 ? d1 : d2;
    const block = data.slice(at, at + length);
    at += length;
    blocks.push(block);
    checks.push(rsRemainder(block, ec));
  }
  const out: number[] = [];
  const longest = Math.max(d1, d2);
  for (let i = 0; i < longest; i++) for (const block of blocks) if (i < block.length) out.push(block[i]);
  for (let i = 0; i < ec; i++) for (const check of checks) out.push(check[i]);
  return out;
}

// ---------- the matrix ----------

interface Grid { size: number; dark: Uint8Array; fixed: Uint8Array }

/** Draws everything that is not data, and marks those modules as fixed. */
function functionPatterns(version: number): Grid {
  const size = qrSize(version);
  const dark = new Uint8Array(size * size);
  const fixed = new Uint8Array(size * size);
  const set = (row: number, col: number, on: boolean) => {
    if (row < 0 || col < 0 || row >= size || col >= size) return;
    dark[row * size + col] = on ? 1 : 0;
    fixed[row * size + col] = 1;
  };

  // Finder patterns with their light separators.
  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3)); // distance from the centre
        set(top + dy, left + dx, ring === 3 || ring <= 1);
      }
    }
  }
  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // Alignment patterns, except where a finder is.
  const centres = ALIGNMENT[version];
  const last = centres.length - 1;
  centres.forEach((row, i) => centres.forEach((col, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(row + dy, col + dx, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  // Room for the format bits (filled in per mask), and the module that is always dark.
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) { set(8, i, false); set(i, 8, false); }
  }
  for (let i = 0; i < 8; i++) {
    set(8, size - 1 - i, false);
    set(size - 1 - i, 8, false);
  }
  set(size - 8, 8, true);
  // Version information, twice.
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const on = ((bits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      set(a, b, on); // top right
      set(b, a, on); // bottom left
    }
  }
  return { size, dark, fixed };
}

/** Lays the codewords in the free modules: pairs of columns from the right, alternately up and down. */
function placeData(grid: Grid, codewords: number[]): void {
  const { size, dark, fixed } = grid;
  let bit = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the vertical timing pattern has a column to itself
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let j = 0; j < 2; j++) {
        const at = row * size + right - j;
        if (fixed[at]) continue;
        if (bit < total) dark[at] = (codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1;
        bit++; // any modules left over stay light
      }
    }
  }
}

const MASKS: ((row: number, col: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** A copy of the grid with one mask applied to the data modules and that mask's format bits written. */
function masked(grid: Grid, mask: number): Uint8Array {
  const { size, fixed } = grid;
  const out = Uint8Array.from(grid.dark);
  const test = MASKS[mask];
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!fixed[row * size + col] && test(row, col)) out[row * size + col] ^= 1;
    }
  }
  const bits = formatBits(mask);
  const bitAt = (i: number) => (bits >>> i) & 1;
  const put = (row: number, col: number, i: number) => { out[row * size + col] = bitAt(i); };
  // First copy, around the top-left finder.
  for (let i = 0; i <= 5; i++) put(i, 8, i);
  put(7, 8, 6);
  put(8, 8, 7);
  put(8, 7, 8);
  for (let i = 9; i < 15; i++) put(8, 14 - i, i);
  // Second copy, split between the top-right and bottom-left finders.
  for (let i = 0; i < 8; i++) put(8, size - 1 - i, i);
  for (let i = 8; i < 15; i++) put(size - 15 + i, 8, i);
  return out;
}

/** The penalty score of a finished symbol: lower is easier to scan. */
export function qrPenalty(cells: ArrayLike<number>, size: number): number {
  let score = 0;
  const at = (row: number, col: number) => cells[row * size + col];
  // The finder look-alike, dark-light-dark-dark-dark-light-dark with four light modules on one side.
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];

  for (let pass = 0; pass < 2; pass++) {
    const get = pass === 0 ? at : (line: number, i: number) => at(i, line);
    for (let line = 0; line < size; line++) {
      // Rule 1: runs of five or more of one colour.
      let run = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && get(line, i) === get(line, i - 1)) { run++; continue; }
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
      // Rule 3: the finder look-alike.
      for (let i = 0; i + 11 <= size; i++) {
        let a = true;
        let b = true;
        for (let k = 0; k < 11 && (a || b); k++) {
          const v = get(line, i + k);
          if (v !== A[k]) a = false;
          if (v !== B[k]) b = false;
        }
        if (a) score += 40;
        if (b) score += 40;
      }
    }
  }
  // Rule 2: two-by-two squares of one colour.
  for (let row = 0; row < size - 1; row++) {
    for (let col = 0; col < size - 1; col++) {
      const v = at(row, col);
      if (v === at(row, col + 1) && v === at(row + 1, col) && v === at(row + 1, col + 1)) score += 3;
    }
  }
  // Rule 4: how far the share of dark modules is from one half, in steps of five per cent.
  let darkCount = 0;
  for (let i = 0; i < size * size; i++) darkCount += cells[i];
  const total = size * size;
  score += Math.floor(Math.abs(darkCount * 20 - total * 10) / total) * 10;
  return score;
}

// ---------- public ----------

/** The smallest version (1 to 20) that holds this many bytes, or 0 when none does. */
export function qrVersionFor(byteLength: number): number {
  for (let v = QR_MIN_VERSION; v <= QR_MAX_VERSION; v++) if (byteLength <= qrCapacity(v)) return v;
  return 0;
}

export interface QrOptions {
  /** Use at least this version (for tests). */
  minVersion?: number;
  /** Use this mask instead of choosing the best one (for tests). */
  mask?: number;
}

/** Encodes text as a QR code at level M. Returns null when the text is too long (over 666 bytes). */
export function encodeQr(text: string, options: QrOptions = {}): QrCode | null {
  const bytes = new TextEncoder().encode(text);
  const needed = qrVersionFor(bytes.length);
  const version = Math.max(needed, options.minVersion ?? QR_MIN_VERSION);
  if (needed === 0 || version > QR_MAX_VERSION) return null;

  const grid = functionPatterns(version);
  placeData(grid, interleave(dataCodewords(bytes, version), version));

  let best: { mask: number; cells: Uint8Array; score: number } | null = null;
  for (let mask = 0; mask < 8; mask++) {
    if (options.mask !== undefined && options.mask !== mask) continue;
    const cells = masked(grid, mask);
    const score = qrPenalty(cells, grid.size);
    if (!best || score < best.score) best = { mask, cells, score };
  }
  if (!best) return null;

  const { size } = grid;
  const modules: boolean[][] = [];
  for (let row = 0; row < size; row++) {
    const line: boolean[] = [];
    for (let col = 0; col < size; col++) line.push(best.cells[row * size + col] === 1);
    modules.push(line);
  }
  return { version, size, mask: best.mask, modules };
}

/** The dark modules as one SVG path, each module one unit square, shifted by `quiet` units. */
export function qrPath(qr: QrCode, quiet = 4): string {
  let d = '';
  for (let row = 0; row < qr.size; row++) {
    for (let col = 0; col < qr.size; col++) {
      if (!qr.modules[row][col]) continue;
      let end = col;
      while (end + 1 < qr.size && qr.modules[row][end + 1]) end++;
      const width = end - col + 1;
      d += `M${col + quiet} ${row + quiet}h${width}v1h-${width}z`;
      col = end;
    }
  }
  return d;
}
