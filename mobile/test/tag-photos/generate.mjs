// Generates the tag photo test set (spec §5.5, E38-05): synthetic pictures of asset tags (printed
// digits, letters and digits, every code type the camera reads, tags with both, several tags on a
// shelf) with rotation, blur, glare and low contrast, and `set.json`, which holds for each picture
// what is on it, which record it belongs to, and the recognizer output the harness runs the value
// rules on (harness.test.ts). Every value and name is invented.
//
// Run from the repository root (bwip-js comes from the root install; shared/ is imported directly):
//   node mobile/test/tag-photos/generate.mjs
//
// The recognizer output in set.json is modeled on what the on-device readers give (decoded code
// content, lines of text with their boxes, and the usual misreadings of blurred, glared and faint
// print). To measure the real recognizers, run the pictures through the app on an emulator or a
// phone with the development reads log on and replace a picture's `live`/`still` with what it logged.
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { checkCharacter, sequenceValue } from '../../../shared/tag-format.ts';

const require = createRequire(import.meta.url);
const bwipjs = require('bwip-js');
const here = dirname(fileURLToPath(import.meta.url));
const imagesDir = join(here, 'images');

// ---------- PNG in and out (grayscale) ----------

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Written as RGB: Android's picture readers gave nothing for some 8-bit grayscale PNGs, and camera
// pictures are color anyway.
function encodePng(img) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0); ihdr.writeUInt32BE(img.h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const stride = img.w * 3 + 1;
  const raw = Buffer.alloc(stride * img.h);
  for (let y = 0; y < img.h; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < img.w; x++) raw.fill(Math.max(0, Math.min(255, Math.round(img.px[y * img.w + x]))), y * stride + 1 + x * 3, y * stride + 4 + x * 3);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function decodePng(buf) {
  let p = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8); const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8) throw new Error('8-bit PNG only'); }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      let r = v;
      if (f === 1) r = v + a; else if (f === 2) r = v + b; else if (f === 3) r = v + ((a + b) >> 1);
      else if (f === 4) { const pp = a + b - c; const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      out[y * stride + x] = r & 0xff;
    }
  }
  const px = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * bpp;
    const g = ct === 0 || ct === 4 ? out[o] : 0.299 * out[o] + 0.587 * out[o + 1] + 0.114 * out[o + 2];
    const alpha = ct === 6 ? out[o + 3] / 255 : ct === 4 ? out[o + 1] / 255 : 1;
    px[i] = g * alpha + 255 * (1 - alpha);
  }
  return { w, h, px };
}

// ---------- drawing ----------

const canvas = (w, h, v = 205) => ({ w, h, px: new Float32Array(w * h).fill(v) });

function fillRect(img, x, y, w, h, v) {
  for (let j = Math.max(0, y); j < Math.min(img.h, y + h); j++) for (let i = Math.max(0, x); i < Math.min(img.w, x + w); i++) img.px[j * img.w + i] = v;
}

function paste(img, src, x, y) {
  for (let j = 0; j < src.h; j++) for (let i = 0; i < src.w; i++) {
    const X = x + i, Y = y + j;
    if (X >= 0 && Y >= 0 && X < img.w && Y < img.h) img.px[Y * img.w + X] = Math.min(img.px[Y * img.w + X], src.px[j * src.w + i]);
  }
}

/**
 * Printed text in OCR-B (the lettering bwip-js prints under barcodes, and a common typeface on bought
 * tags): a Code 128 symbol is drawn with its text, and only the text is kept.  `px` is the text height.
 */
