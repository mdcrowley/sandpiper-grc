import { createHash } from 'node:crypto';
import { CborError, decodeCbor, decodeCborItem, type CborValue } from './cbor.ts';
import { coseToPublicKey, CoseError, exportSpki, importSpki, verifySignature } from './cose.ts';

/**
 * The checks of the two WebAuthn ceremonies (W3C Web Authentication, level 2, sections 7.1 and 7.2),
 * free of the database and of HTTP so they can be tested on their own. The caller has already found
 * and used up the challenge the client data names (store.ts), and looks up the stored credential.
 */

export class WebAuthnError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest();

export function fromB64u(value: unknown, what: string): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(value) || value.length === 0 || value.length > 100_000) {
    throw new WebAuthnError('malformed', `The ${what} is missing or not base64url.`);
  }
  return Buffer.from(value, 'base64url');
}

// ---------- client data ----------

export interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin: boolean;
  raw: Buffer;
}

export function readClientData(b64: unknown): ClientData {
  const raw = fromB64u(b64, 'client data');
  let parsed: any;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new WebAuthnError('malformed', 'The client data is not JSON.');
  }
  if (!parsed || typeof parsed.type !== 'string' || typeof parsed.challenge !== 'string' || typeof parsed.origin !== 'string') {
    throw new WebAuthnError('malformed', 'The client data is incomplete.');
  }
  return { type: parsed.type, challenge: parsed.challenge, origin: parsed.origin, crossOrigin: parsed.crossOrigin === true, raw };
}

function checkClientData(cd: ClientData, type: 'webauthn.create' | 'webauthn.get', origins: string[]) {
  if (cd.type !== type) throw new WebAuthnError('wrong_type', 'The browser answered a different kind of request.');
  if (!origins.includes(cd.origin)) throw new WebAuthnError('wrong_origin', `The request came from ${cd.origin.slice(0, 100)}, which is not this application's address.`);
  if (cd.crossOrigin) throw new WebAuthnError('wrong_origin', 'Requests from inside another site are not accepted.');
}

// ---------- authenticator data ----------

export interface AuthData {
  rpIdHash: Buffer;
  up: boolean; // user present
  uv: boolean; // user verified (PIN, fingerprint, face)
  be: boolean; // backup eligible (a synced passkey)
  bs: boolean; // backed up
  signCount: number;
  attested?: { aaguid: string; credentialId: Buffer; publicKey: CborValue };
}

export function parseAuthData(buf: Buffer): AuthData {
  if (buf.length < 37) throw new WebAuthnError('malformed', 'The authenticator data is too short.');
  const flags = buf[32];
  const out: AuthData = {
    rpIdHash: buf.subarray(0, 32),
    up: Boolean(flags & 0x01),
    uv: Boolean(flags & 0x04),
    be: Boolean(flags & 0x08),
    bs: Boolean(flags & 0x10),
    signCount: buf.readUInt32BE(33),
  };
  let pos = 37;
  try {
    if (flags & 0x40) {
      if (buf.length < pos + 18) throw new WebAuthnError('malformed', 'The attested credential data is too short.');
      const aaguid = buf.subarray(pos, pos + 16).toString('hex');
      const idLen = buf.readUInt16BE(pos + 16);
      pos += 18;
      if (idLen === 0 || idLen > 1023 || buf.length < pos + idLen) throw new WebAuthnError('malformed', 'The credential ID is not valid.');
      const credentialId = Buffer.from(buf.subarray(pos, pos + idLen));
      pos += idLen;
      const key = decodeCborItem(buf, pos);
      pos = key.offset;
      out.attested = { aaguid, credentialId, publicKey: key.value };
    }
    if (flags & 0x80) pos = decodeCborItem(buf, pos).offset; // extensions: read past, not used
  } catch (err) {
    if (err instanceof CborError) throw new WebAuthnError('malformed', 'The authenticator data could not be read.');
    throw err;
  }
  if (pos !== buf.length) throw new WebAuthnError('malformed', 'The authenticator data has unexpected bytes at the end.');
  return out;
}

function checkRp(auth: AuthData, rpId: string) {
  if (!auth.rpIdHash.equals(sha256(rpId))) {
    throw new WebAuthnError('wrong_rp', 'The key was used for a different site than this one.');
  }
  if (!auth.up) throw new WebAuthnError('no_presence', 'The key did not confirm that someone was present.');
}

// ---------- registration ----------

