// Signed tokens the push services ask for: ES256 for Apple (token-based connection) and for
// UnifiedPush (VAPID, RFC 8292), RS256 for Google's service account assertion (RFC 7523).
import { createHash, createPrivateKey, createPublicKey, sign, type KeyObject } from 'node:crypto';

const b64url = (v: Buffer | string) => Buffer.from(v).toString('base64url');

export function signJwt(header: Record<string, unknown>, claims: Record<string, unknown>, key: KeyObject): string {
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const alg = header.alg;
  const signature = alg === 'ES256'
    ? sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' })
    : sign('RSA-SHA256', Buffer.from(input), key);
  return `${input}.${b64url(signature)}`;
}

/** A PEM private key, or null when it is not one (or not of the kind wanted). */
export function parsePrivateKey(pem: string, kind: 'ec-p256' | 'rsa'): KeyObject | null {
  try {
    const key = createPrivateKey({ key: pem, format: 'pem' });
    if (kind === 'rsa') return key.asymmetricKeyType === 'rsa' ? key : null;
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1' ? key : null;
  } catch {
    return null;
  }
}

/** First 16 hex characters of the SHA-256 of the public key: tells keys apart without revealing them. */
export function keyFingerprint(key: KeyObject): string {
  const der = createPublicKey(key).export({ format: 'der', type: 'spki' });
  return createHash('sha256').update(der).digest('hex').slice(0, 16).replace(/(.{4})(?!$)/g, '$1:');
}

/** The uncompressed P-256 public point (65 bytes, 0x04 || x || y) of an EC key. */
export function rawPublicKey(key: KeyObject): Buffer {
  const jwk = createPublicKey(key).export({ format: 'jwk' }) as { x: string; y: string };
  return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
}