async function textImage(str, px) {
  const img = decodePng(await bwipjs.toBuffer({ bcid: 'code128', text: str, scale: Math.ceil(px / 12), height: 2, includetext: true, textsize: Math.round((px * 1.4) / Math.ceil(px / 12)), textyoffset: -12, textxalign: 'center', textgaps: 1, paddingwidth: 0, paddingheight: 0 }));
  const dark = (x, y) => img.px[y * img.w + x] < 128;
  const rowDark = (y) => { for (let x = 0; x < img.w; x++) if (dark(x, y)) return true; return false; };
  let y = 0;
  while (y < img.h && rowDark(y)) y++; // the bars
  while (y < img.h && !rowDark(y)) y++; // the gap
  let y2 = img.h - 1;
  while (y2 > y && !rowDark(y2)) y2--;
  let x1 = img.w, x2 = 0;
  for (let j = y; j <= y2; j++) for (let x = 0; x < img.w; x++) if (dark(x, j)) { x1 = Math.min(x1, x); x2 = Math.max(x2, x); }
  const out = canvas(x2 - x1 + 1, y2 - y + 1, 255);
  for (let j = 0; j < out.h; j++) for (let i = 0; i < out.w; i++) out.px[j * out.w + i] = img.px[(y + j) * img.w + x1 + i];
  return out;
}

async function code(bcid, content, scale = 3) {
  // Quiet zones as printed labels have them (ten modules beside a linear code).
  const linear = !['qrcode', 'datamatrix', 'azteccode', 'pdf417'].includes(bcid);
  const opts = { bcid, text: content, scale, paddingwidth: linear ? 10 : 4, paddingheight: 4 };
  if (!['qrcode', 'datamatrix', 'azteccode', 'pdf417'].includes(bcid)) opts.height = 12;
  // Code 93 always carries its two check characters (bwip-js adds them only when asked).
  if (bcid === 'code93') opts.includecheck = true;
  return decodePng(await bwipjs.toBuffer(opts));
}

// ---------- picture effects ----------

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function rotate(img, deg, fill = 205) {
  const out = canvas(img.w, img.h, fill);
  const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a), cx = img.w / 2, cy = img.h / 2;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const sx = cos * (x - cx) + sin * (y - cy) + cx, sy = -sin * (x - cx) + cos * (y - cy) + cy;
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= img.w || y0 + 1 >= img.h) continue;
    const fx = sx - x0, fy = sy - y0, P = (i, j) => img.px[j * img.w + i];
    out.px[y * img.w + x] = P(x0, y0) * (1 - fx) * (1 - fy) + P(x0 + 1, y0) * fx * (1 - fy) + P(x0, y0 + 1) * (1 - fx) * fy + P(x0 + 1, y0 + 1) * fx * fy;
  }
  return out;
}

function blur(img, r) {
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Float32Array(img.px.length);
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const X = Math.min(img.w - 1, Math.max(0, x + k)); s += img.px[y * img.w + X]; n++; }
      tmp[y * img.w + x] = s / n;
    }
    for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
      let s = 0, n = 0;
      for (let k = -r; k <= r; k++) { const Y = Math.min(img.h - 1, Math.max(0, y + k)); s += tmp[Y * img.w + x]; n++; }
      img.px[y * img.w + x] = s / n;
    }
  }
  return img;
}

function glare(img, cx, cy, sigma, strength) {
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const d2 = (x - cx) ** 2 + (y - cy) ** 2;
    img.px[y * img.w + x] += strength * 255 * Math.exp(-d2 / (2 * sigma * sigma));
  }
  return img;
}

function contrast(img, lo, hi) {
  for (let i = 0; i < img.px.length; i++) img.px[i] = lo + (Math.max(0, Math.min(255, img.px[i])) / 255) * (hi - lo);
  return img;
}

function noise(img, amount, seed) {
  const r = rng(seed);
  for (let i = 0; i < img.px.length; i++) img.px[i] += (r() - 0.5) * 2 * amount;
  return img;
}

// ---------- values ----------

const luhn = (n) => sequenceValue(n, { digits: 5, checkCharacter: 'mod10' });
const mod36 = (body) => `${body}${checkCharacter(body, 'mod36')}`;
const gtinCheck = (digits) => {
  const sum = [...digits].reverse().reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
};
const ean = (body) => body + gtinCheck(body);
// UPC-E 0 123456 (last digit 6: manufacturer 12345, product 6) expands to UPC-A 0 12345 00006.
const UPCE = `0123456${gtinCheck('01234500006')}`;

