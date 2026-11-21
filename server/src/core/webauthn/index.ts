// Passkeys and security keys (WebAuthn, E02-08) and the second-factor default of new installations
// (E02-17). See docs/security.md and docs/user/16-passkeys-and-security-keys.md.
export { WEBAUTHN_ENROLLMENT_ROUTES } from './paths.ts';
export { passkeyLoginOptions, passkeySecondFactor, registerWebAuthn, userHandle, type WebAuthnDeps } from './routes.ts';
export { hasActivePasskey, revokeAllPasskeys } from './store.ts';
export { applySetupSecondFactor } from './setup-default.ts';
