// The drawn signature of completion (wave 15, E38-11): the strokes drawn with a finger, made into a
// small black-on-white PNG on the phone, with no library (the app has none that draws images). The
// picture is attached to the inspection like a photo; the signer's typed name is what the server keeps
// on the inspection (`signed_by_name`), so the drawing is optional and nothing depends on a gesture.
//
// PNG: 8-bit grayscale, deflate "stored" blocks (no compression; a 480 x 160 signature is about 77 KB),
// CRC-32 and Adler-32 as the format requires. Pure.

export interface Point { x: number; y: number }
export type Stroke = Point[];

/** The picture's size in pixels; strokes are scaled into it from the pad's size. */
export const SIGNATURE_SIZE = { width: 480, height: 160 } as const;
const INK_RADIUS = 2;

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib data of `raw` in stored (uncompressed) deflate blocks. */
function zlibStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  out[0] = 0x78; out[1] = 0x01;
  let o = 2;
  for (let b = 0; b < blocks; b++) {
    const from = b * 65535;
    const len = Math.min(65535, raw.length - from);
    out[o++] = b === blocks - 1 ? 1 : 0;
    out[o++] = len & 0xff; out[o++] = len >>> 8;
    out[o++] = ~len & 0xff; out[o++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(from, from + len), o);
    o += len;
  }
  const ad = adler32(raw);
  out[o++] = ad >>> 24; out[o++] = (ad >>> 16) & 0xff; out[o++] = (ad >>> 8) & 0xff; out[o++] = ad & 0xff;
  return out;
}

const u32 = (n: number) => [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  out.set(u32(crc32(out, 4, 8 + data.length)), 8 + data.length);
  return out;
}

/** A grayscale PNG of `pixels` (0 black to 255 white, row by row). */
export function encodeGrayPng(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // no filter
    raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const ihdr = new Uint8Array([...u32(width), ...u32(height), 8, 0, 0, 0, 0]);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlibStored(raw)), chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Draws the strokes (in pad coordinates) into a white picture of SIGNATURE_SIZE. */
export function rasterize(strokes: Stroke[], pad: { width: number; height: number }, size = SIGNATURE_SIZE): Uint8Array {
  const { width, height } = size;
  const px = new Uint8Array(width * height).fill(255);
  const sx = pad.width ? width / pad.width : 1;
  const sy = pad.height ? height / pad.height : 1;
  const dot = (cx: number, cy: number) => {
    for (let dy = -INK_RADIUS; dy <= INK_RADIUS; dy++) {
      for (let dx = -INK_RADIUS; dx <= INK_RADIUS; dx++) {
        if (dx * dx + dy * dy > INK_RADIUS * INK_RADIUS) continue;
        const x = Math.round(cx + dx);
        const y = Math.round(cy + dy);
        if (x >= 0 && y >= 0 && x < width && y < height) px[y * width + x] = 0;
      }
    }
  };
  for (const s of strokes) {
    const pts = s.map((p) => ({ x: p.x * sx, y: p.y * sy }));
    if (pts.length === 1) dot(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
      for (let k = 0; k <= steps; k++) dot(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps);
    }
  }
  return px;
}

/** Whether anything was drawn. */
export const hasInk = (strokes: Stroke[]) => strokes.some((s) => s.length > 0);

/** The signature as PNG bytes. */
export function signaturePng(strokes: Stroke[], pad: { width: number; height: number }): Uint8Array {
  return encodeGrayPng(rasterize(strokes, pad), SIGNATURE_SIZE.width, SIGNATURE_SIZE.height);
}

export const __test = { crc32, adler32, zlibStored };