// ---------- the photos ----------

/** Tag formats of each scenario (as GET /api/mobile/settings gives them). */
const F = (o) => ({ name: o.id, pattern: null, prefix: '', lengthMin: null, lengthMax: null, checkCharacter: 'none', carrier: 'any', extractPattern: null, recordTypes: [], active: true, ...o });
const SCENARIOS = {
  none: { label: 'No tag formats configured', formats: [] },
  bought: { label: 'Bought tags: 6 digits with a mod 10 check digit', formats: [F({ id: 'bought', characters: 'digits', lengthMin: 6, lengthMax: 6, checkCharacter: 'mod10' })] },
  printed: { label: 'Printed tags: TA- and 6 digits, no check character', formats: [F({ id: 'printed', characters: 'digits', prefix: 'TA-', lengthMin: 6, lengthMax: 6 })] },
  alnum: { label: 'Letters and digits: 6 characters with a mod 36 check character', formats: [F({ id: 'alnum', characters: 'alphanumeric', lengthMin: 6, lengthMax: 6, checkCharacter: 'mod36' })] },
  extract: { label: 'Codes holding more than the value: the value after ID', formats: [F({ id: 'extract', characters: 'alphanumeric', lengthMin: 6, lengthMax: 6, carrier: 'code', extractPattern: 'ID[:=]([A-Z0-9]+)' })] },
};

/** Records each scenario's server knows (value → record), besides each photo's own. Look-alike decoys test "never a wrong record". */
const DECOYS = {
  none: { '004527': 'asset:decoy-1', 'TA-118343': 'asset:decoy-2' },
  printed: { 'TA-113342': 'asset:decoy-3', 'TA-118312': 'asset:decoy-4' },
  bought: {},
  alnum: {},
  extract: {},
};

const TOP = 'PROPERTY OF THE AUTHORITY';

// Each tag: optional code (bwip id, reader type, content), optional printed value, optional top line.
// `reads` says how the readers did on this tag, frame by frame (default: everything read in 3 frames):
//   code: [true, false, ...] decoded per frame; text: ['...', null, ...] the line read per frame;
//   stillCode / stillText: what a still picture gives (only used when the live frames gave nothing).
const LIVE = 3;
const photos = [];
const add = (id, scenario, description, tags, effects = [], expect) => photos.push({ id, scenario, description, tags, effects, expect });
const rec = (value) => ({ kind: 'record', values: [value] });

// Every code type, clean, no formats.
const CODE_CASES = [
  ['qr', 'qrcode', 'qr-code', 'TA-118342'],
  ['datamatrix', 'datamatrix', 'data-matrix', 'K7Q2M9'],
  ['pdf417', 'pdf417', 'pdf-417', 'SB-004512'],
  ['aztec', 'azteccode', 'aztec', 'TA-200117'],
  ['code128', 'code128', 'code-128', '004521'],
  ['code39', 'code39', 'code-39', 'TA-118350'],
  ['code93', 'code93', 'code-93', 'K7Q2M8'],
  ['ean8', 'ean8', 'ean-8', ean('9638507')],
  ['ean13', 'ean13', 'ean-13', ean('400000004521')],
  ['upca', 'upca', 'upc-a', ean('03600029145')],
  ['upce', 'upce', 'upc-e', UPCE],
  ['itf', 'interleaved2of5', 'itf', '00452200'],
  ['codabar', 'rationalizedCodabar', 'codabar', 'A004523A'],
];
for (const [id, bcid, type, content] of CODE_CASES) {
  const value = type === 'codabar' ? content.slice(1, -1) : content;
  add(`code-${id}`, 'none', `${type}, clean`, [{ code: { bcid, type, content }, top: TOP }], [], rec(value));
}

