// ID token (JSON Web Token) checks with Node's own crypto: no extra package.
//
// Accepted signatures: RS256, PS256 (RSA) and ES256 (P-256). Never `none`, never HMAC (HS*): an
// HMAC token would be "signed" with the client secret, which the browser-facing side must not trust.
import { createPublicKey, constants, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import { IdentityError } from './types.ts';

export type JwtAlg = 'RS256' | 'PS256' | 'ES256';
export const SUPPORTED_ALGS: JwtAlg[] = ['RS256', 'ES256', 'PS256'];

export interface Jwk {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  key_ops?: string[];
  n?: string; e?: string;          // RSA
  crv?: string; x?: string; y?: string; // EC
  [k: string]: unknown;
}

export interface ParsedJwt {
  header: { alg?: string; kid?: string; typ?: string; [k: string]: unknown };
  payload: Record<string, any>;
  signingInput: Buffer;
  signature: Buffer;
}

const B64URL = /^[A-Za-z0-9_-]*$/;

function decodePart(part: string, what: string): Buffer {
  if (!B64URL.test(part)) throw new IdentityError(`malformed token (${what})`);
  return Buffer.from(part, 'base64url');
}

/** Splits and decodes a compact JWS. Throws IdentityError when it is not one. */
export function parseJwt(token: string): ParsedJwt {
  if (typeof token !== 'string' || token.length > 16_384) throw new IdentityError('malformed token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new IdentityError('malformed token (not three parts)');
  let header: ParsedJwt['header'];
  let payload: Record<string, any>;
  try {
    header = JSON.parse(decodePart(parts[0], 'header').toString('utf8'));
    payload = JSON.parse(decodePart(parts[1], 'payload').toString('utf8'));
  } catch (err) {
    if (err instanceof IdentityError) throw err;
    throw new IdentityError('malformed token (not JSON)');
  }
  if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new IdentityError('malformed token');
  }
  return {
    header, payload,
    signingInput: Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'),
    signature: decodePart(parts[2], 'signature'),
  };
}

/** Whether a key from the provider's key set may verify a token signed with `alg`. */
function keyFits(jwk: Jwk, alg: JwtAlg): boolean {
  if (jwk.use !== undefined && jwk.use !== 'sig') return false;
  if (Array.isArray(jwk.key_ops) && !jwk.key_ops.includes('verify')) return false;
  if (jwk.alg !== undefined && jwk.alg !== alg) return false;
  if (alg === 'ES256') return jwk.kty === 'EC' && jwk.crv === 'P-256';
  return jwk.kty === 'RSA';
}

/** The keys in a set that could have signed this token: by `kid` when the token names one. */
export function candidateKeys(keys: Jwk[], kid: string | undefined, alg: JwtAlg): Jwk[] {
  return keys.filter((k) => keyFits(k, alg) && (kid === undefined || k.kid === kid));
}

function publicKey(jwk: Jwk): KeyObject {
  // Only the public members: a key set must never carry private parts, and they are not needed.
  const pub: Record<string, unknown> = { kty: jwk.kty };
  for (const m of ['n', 'e', 'crv', 'x', 'y']) if (jwk[m] !== undefined) pub[m] = jwk[m];
  return createPublicKey({ key: pub as any, format: 'jwk' });
}

/** Checks the signature with one key. False when it does not verify (or the key cannot be read). */
export function verifySignature(jwt: ParsedJwt, alg: JwtAlg, jwk: Jwk): boolean {
  let key: KeyObject;
  try {
    key = publicKey(jwk);
  } catch {
    return false;
  }
  try {
    if (alg === 'RS256') return cryptoVerify('sha256', jwt.signingInput, key, jwt.signature);
    if (alg === 'PS256') {
      if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) return false;
      return cryptoVerify('sha256', jwt.signingInput, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, jwt.signature);
    }
    // ES256: a JWS carries r||s (64 bytes), not DER.
    if (jwt.signature.length !== 64) return false;
    return cryptoVerify('sha256', jwt.signingInput, { key, dsaEncoding: 'ieee-p1363' }, jwt.signature);
  } catch {
    return false;
  }
}

export interface ClaimRules {
  issuer: string;
  audience: string;
  nonce: string;
  /** Seconds of clock difference tolerated (default 120). */
  skewSeconds?: number;
  /** The oldest `iat` accepted, in seconds (default 600). */
  maxAgeSeconds?: number;
  nowSeconds?: number;
}

/** Checks the claims of an ID token (OpenID Connect Core 3.1.3.7). Throws IdentityError with the reason. */
export function checkIdTokenClaims(payload: Record<string, any>, rules: ClaimRules): void {
  const now = rules.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = rules.skewSeconds ?? 120;
  const maxAge = rules.maxAgeSeconds ?? 600;
  if (payload.iss !== rules.issuer) throw new IdentityError('wrong issuer');
  const aud = payload.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(rules.audience)) throw new IdentityError('wrong audience');
  // With several audiences the token must say it was issued to us (azp).
  if (audiences.length > 1 && payload.azp !== rules.audience) throw new IdentityError('wrong authorised party');
  if (payload.azp !== undefined && payload.azp !== rules.audience) throw new IdentityError('wrong authorised party');
  if (typeof payload.exp !== 'number') throw new IdentityError('no expiry');
  if (payload.exp <= now - skew) throw new IdentityError('token expired');
  if (typeof payload.iat !== 'number') throw new IdentityError('no issue time');
  if (payload.iat > now + skew) throw new IdentityError('issued in the future');
  if (payload.iat < now - maxAge - skew) throw new IdentityError('token too old');
  if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf > now + skew)) throw new IdentityError('token not yet valid');
  if (typeof payload.nonce !== 'string' || payload.nonce !== rules.nonce) throw new IdentityError('wrong nonce');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255) throw new IdentityError('no subject');
}
