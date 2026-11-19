// The browser side of passkeys and security keys: turns the server's options (base64url strings)
// into what navigator.credentials expects, and the browser's answer back into JSON for the server.
// See server/src/core/webauthn/routes.ts for the other half.

const toBytes = (b64u: string): ArrayBuffer => {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

const toB64u = (buf: ArrayBuffer | ArrayBufferView | null | undefined): string | undefined => {
  if (!buf) return undefined;
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

interface JsonDescriptor { type: 'public-key'; id: string; transports?: string[] }

/** True when this browser can use passkeys at all (it may still refuse at an IP address). */
export const passkeysSupported = (): boolean =>
  typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && Boolean(navigator.credentials?.create);

const descriptors = (list: JsonDescriptor[] | undefined): PublicKeyCredentialDescriptor[] =>
  (list ?? []).map((d) => ({ type: 'public-key', id: toBytes(d.id), transports: d.transports as AuthenticatorTransport[] | undefined }));

/** Runs the registration ceremony with options from POST /api/auth/webauthn/register/options. */
export async function createPasskey(options: any): Promise<unknown> {
  const o = options.publicKey;
  const cred = (await navigator.credentials.create({
    publicKey: {
      ...o,
      challenge: toBytes(o.challenge),
      user: { ...o.user, id: toBytes(o.user.id) },
      excludeCredentials: descriptors(o.excludeCredentials),
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new DOMException('No key was created.', 'NotAllowedError');
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id, rawId: toB64u(cred.rawId), type: cred.type,
    response: {
      clientDataJSON: toB64u(r.clientDataJSON),
      attestationObject: toB64u(r.attestationObject),
      transports: typeof r.getTransports === 'function' ? r.getTransports() : [],
    },
  };
}

/** Runs the sign-in ceremony with options from POST /api/auth/webauthn/login/options. */
export async function getAssertion(options: any): Promise<unknown> {
  const o = options.publicKey;
  const cred = (await navigator.credentials.get({
    publicKey: { ...o, challenge: toBytes(o.challenge), allowCredentials: descriptors(o.allowCredentials) },
  })) as PublicKeyCredential | null;
  if (!cred) throw new DOMException('No key answered.', 'NotAllowedError');
  const r = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id, rawId: toB64u(cred.rawId), type: cred.type,
    response: {
      clientDataJSON: toB64u(r.clientDataJSON),
      authenticatorData: toB64u(r.authenticatorData),
      signature: toB64u(r.signature),
      userHandle: toB64u(r.userHandle),
    },
  };
}

/** A plain-English message for an error from navigator.credentials, or null when it is not one of its errors. */
export function browserKeyError(err: unknown): string | null {
  if (!(err instanceof DOMException)) return null;
  switch (err.name) {
    case 'NotAllowedError':
    case 'AbortError':
      return 'Nothing happened: the request was cancelled or timed out. Try again when you are ready to use your key.';
    case 'InvalidStateError':
      return 'That key is already registered to your account.';
    case 'SecurityError':
      return 'This address cannot use passkeys. Open the application by its host name (for example http://localhost rather than 127.0.0.1).';
    case 'NotSupportedError':
      return 'This browser or key does not support the kinds of keys accepted here.';
    default:
      return `The browser could not use the key (${err.name}).`;
  }
}