// Codes with effects.
add('code-qr-rotated', 'none', 'QR code, rotated 15 degrees', [{ code: { bcid: 'qrcode', type: 'qr-code', content: 'TA-118344' } }], [['rotate', 15]], rec('TA-118344'));
add('code-128-blur', 'none', 'Code 128, slightly blurred', [{ code: { bcid: 'code128', type: 'code-128', content: '004524' }, reads: { code: [false, true, true] } }], [['blur', 1]], rec('004524'));
add('code-dm-faint', 'none', 'Data Matrix, low contrast', [{ code: { bcid: 'datamatrix', type: 'data-matrix', content: 'K7Q2N4' } }], [['contrast', 120, 190]], rec('K7Q2N4'));
add('code-ean13-glare', 'none', 'EAN-13 under glare: the live view misses it, the still picture reads it', [{ code: { bcid: 'ean13', type: 'ean-13', content: ean('400000004538') }, reads: { code: [false, false, false], stillCode: true } }], [['glare', 0.5, 0.5, 70, 0.9]], rec(ean('400000004538')));
add('code-aztec-rotated-faint', 'none', 'Aztec, rotated 30 degrees and faint', [{ code: { bcid: 'azteccode', type: 'aztec', content: 'SB-004513' } }], [['rotate', 30], ['contrast', 100, 200]], rec('SB-004513'));
add('code-pdf417-blur', 'none', 'PDF417, blurred', [{ code: { bcid: 'pdf417', type: 'pdf-417', content: 'SB-004514' }, reads: { code: [false, false, true] } }], [['blur', 1]], rec('SB-004514'));
add('code-heavy-blur', 'none', 'Code 128, heavily blurred: nothing can be read (a correct "couldn\'t find")', [{ code: { bcid: 'code128', type: 'code-128', content: '009999' }, reads: { code: [false, false, false], stillCode: false } }], [['blur', 4]], { kind: 'none' });

// Bought tags: printed digits with a check digit.
const B1 = luhn(4521), B2 = luhn(4522), B3 = luhn(10007), B4 = luhn(10008), B5 = luhn(23456), B6 = luhn(30011), B7 = luhn(30012), B8 = luhn(48810);
add('bought-clean', 'bought', 'Printed digits, clean', [{ text: B1, top: TOP }], [], rec(B1));
add('bought-rotated', 'bought', 'Printed digits, rotated 8 degrees', [{ text: B2, top: TOP }], [['rotate', 8]], rec(B2));
add('bought-blur', 'bought', 'Printed digits, blurred: the frames disagree at first', [{ text: B3, reads: { text: [B3.replace('7', '1'), B3, B3] } }], [['blur', 2]], rec(B3));
add('bought-glare', 'bought', 'Printed digits under glare: part of the number in one frame', [{ text: B4, reads: { text: [B4.slice(2), B4, B4] } }], [['glare', 0.45, 0.55, 60, 0.8]], rec(B4));
add('bought-faint-lookalikes', 'bought', 'Faint digits read with O for 0 and I for 1', [{ text: B6, reads: { text: Array(LIVE).fill(B6.replace(/0/g, 'O').replace(/1/g, 'I')) } }], [['contrast', 110, 185]], rec(B6));
add('bought-spaced', 'bought', 'Digits printed in two groups', [{ text: `${B5.slice(0, 3)} ${B5.slice(3)}` }], [], rec(B5));
add('bought-misread-still', 'bought', 'A digit misread the same way in every frame (check digit fails); the still picture reads it', [{ text: B7, reads: { text: Array(LIVE).fill(B7.replace(/1/, '7')), stillText: B7 } }], [['blur', 1], ['noise', 18]], rec(B7));
add('bought-label-words', 'bought', 'Digits among other printed words', [{ text: `ASSET NO ${B8}`, top: 'DO NOT REMOVE' }], [], rec(B8));
add('bought-in-stock', 'bought', 'A bought tag not attached yet (in stock)', [{ text: luhn(50001), top: TOP }], [], { kind: 'stock', values: [luhn(50001)] });
add('bought-unknown', 'bought', 'A number matching the format that nobody registered (a correct "couldn\'t find")', [{ text: luhn(77777) }], [], { kind: 'none' });

