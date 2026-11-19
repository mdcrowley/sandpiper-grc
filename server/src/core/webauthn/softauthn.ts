import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { encodeCbor, type CborValue } from './cbor.ts';
import { EDDSA, ES256, RS256 } from './cose.ts';

/**
 * A software authenticator for tests: it makes key pairs and answers registration and sign-in
 * requests the way a browser and a passkey would, so the server's checks can be exercised without
 * a browser. Never used by the application itself.
 */

interface SoftCredential {
  id: Buffer;
  privateKey: KeyObject;
  alg: number;
  signCount: number;
  rpId: string;
  userHandle: string;
}

export interface SoftOptions {
  origin: string;
  /** Algorithm of new keys (default ES256). */
  alg?: number;
  /** Whether the authenticator reports user verification (PIN or biometric). Default true. */
  userVerified?: boolean;
  /** Counter step per use; 0 makes a key without a counter (like most synced passkeys). Default 1. */
  counterStep?: number;
}

const sha256 = (d: Buffer | string) => createHash('sha256').update(d).digest();
const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');

function coseKey(publicKey: KeyObject, alg: number): Map<CborValue, CborValue> {
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, string>;
  const bytes = (v: string) => Uint8Array.from(Buffer.from(v, 'base64url'));
  if (alg === ES256) return new Map<CborValue, CborValue>([[1, 2], [3, ES256], [-1, 1], [-2, bytes(jwk.x)], [-3, bytes(jwk.y)]]);
  if (alg === RS256) return new Map<CborValue, CborValue>([[1, 3], [3, RS256], [-1, bytes(jwk.n)], [-2, bytes(jwk.e)]]);
  return new Map<CborValue, CborValue>([[1, 1], [3, EDDSA], [-1, 6], [-2, bytes(jwk.x)]]);
}

function newKeyPair(alg: number) {
  if (alg === ES256) return generateKeyPairSync('ec', { namedCurve: 'P-256' });
  if (alg === RS256) return generateKeyPairSync('rsa', { modulusLength: 2048 });
  return generateKeyPairSync('ed25519');
}

function signWith(alg: number, key: KeyObject, data: Buffer): Buffer {
  if (alg === ES256) return sign('sha256', data, { key, dsaEncoding: 'der' });
  if (alg === RS256) return sign('sha256', data, key);
  return sign(null, data, key);
}

function authData(rpId: string, flags: { up?: boolean; uv?: boolean; be?: boolean; at?: boolean }, signCount: number, attested?: Buffer): Buffer {
  const head = Buffer.alloc(37);
  sha256(rpId).copy(head, 0);
  head[32] = (flags.up === false ? 0 : 0x01) | (flags.uv ? 0x04 : 0) | (flags.be ? 0x08 : 0) | (flags.at ? 0x40 : 0);
  head.writeUInt32BE(signCount >>> 0, 33);
  return attested ? Buffer.concat([head, attested]) : head;
}

export class SoftAuthenticator {
  readonly credentials: SoftCredential[] = [];
  constructor(public opts: SoftOptions) {}

  /** Answers `publicKey` registration options. `override` lets a test send a wrong origin or RP ID. */
  create(publicKey: any, override: { origin?: string; rpId?: string; userVerified?: boolean; challenge?: string } = {}) {
    const alg = this.opts.alg ?? ES256;
    if (!publicKey.pubKeyCredParams.some((p: { alg: number }) => p.alg === alg)) throw new Error('algorithm not offered');
    const { publicKey: pub, privateKey } = newKeyPair(alg);
    const id = randomBytes(32);
    const rpId = override.rpId ?? publicKey.rp.id;
    const cred: SoftCredential = { id, privateKey, alg, signCount: 0, rpId, userHandle: publicKey.user.id };
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(id.length);
    const attested = Buffer.concat([Buffer.alloc(16), idLen, id, encodeCbor(coseKey(pub, alg))]);
    const uv = override.userVerified ?? this.opts.userVerified ?? true;
    const data = authData(rpId, { uv, at: true, be: (this.opts.counterStep ?? 1) === 0 }, 0, attested);
    const clientDataJSON = Buffer.from(JSON.stringify({
      type: 'webauthn.create', challenge: override.challenge ?? publicKey.challenge, origin: override.origin ?? this.opts.origin, crossOrigin: false,
    }));
    const attestationObject = encodeCbor(new Map<CborValue, CborValue>([['fmt', 'none'], ['attStmt', new Map()], ['authData', Uint8Array.from(data)]]));
    this.credentials.push(cred);
    return {
      id: b64u(id), rawId: b64u(id), type: 'public-key',
      response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal'] },
    };
  }

  /**
   * Answers `publicKey` sign-in options with the first matching credential (or `credentialId`).
   * `signCount` forces the counter (to test a regression); `origin` and `rpId` forge the request.
   */
  get(publicKey: any, override: { origin?: string; rpId?: string; credentialId?: string; signCount?: number; userVerified?: boolean; challenge?: string } = {}) {
    const allowed: string[] = (publicKey.allowCredentials ?? []).map((c: { id: string }) => c.id);
    const cred = override.credentialId
      ? this.credentials.find((c) => b64u(c.id) === override.credentialId)
      : this.credentials.find((c) => c.rpId === publicKey.rpId && (!allowed.length || allowed.includes(b64u(c.id))));
    if (!cred) throw new Error('no matching credential');
    cred.signCount = override.signCount ?? cred.signCount + (this.opts.counterStep ?? 1);
    const data = authData(override.rpId ?? cred.rpId, { uv: override.userVerified ?? this.opts.userVerified ?? true }, cred.signCount);
    const clientDataJSON = Buffer.from(JSON.stringify({
      type: 'webauthn.get', challenge: override.challenge ?? publicKey.challenge, origin: override.origin ?? this.opts.origin, crossOrigin: false,
    }));
    const signature = signWith(cred.alg, cred.privateKey, Buffer.concat([data, sha256(clientDataJSON)]));
    return {
      id: b64u(cred.id), rawId: b64u(cred.id), type: 'public-key',
      response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(data), signature: b64u(signature), userHandle: cred.userHandle },
    };
  }
}
