import type { RouteDoc } from '../module.ts';
import type { OpenApi } from '../openapi.ts';

const A = 'admin.administer';
const SESSION = 'Session only: not callable with a token.';
const CREDENTIAL = '{ id, name, createdAt, lastUsedAt, lastUsedIp, synced, userVerified, transports, algorithm, rpId }';

/** OpenAPI descriptions of the passkey routes (routes.ts). Called from registerApiDocs (core/apidocs.ts). */
export const WEBAUTHN_DOCS: RouteDoc[] = [
  { method: 'GET', path: '/api/auth/webauthn/credentials', summary: 'Your passkeys and security keys', tag: 'Passkeys', description: SESSION,
    response: `{ credentials: [${CREDENTIAL}], rpId, problem, userVerification, passwordless, max }` },
  { method: 'POST', path: '/api/auth/webauthn/register/options', summary: 'Start adding a passkey or security key', tag: 'Passkeys',
    description: `${SESSION} Needs a recent password confirmation (403 \`reauth_required\`). Pass \`publicKey\` to navigator.credentials.create (base64url strings to bytes).`,
    response: '{ publicKey: PublicKeyCredentialCreationOptions, with challenge and ids as base64url }' },
  { method: 'POST', path: '/api/auth/webauthn/register', summary: 'Finish adding a passkey or security key', tag: 'Passkeys',
    body: '{ name, credential: { id, rawId, type, response: { clientDataJSON, attestationObject, transports? } } } (base64url)', response: `{ ok, credential: ${CREDENTIAL}, offerRecoveryCodes }`,
    description: `${SESSION} \`offerRecoveryCodes\` is true for a first passkey with no authenticator app and no recovery codes: offer POST /api/auth/totp/recovery-codes.` },
  { method: 'POST', path: '/api/auth/webauthn/confirm/options', summary: 'Start confirming your identity with a passkey', tag: 'Passkeys',
    description: `${SESSION} Lists your keys at this address. Send the browser's answer as \`webauthn\`, with your password, to POST /api/auth/confirm.`,
    response: '{ publicKey: PublicKeyCredentialRequestOptions, with challenge and ids as base64url }' },
  { method: 'PATCH', path: '/api/auth/webauthn/credentials/:cid', summary: 'Rename one of your keys', tag: 'Passkeys', description: SESSION, body: '{ name }' },
  { method: 'DELETE', path: '/api/auth/webauthn/credentials/:cid', summary: 'Remove one of your keys', tag: 'Passkeys', description: `${SESSION} Needs a recent password confirmation.` },
  { method: 'POST', path: '/api/auth/webauthn/login/options', summary: 'Start a passkey sign-in', tag: 'Passkeys', public: true,
    body: '{} for a passkey alone, or { username, password } for the step after the password (lists that person\'s keys)',
    response: '{ publicKey: PublicKeyCredentialRequestOptions, with challenge and ids as base64url }',
    description: 'With a user name and password, the password is checked as at POST /api/auth/login: wrong ones count toward the account lockout, and a right password for an account with no key at this address answers 401 `invalid_credentials` like a wrong one.' },
  { method: 'POST', path: '/api/auth/webauthn/login', summary: 'Sign in with a passkey alone (user verification required)', tag: 'Passkeys', public: true,
    body: '{ credential: { id, rawId, type, response: { clientDataJSON, authenticatorData, signature, userHandle? } } }',
    description: 'For a key as the second factor after the password, send the same `credential` as `webauthn` to POST /api/auth/login instead.' },
  { method: 'GET', path: '/api/admin/users/:id/passkeys', summary: 'A person\'s passkeys and security keys', tag: 'Passkeys', permission: A, response: `{ credentials: [${CREDENTIAL}] }` },
  { method: 'DELETE', path: '/api/admin/users/:id/passkeys/:cid', summary: 'Remove a person\'s passkey or security key', tag: 'Passkeys', permission: A,
    description: 'Needs a recent password confirmation.' },
];

export function describeWebAuthnRoutes(openapi: Pick<OpenApi, 'describe'>): void {
  for (const doc of WEBAUTHN_DOCS) openapi.describe(doc);
}