// Letters and digits with a mod 36 check character.
const A1 = mod36('K7Q2M'), A2 = mod36('H4X9P'), A3 = mod36('R2D2K'), A4 = mod36('B8S5O'), A5 = mod36('Z9W3T');
add('alnum-clean', 'alnum', 'Letters and digits, clean', [{ text: A1, top: TOP }], [], rec(A1));
add('alnum-rotated', 'alnum', 'Letters and digits, rotated 12 degrees', [{ text: A2 }], [['rotate', -12]], rec(A2));
add('alnum-blur', 'alnum', 'Letters and digits, blurred', [{ text: A3, reads: { text: [null, A3, A3] } }], [['blur', 1]], rec(A3));
add('alnum-ambiguous', 'alnum', 'Ambiguous characters (B/8, S/5, O/0) read the other way: variants go to the server', [{ text: A4, reads: { text: Array(LIVE).fill(A4.replace('B', '8').replace('S', '5').replace('O', '0')) } }], [['contrast', 120, 200]], rec(A4));
add('alnum-faint', 'alnum', 'Letters and digits, faint and noisy', [{ text: A5 }], [['contrast', 130, 200], ['noise', 20]], rec(A5));

// Printed tags with a prefix and no check character: the person confirms.
add('printed-clean', 'printed', 'TA- and digits, clean (confirmed by the person)', [{ text: 'TA-118342', top: TOP }], [], rec('TA-118342'));
add('printed-spaced', 'printed', 'TA- and digits in two groups', [{ text: 'TA-118 351' }], [], rec('TA-118351'));
add('printed-decoy', 'printed', 'An 8 read as a 3 in every frame gives another tag\'s number: only offered, never opened; the still picture reads it', [{ text: 'TA-118342', reads: { text: Array(LIVE).fill('TA-113342'), stillText: 'TA-118342' } }], [['blur', 2]], rec('TA-118342'));
add('printed-lookalikes', 'printed', 'Faint: O read for 0', [{ text: 'TA-100200', reads: { text: Array(LIVE).fill('TA-1OO2OO') } }], [['contrast', 120, 195]], rec('TA-100200'));

// Codes holding more than the value (extraction pattern).
add('extract-qr-address', 'extract', 'QR code holding a web address with the value in it', [{ code: { bcid: 'qrcode', type: 'qr-code', content: 'https://labels.example.org/t?ID=K7Q2P1&lot=4' } }], [], rec('K7Q2P1'));
add('extract-dm-fields', 'extract', 'Data Matrix holding several fields', [{ code: { bcid: 'datamatrix', type: 'data-matrix', content: 'SUP:12|ID:H4X9Q2|LOT:7' } }], [['rotate', 10]], rec('H4X9Q2'));
add('extract-128-plain', 'extract', 'Code 128 holding just the value', [{ code: { bcid: 'code128', type: 'code-128', content: 'R2D2K9' } }], [], rec('R2D2K9'));

// Tags with both a code and printed text.
add('both-agree', 'bought', 'Code 128 and printed digits that agree', [{ code: { bcid: 'code128', type: 'code-128', content: luhn(61001) }, text: luhn(61001) }], [], rec(luhn(61001)));
add('both-text-misread', 'none', 'Code and text disagree (text misread): the code wins', [{ code: { bcid: 'code128', type: 'code-128', content: '004520' }, text: '004520', reads: { text: Array(LIVE).fill('004527') } }], [['blur', 1]], rec('004520'));
add('both-code-lost', 'bought', 'Code too blurred to decode, digits readable', [{ code: { bcid: 'code128', type: 'code-128', content: luhn(61002) }, text: luhn(61002), reads: { code: [false, false, false] } }], [['blur', 2]], rec(luhn(61002)));
add('both-qr-and-text', 'none', 'QR code with the value printed beside it', [{ code: { bcid: 'qrcode', type: 'qr-code', content: 'TA-118355' }, text: 'TA-118355', top: TOP }], [], rec('TA-118355'));
add('both-rotated-glare', 'alnum', 'Data Matrix and text, rotated with glare', [{ code: { bcid: 'datamatrix', type: 'data-matrix', content: mod36('K7Q2N') }, text: mod36('K7Q2N'), reads: { text: [null, null, null] } }], [['rotate', -20], ['glare', 0.6, 0.4, 50, 0.7]], rec(mod36('K7Q2N')));

