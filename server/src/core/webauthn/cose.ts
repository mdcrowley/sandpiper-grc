import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import type { CborValue } from './cbor.ts';

/**
 * COSE public keys (RFC 9053) as authenticators report them, turned into Node key objects, and
 * signature checks for the three algorithms accepted:
 *   -7   ES256  ECDSA P-256 with SHA-256 (signature DER-encoded, as WebAuthn sends it)
 *   -257 RS256  RSASSA-PKCS1-v1_5 with SHA-256
 *   -8   EdDSA  Ed25519
 */
export const ES256 = -7;
export const RS256 = -257;
export const EDDSA = -8;
export const SUPPORTED_ALGS = [ES256, EDDSA, RS256];
export const ALG_NAMES: Record<number, string> = { [ES256]: 'ES256', [RS256]: 'RS256', [EDDSA]: 'EdDSA' };

export class CoseError extends Error {}

const b64u = (v: CborValue, what: string): string => {
  if (!(v instanceof Uint8Array) || v.length === 0) throw new CoseError(`The key's ${what} is missing`);
  return Buffer.from(v).toString('base64url');
};

/** Reads a COSE_Key map into a public key. Throws CoseError for anything not accepted. */
export function coseToPublicKey(cose: CborValue): { key: KeyObject; alg: number } {
  if (!(cose instanceof Map)) throw new CoseError('The public key is not a COSE key');
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (typeof alg !== 'number' || !SUPPORTED_ALGS.includes(alg)) throw new CoseError('The key uses an algorithm that is not accepted');
  let jwk: Record<string, string>;
  if (alg === ES256) {
    if (kty !== 2 || cose.get(-1) !== 1) throw new CoseError('An ES256 key must be an EC2 key on curve P-256');
    const x = cose.get(-2);
    const y = cose.get(-3);
    if (!(x instanceof Uint8Array) || x.length !== 32 || !(y instanceof Uint8Array) || y.length !== 32) {
      throw new CoseError('The EC2 key coordinates are not 32 bytes');
    }
    jwk = { kty: 'EC', crv: 'P-256', x: b64u(x, 'x'), y: b64u(y, 'y') };
  } else if (alg === RS256) {
    if (kty !== 3) throw new CoseError('An RS256 key must be an RSA key');
    const n = cose.get(-1);
    if (!(n instanceof Uint8Array) || n.length < 256) throw new CoseError('RSA keys shorter than 2048 bits are not accepted');
    jwk = { kty: 'RSA', n: b64u(n, 'modulus'), e: b64u(cose.get(-2), 'exponent') };
  } else {
    if (kty !== 1 || cose.get(-1) !== 6) throw new CoseError('An EdDSA key must be an OKP key on Ed25519');
    const x = cose.get(-2);
    if (!(x instanceof Uint8Array) || x.length !== 32) throw new CoseError('The Ed25519 key is not 32 bytes');
    jwk = { kty: 'OKP', crv: 'Ed25519', x: b64u(x, 'x') };
  }
  try {
    return { key: createPublicKey({ key: jwk, format: 'jwk' }), alg };
  } catch {
    throw new CoseError('The public key is not valid');
  }
}

/** The key as SubjectPublicKeyInfo (DER, base64), the form it is stored in. */
export const exportSpki = (key: KeyObject) => (key.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');
export const importSpki = (spki: string) => createPublicKey({ key: Buffer.from(spki, 'base64'), format: 'der', type: 'spki' });

/** Verifies a signature made by the authenticator over `data`. False for a bad signature or algorithm. */
export function verifySignature(alg: number, key: KeyObject, data: Buffer, signature: Buffer): boolean {
  try {
    if (alg === ES256) return cryptoVerify('sha256', data, { key, dsaEncoding: 'der' }, signature);
    if (alg === RS256) return cryptoVerify('sha256', data, key, signature);
    if (alg === EDDSA) return cryptoVerify(null, data, key, signature);
    return false;
  } catch {
    return false;
  }
}
