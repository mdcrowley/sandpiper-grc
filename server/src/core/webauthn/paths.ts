// Kept free of imports: core/auth.ts reads this list while it loads.

/**
 * Passkey routes a person who must still enrol may call (added to MFA_ENROLMENT_ROUTES in
 * core/auth.ts): registering a passkey is one way to enrol.
 */
export const WEBAUTHN_ENROLMENT_ROUTES = [
  '/api/auth/webauthn/credentials',
  '/api/auth/webauthn/register/options',
  '/api/auth/webauthn/register',
];
