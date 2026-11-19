// Kept free of imports: core/auth.ts reads this list while it loads.

/**
 * Passkey routes a person who must still enroll may call (added to MFA_ENROLLMENT_ROUTES in
 * core/auth.ts): registering a passkey is one way to enroll.
 */
export const WEBAUTHN_ENROLLMENT_ROUTES = [
  '/api/auth/webauthn/credentials',
  '/api/auth/webauthn/register/options',
  '/api/auth/webauthn/register',
];
