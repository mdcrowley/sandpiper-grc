// What kind of picture a file is, and its size in pixels, read from the file's own header (its
// "magic bytes"), never from its name. Only PNG, JPEG and WebP are recognized: these are the
// formats a browser shows without running anything. SVG is deliberately not one of them (it can
// carry scripts).

export type ImageType = 'image/png' | 'image/jpeg' | 'image/webp';
export interface ImageInfo { type: ImageType; width: number; height: number }

const u16be = (b: Buffer, i: number) => b.readUInt16BE(i);
const u24le = (b: Buffer, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

function png(b: Buffer): ImageInfo | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 33 || !sig.every((x, i) => b[i] === x)) return null;
  // The first chunk must be IHDR, 13 bytes: width and height as 32-bit big-endian numbers.
  if (b.toString('latin1', 12, 16) !== 'IHDR' || b.readUInt32BE(8) !== 13) return null;
  return { type: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function jpeg(b: Buffer): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; } // padding
    if (marker === 0xd9 || marker === 0xda) return null; // end of image or start of scan before a frame header
    if (marker >= 0xd0 && marker <= 0xd7) { i += 2; continue; } // restart markers carry no length
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    // Start of frame: every SOFn except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { type: 'image/jpeg', height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

function webp(b: Buffer): ImageInfo | null {
  if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    // Lossy: a key frame starts with the start code 9d 01 2a, then 14-bit width and height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { type: 'image/webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    // Lossless: signature 2f, then width-1 and height-1 in 14 bits each.
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    // Extended: canvas width-1 and height-1 as 24-bit little-endian numbers.
    return { type: 'image/webp', width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}

/** The picture's type and size from its header, or null when it is not a PNG, JPEG or WebP file. */
export function imageInfo(b: Buffer): ImageInfo | null {
  try {
    return png(b) ?? jpeg(b) ?? webp(b);
  } catch {
    return null; // a header cut short
  }
}