export interface RegistrationInput {
  clientData: ClientData;
  attestationObject: unknown; // base64url
  rpId: string;
  origins: string[];
  requireUserVerification: boolean;
}

export interface NewCredential {
  credentialId: string; // base64url
  publicKey: string; // SPKI DER, base64
  alg: number;
  signCount: number;
  aaguid: string;
  attestationFormat: string;
  userVerified: boolean;
  backupEligible: boolean;
}

/**
 * Attestation: the statement is NOT verified, whatever its format. Options ask for "none", which
 * browsers honour by replacing any statement with format "none". Checking a statement would need the
 * makers' root certificates (an outside metadata service, which the application does not reach) and
 * would only tell us the make of the key; it says nothing about who holds it. The security of the
 * ceremony rests on the challenge, origin, RP ID and the signatures at every later sign-in.
 */
export function verifyRegistration(input: RegistrationInput): NewCredential {
  checkClientData(input.clientData, 'webauthn.create', input.origins);
  let att: CborValue;
  try {
    att = decodeCbor(fromB64u(input.attestationObject, 'attestation object'));
  } catch (err) {
    if (err instanceof WebAuthnError) throw err;
    throw new WebAuthnError('malformed', 'The attestation object could not be read.');
  }
  if (!(att instanceof Map)) throw new WebAuthnError('malformed', 'The attestation object is not a map.');
  const fmt = att.get('fmt');
  const authDataRaw = att.get('authData');
  if (typeof fmt !== 'string' || !(authDataRaw instanceof Uint8Array)) throw new WebAuthnError('malformed', 'The attestation object is incomplete.');
  const auth = parseAuthData(Buffer.from(authDataRaw));
  checkRp(auth, input.rpId);
  if (input.requireUserVerification && !auth.uv) {
    throw new WebAuthnError('no_verification', 'The key did not check your PIN, fingerprint or face, which is required here.');
  }
  if (!auth.attested) throw new WebAuthnError('malformed', 'The key did not send its public key.');
  let parsed;
  try {
    parsed = coseToPublicKey(auth.attested.publicKey);
  } catch (err) {
    if (err instanceof CoseError) throw new WebAuthnError('unsupported_key', `${err.message}.`);
    throw err;
  }
  return {
    credentialId: auth.attested.credentialId.toString('base64url'),
    publicKey: exportSpki(parsed.key),
    alg: parsed.alg,
    signCount: auth.signCount,
    aaguid: auth.attested.aaguid,
    attestationFormat: fmt.slice(0, 40),
    userVerified: auth.uv,
    backupEligible: auth.be,
  };
}

// ---------- authentication (assertion) ----------

export interface StoredCredential {
  publicKey: string;
  alg: number;
  signCount: number;
  rpId: string;
}

export interface AssertionInput {
  clientData: ClientData;
  authenticatorData: unknown; // base64url
  signature: unknown; // base64url
  credential: StoredCredential;
  rpId: string;
  origins: string[];
  requireUserVerification: boolean;
}

/** Checks an assertion against the stored credential. Returns the new signature counter. */
export function verifyAssertion(input: AssertionInput): { signCount: number; userVerified: boolean } {
  checkClientData(input.clientData, 'webauthn.get', input.origins);
  if (input.credential.rpId !== input.rpId) throw new WebAuthnError('wrong_rp', 'This key was registered for a different site address.');
  const authRaw = fromB64u(input.authenticatorData, 'authenticator data');
  const auth = parseAuthData(authRaw);
  checkRp(auth, input.rpId);
  if (input.requireUserVerification && !auth.uv) {
    throw new WebAuthnError('no_verification', 'The key did not check your PIN, fingerprint or face, which is required here.');
  }
  const signed = Buffer.concat([authRaw, sha256(input.clientData.raw)]);
  const ok = verifySignature(input.credential.alg, importSpki(input.credential.publicKey), signed, fromB64u(input.signature, 'signature'));
  if (!ok) throw new WebAuthnError('bad_signature', 'The key\'s signature did not check out.');
  // A counter that does not go up suggests a copied key. Both zero means the key keeps no counter
  // (synced passkeys usually do not), which is allowed.
  const stored = Number(input.credential.signCount) || 0;
  if ((auth.signCount !== 0 || stored !== 0) && auth.signCount <= stored) {
    throw new WebAuthnError('sign_count', 'The key\'s use counter went backwards, which can mean it was copied. It has been refused.');
  }
  return { signCount: auth.signCount, userVerified: auth.uv };
}
