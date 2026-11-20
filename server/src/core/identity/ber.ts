// The small part of ASN.1 BER that LDAP v3 uses (RFC 4511 section 5.1): definite lengths, one-byte
// tags, integers, octet strings, booleans, enumerations, sequences and sets. Used by the directory
// (LDAP) client in ldapclient.ts and by the stand-in directory in ldap-fake-server.ts.
//
// Reading is defensive: everything a directory (or a test) sends is length-checked against the
// buffer, lengths over four bytes and indefinite lengths are refused, and nothing recurses on the
// input's own nesting beyond what the caller asks for.

export const TAG = {
  boolean: 0x01, integer: 0x02, octets: 0x04, null: 0x05, enumerated: 0x0a, sequence: 0x30, set: 0x31,
} as const;

export class BerError extends Error {
  constructor(message: string) { super(message); this.name = 'BerError'; }
}

function lengthBytes(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** One element: tag, length, content. */
export const tlv = (tag: number, content: Buffer) => Buffer.concat([Buffer.from([tag]), lengthBytes(content.length), content]);

export function integer(n: number, tag: number = TAG.integer): Buffer {
  if (!Number.isInteger(n) || n < 0 || n > 0x7fffffff) throw new BerError('integer out of range');
  const bytes: number[] = [];
  let v = n;
  do { bytes.unshift(v & 0xff); v = Math.floor(v / 256); } while (v > 0);
  if (bytes[0] & 0x80) bytes.unshift(0);
  return tlv(tag, Buffer.from(bytes));
}
export const enumerated = (n: number) => integer(n, TAG.enumerated);
export const octets = (value: string | Buffer, tag: number = TAG.octets) => tlv(tag, typeof value === 'string' ? Buffer.from(value, 'utf8') : value);
export const boolean = (v: boolean, tag: number = TAG.boolean) => tlv(tag, Buffer.from([v ? 0xff : 0x00]));
export const sequence = (...items: Buffer[]) => tlv(TAG.sequence, Buffer.concat(items));
export const set = (...items: Buffer[]) => tlv(TAG.set, Buffer.concat(items));
/** A constructed element with a context or application tag. */
export const constructed = (tag: number, ...items: Buffer[]) => tlv(tag, Buffer.concat(items));

export interface Element {
  tag: number;
  /** The content bytes (not including tag and length). */
  value: Buffer;
}

/**
 * Reads one element at `offset`. Returns null when the buffer does not yet hold all of it (a stream
 * still arriving); throws on what is not BER at all.
 */
export function readElement(buf: Buffer, offset = 0, maxLength = 16 * 1024 * 1024): { el: Element; end: number } | null {
  if (buf.length < offset + 2) return null;
  const tag = buf[offset];
  if ((tag & 0x1f) === 0x1f) throw new BerError('multi-byte tags are not used by LDAP');
  let len = buf[offset + 1];
  let pos = offset + 2;
  if (len & 0x80) {
    const count = len & 0x7f;
    if (count === 0) throw new BerError('indefinite lengths are not allowed');
    if (count > 4) throw new BerError('length too large');
    if (buf.length < pos + count) return null;
    len = 0;
    for (let i = 0; i < count; i += 1) len = len * 256 + buf[pos + i];
    pos += count;
  }
  if (len > maxLength) throw new BerError('element too large');
  if (buf.length < pos + len) return null;
  return { el: { tag, value: buf.subarray(pos, pos + len) }, end: pos + len };
}

/** The elements inside a constructed element. Throws when the content is not whole elements. */
export function children(el: Element, max = 100_000): Element[] {
  const out: Element[] = [];
  let pos = 0;
  while (pos < el.value.length) {
    const r = readElement(el.value, pos);
    if (!r) throw new BerError('truncated element');
    out.push(r.el);
    if (out.length > max) throw new BerError('too many elements');
    pos = r.end;
  }
  return out;
}

export function readInteger(el: Element): number {
  if (el.value.length === 0 || el.value.length > 4) throw new BerError('integer of unusable size');
  let n = 0;
  for (const b of el.value) n = n * 256 + b;
  if (el.value[0] & 0x80) n -= 256 ** el.value.length; // two's complement
  return n;
}
export const readString = (el: Element) => el.value.toString('utf8');
export const readBoolean = (el: Element) => el.value.length === 1 && el.value[0] !== 0;
