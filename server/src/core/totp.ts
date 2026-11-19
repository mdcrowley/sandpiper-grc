import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// RFC 6238 time-based one-time passwords (SHA-1, 6 digits, 30 second step).

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, atMs = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30000)));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const num = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(num).padStart(6, '0');
}

/** Accepts the current step and one step either side for clock drift. */
export function verifyTotp(secret: string, code: string, atMs = Date.now()): boolean {
  return matchTotpStep(secret, code, atMs) !== null;
}

/**
 * The 30-second time step whose code matches, or null. Callers that accept a code must store
 * the step and refuse any code from that step or an earlier one (see acceptTotpCode in auth.ts).
 */
export function matchTotpStep(secret: string, code: string, atMs = Date.now()): number | null {
  const given = Buffer.from(String(code).replace(/\s/g, '').padStart(6, '0'));
  if (given.length !== 6) return null;
  let matched: number | null = null;
  for (const d of [-1, 0, 1]) { // every candidate is compared, so timing does not show which one matched
    if (timingSafeEqual(given, Buffer.from(totpCode(secret, atMs + d * 30000))) && matched === null) {
      matched = Math.floor(atMs / 30000) + d;
    }
  }
  return matched;
}

export function totpUri(secret: string, account: string, issuer: string): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
}