// Text without any format: offered for the person to confirm.
add('plain-digits', 'none', 'Printed digits, no format (confirmed by the person)', [{ text: '004530', top: TOP }], [], rec('004530'));
add('plain-letters-digits', 'none', 'Printed letters and digits, no format', [{ text: 'SB-004516' }], [['rotate', 5]], rec('SB-004516'));
add('plain-misread-decoy', 'none', 'No format, 1 read as 7 everywhere, matching another tag: only offered; the still picture reads it', [{ text: '004521', reads: { text: Array(LIVE).fill('004527'), stillText: '004521' } }], [['blur', 2]], rec('004521'));
add('plain-label-only', 'none', 'A label with words and no number (a correct "couldn\'t find")', [{ text: 'DO NOT REMOVE', top: TOP }], [], { kind: 'none' });
add('plain-faint', 'none', 'Faint printed digits, no format', [{ text: '004531' }], [['contrast', 120, 190], ['noise', 15]], rec('004531'));

// Several tags in view (a shelf).
add('shelf-codes', 'none', 'Three coded tags on a shelf', [
  { code: { bcid: 'code128', type: 'code-128', content: '004601' } },
  { code: { bcid: 'qrcode', type: 'qr-code', content: 'TA-118401' } },
  { code: { bcid: 'datamatrix', type: 'data-matrix', content: 'K7Q4M1' } },
], [], { kind: 'record', values: ['004601', 'TA-118401', 'K7Q4M1'] });
add('shelf-bought-text', 'bought', 'Three printed bought tags on a shelf', [{ text: luhn(70001) }, { text: luhn(70002) }, { text: luhn(70003) }], [['rotate', 3]], { kind: 'record', values: [luhn(70001), luhn(70002), luhn(70003)] });
add('shelf-mixed', 'bought', 'A coded tag and a printed tag side by side', [{ code: { bcid: 'code128', type: 'code-128', content: luhn(70004) } }, { text: luhn(70005) }], [], { kind: 'record', values: [luhn(70004), luhn(70005)] });
add('shelf-with-stock', 'bought', 'An attached tag next to one still in stock', [{ text: luhn(70006) }, { text: luhn(50002) }], [], { kind: 'record', values: [luhn(70006)], stock: [luhn(50002)] });

// Codes nobody registered.
add('code-unknown', 'none', 'A code whose value is not registered (a correct "couldn\'t find")', [{ code: { bcid: 'code128', type: 'code-128', content: '009001' } }], [], { kind: 'none' });
add('code-in-stock', 'none', 'A coded tag in stock, not attached', [{ code: { bcid: 'code128', type: 'code-128', content: '008001' } }], [], { kind: 'stock', values: ['008001'] });

// ---------- render ----------

function layoutWidth(tags) { return Math.max(640, tags.length * 400); }

