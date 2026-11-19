/**
 * A small CBOR (RFC 8949) decoder and encoder: enough for WebAuthn attestation objects and COSE
 * keys. Definite-length items only for maps, arrays and strings (which is all that CTAP2 "canonical"
 * CBOR produces), plus indefinite-length byte and text strings for safety. Tags are read and their
 * content returned as it is. No new packages: the format is simple and the input is untrusted, so
 * every length is checked against the buffer.
 */

export type CborValue =
  | number | bigint | string | boolean | null | undefined
  | Uint8Array | CborValue[] | Map<CborValue, CborValue>;

export class CborError extends Error {}

const MAX_DEPTH = 16;

/** Decodes one item starting at `offset`; returns it with the offset just past it. */
export function decodeCborItem(buf: Uint8Array, offset = 0): { value: CborValue; offset: number } {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let pos = offset;

  const need = (n: number) => {
    if (n < 0 || pos + n > buf.length) throw new CborError('CBOR data ends early');
  };
  const readArg = (info: number): number | bigint | null => {
    if (info < 24) return info;
    if (info === 24) { need(1); return buf[pos++]; }
    if (info === 25) { need(2); const v = view.getUint16(pos); pos += 2; return v; }
    if (info === 26) { need(4); const v = view.getUint32(pos); pos += 4; return v; }
    if (info === 27) {
      need(8);
      const v = view.getBigUint64(pos); pos += 8;
      return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
    }
    if (info === 31) return null; // indefinite length
    throw new CborError('Malformed CBOR length');
  };
  const length = (arg: number | bigint | null): number => {
    if (typeof arg !== 'number') throw new CborError('CBOR length too large');
    return arg;
  };

  const item = (depth: number): CborValue => {
    if (depth > MAX_DEPTH) throw new CborError('CBOR nested too deeply');
    need(1);
    const initial = buf[pos++];
    const major = initial >> 5;
    const info = initial & 0x1f;
    switch (major) {
      case 0: {
        const v = readArg(info);
        if (v === null) throw new CborError('Malformed CBOR integer');
        return v;
      }
      case 1: {
        const v = readArg(info);
        if (v === null) throw new CborError('Malformed CBOR integer');
        return typeof v === 'bigint' ? -1n - v : -1 - v;
      }
      case 2:
      case 3: {
        const arg = readArg(info);
        let bytes: Uint8Array;
        if (arg === null) {
          const parts: Uint8Array[] = [];
          for (;;) {
            need(1);
            if (buf[pos] === 0xff) { pos++; break; }
            const chunk = item(depth + 1);
            if (!(major === 2 ? chunk instanceof Uint8Array : typeof chunk === 'string')) throw new CborError('Malformed CBOR string chunk');
            parts.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk as Uint8Array);
          }
          bytes = Buffer.concat(parts);
        } else {
          const n = length(arg);
          need(n);
          bytes = buf.subarray(pos, pos + n);
          pos += n;
        }
        return major === 2 ? Uint8Array.from(bytes) : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      }
      case 4: {
        const arg = readArg(info);
        if (arg === null) throw new CborError('Indefinite-length CBOR arrays are not supported');
        const n = length(arg);
        if (n > buf.length) throw new CborError('CBOR array too long');
        const out: CborValue[] = [];
        for (let i = 0; i < n; i++) out.push(item(depth + 1));
        return out;
      }
      case 5: {
        const arg = readArg(info);
        if (arg === null) throw new CborError('Indefinite-length CBOR maps are not supported');
        const n = length(arg);
        if (n > buf.length) throw new CborError('CBOR map too long');
        const out = new Map<CborValue, CborValue>();
        for (let i = 0; i < n; i++) {
          const k = item(depth + 1);
          if (out.has(k)) throw new CborError('Duplicate CBOR map key');
          out.set(k, item(depth + 1));
        }
        return out;
      }
      case 6: {
        readArg(info); // tag number: the content is returned as it is
        return item(depth + 1);
      }
      default: {
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        if (info === 25) { need(2); const v = halfToFloat(view.getUint16(pos)); pos += 2; return v; }
        if (info === 26) { need(4); const v = view.getFloat32(pos); pos += 4; return v; }
        if (info === 27) { need(8); const v = view.getFloat64(pos); pos += 8; return v; }
        throw new CborError('Unsupported CBOR simple value');
      }
    }
  };

  const value = item(0);
  return { value, offset: pos };
}

/** Decodes a buffer that holds exactly one CBOR item. */
export function decodeCbor(buf: Uint8Array): CborValue {
  const { value, offset } = decodeCborItem(buf, 0);
  if (offset !== buf.length) throw new CborError('Unexpected bytes after the CBOR item');
  return value;
}

function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
  if (exp === 31) return frac ? NaN : sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + frac / 1024);
}

// ---------- encoder (used by the test authenticator; integers, strings, bytes, arrays, maps, booleans) ----------

function head(major: number, n: number): Uint8Array {
  if (n < 24) return Uint8Array.of((major << 5) | n);
  if (n < 0x100) return Uint8Array.of((major << 5) | 24, n);
  if (n < 0x10000) return Uint8Array.of((major << 5) | 25, n >> 8, n & 0xff);
  const b = new Uint8Array(5);
  b[0] = (major << 5) | 26;
  new DataView(b.buffer).setUint32(1, n);
  return b;
}

export function encodeCbor(value: CborValue): Uint8Array {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new CborError('Only integers are encoded');
    return value >= 0 ? head(0, value) : head(1, -1 - value);
  }
  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === 'boolean') return Uint8Array.of(value ? 0xf5 : 0xf4);
  if (value === null) return Uint8Array.of(0xf6);
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(encodeCbor)]);
  if (value instanceof Map) {
    const parts: Uint8Array[] = [head(5, value.size)];
    for (const [k, v] of value) parts.push(encodeCbor(k), encodeCbor(v));
    return Buffer.concat(parts);
  }
  throw new CborError('Value cannot be encoded');
}