async function render(photo) {
  const W = layoutWidth(photo.tags), H = 400;
  let img = canvas(W, H, 200);
  const truths = [];
  for (let t = 0; t < photo.tags.length; t++) {
    const tag = photo.tags[t];
    const slot = W / photo.tags.length;
    const parts = [];
    let codeImg = null;
    if (tag.code) codeImg = await code(tag.code.bcid, tag.code.content, tag.code.bcid === 'pdf417' ? 2 : 3);
    const textImg = tag.text ? await textImage(tag.text, 30) : null;
    const topImg = tag.top ? await textImage(tag.top, 13) : null;
    const innerW = Math.max(codeImg?.w ?? 0, textImg?.w ?? 0, topImg?.w ?? 0);
    const innerH = (topImg ? topImg.h + 10 : 0) + (codeImg ? codeImg.h + 8 : 0) + (textImg?.h ?? 0);
    const lw = Math.min(slot - 16, innerW + 24), lh = innerH + 24;
    const lx = Math.round(t * slot + (slot - lw) / 2), ly = Math.round((H - lh) / 2);
    fillRect(img, lx - 2, ly - 2, lw + 4, lh + 4, 90);
    fillRect(img, lx, ly, lw, lh, 245);
    let y = ly + 12;
    const reads = { codeBox: null, textBox: null, topBox: null };
    const put = (src) => { const x = Math.round(lx + (lw - src.w) / 2); paste(img, src, x, y); return { x, y, width: src.w, height: src.h }; };
    if (topImg) { reads.topBox = put(topImg); y += topImg.h + 10; }
    if (codeImg) { const cx = Math.round(lx + (lw - codeImg.w) / 2); paste(img, codeImg, cx, y); reads.codeBox = { x: cx, y, width: codeImg.w, height: codeImg.h }; y += codeImg.h + 8; }
    if (textImg) reads.textBox = put(textImg);
    parts.push(reads);
    truths.push({ tag, boxes: reads });
  }
  for (const [kind, ...args] of photo.effects) {
    if (kind === 'rotate') img = rotate(img, args[0]);
    if (kind === 'blur') img = blur(img, args[0]);
    if (kind === 'glare') img = glare(img, args[0] * W, args[1] * H, args[2], args[3]);
    if (kind === 'contrast') img = contrast(img, args[0], args[1]);
    if (kind === 'noise') img = noise(img, args[0], photo.id.length * 7919);
  }

  return { png: encodePng(img), W, H, truths };
}

/** The modeled recognizer output for a photo: LIVE frames, and a still picture. */
function recognizerOutput(photo, W, H, truths) {
  const frames = Array.from({ length: LIVE }, () => ({ width: W, height: H, codes: [], lines: [] }));
  const still = { width: W, height: H, still: true, codes: [], lines: [] };
  for (const { tag, boxes } of truths) {
    const r = tag.reads ?? {};
    for (let f = 0; f < LIVE; f++) {
      if (tag.code && (r.code?.[f] ?? true)) frames[f].codes.push({ type: tag.code.type, content: tag.code.content, box: boxes.codeBox });
      if (boxes.topBox) frames[f].lines.push({ text: tag.top, box: boxes.topBox });
      const line = r.text ? r.text[f] : tag.text;
      if (tag.text && line) frames[f].lines.push({ text: line, box: boxes.textBox });
    }
    if (tag.code && (r.stillCode ?? (r.code ? r.code.some(Boolean) : true))) still.codes.push({ type: tag.code.type, content: tag.code.content, box: boxes.codeBox });
    if (boxes.topBox) still.lines.push({ text: tag.top, box: boxes.topBox });
    const stillLine = r.stillText !== undefined ? r.stillText : r.text ? r.text[LIVE - 1] : tag.text;
    if (tag.text && stillLine) still.lines.push({ text: stillLine, box: boxes.textBox });
  }
  return { live: frames, still };
}

rmSync(imagesDir, { recursive: true, force: true });
mkdirSync(imagesDir, { recursive: true });
const out = { version: 1, generatedBy: 'mobile/test/tag-photos/generate.mjs', scenarios: {}, photos: [] };
for (const [key, s] of Object.entries(SCENARIOS)) out.scenarios[key] = { ...s, decoys: DECOYS[key] };
let bytes = 0;
for (const photo of photos) {
  const { png, W, H, truths } = await render(photo);
  writeFileSync(join(imagesDir, `${photo.id}.png`), png);
  bytes += png.length;
  out.photos.push({
    id: photo.id, file: `images/${photo.id}.png`, scenario: photo.scenario, description: photo.description,
    effects: photo.effects.map(([k]) => k), codeTypes: photo.tags.filter((t) => t.code).map((t) => t.code.type),
    expect: photo.expect, ...recognizerOutput(photo, W, H, truths),
  });
}
writeFileSync(join(here, 'set.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`${photos.length} photos, ${Math.round(bytes / 1024)} KB of images`);
