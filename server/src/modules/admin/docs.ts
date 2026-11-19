import type { ModuleContext, RouteDoc } from '../../core/module.ts';

/** Descriptions of this module's routes for the OpenAPI document (`GET /api/openapi.json`). */
type Extra = Omit<RouteDoc, 'method' | 'path' | 'summary'>;
const A = 'admin.administer';
const SESSION = 'Session only: not callable with an API token.';
const CONFIRM = 'Needs a recent password confirmation (403 `reauth_required` otherwise).';

const DOCS: [RouteDoc['method'], string, string, Extra?][] = [
  ['GET', '/api/auth/redeem', 'Check a one-time setup or reset link', { tag: 'Session', public: true, query: { token: 'The token from the link.' }, response: '{ valid, username?, purpose?, minLength }' }],
  ['POST', '/api/auth/redeem', 'Set a password with a one-time link', { tag: 'Session', public: true, body: '{ token, password }' }],
  ['GET', '/api/auth/security', 'Your own account security state', { tag: 'Account security', description: SESSION, response: '{ totpEnabled, passkeys, recoveryCodesLeft, hasPassword, secondFactorViaProvider, mfaEnrollmentRequired, mfaEnrollmentBlocked, mfaGraceEndsAt, passwordChangedAt, minLength }' }],
  ['POST', '/api/auth/totp/begin', 'Start setting up an authenticator app', { tag: 'Account security', description: SESSION, response: '{ secret, uri }' }],
  ['POST', '/api/auth/totp/confirm', 'Finish set-up with a code; returns recovery codes once', { tag: 'Account security', description: SESSION, body: '{ code }', response: '{ ok, recoveryCodes }' }],
  ['POST', '/api/auth/totp/disable', 'Turn the second factor off', { tag: 'Account security', description: SESSION, body: '{ password, code }' }],
  ['POST', '/api/auth/totp/recovery-codes', 'Make new recovery codes (for an authenticator app or for passkeys alone)', { tag: 'Account security', description: `${SESSION} Needs the password; a person without one needs a recent confirmation instead. The old codes stop working.`, body: '{ password }', response: '{ ok, recoveryCodes }' }],
  ['GET', '/api/auth/sessions', 'Your active sessions', { tag: 'Account security', description: SESSION, response: '[{ id, created_at, last_seen_at, expires_at, ip, user_agent, current }]' }],
  ['DELETE', '/api/auth/sessions/:id', 'End one of your sessions', { tag: 'Account security', description: SESSION }],
  ['POST', '/api/auth/sessions/end-others', 'End all your other sessions', { tag: 'Account security', description: SESSION, response: '{ ok, ended }' }],

  // Single sign-on (sso.ts, providers.ts; protocol in core/identity)
  ['GET', '/api/auth/providers', 'Sign-in providers shown on the sign-in page', { tag: 'Session', public: true, response: '{ providers: [{ key, name, isDefault }], localSignIn }' }],
  ['POST', '/api/auth/sso/:key/start', 'Start signing in through a provider', { tag: 'Session', public: true, response: '{ redirectUrl } and a short-lived state cookie' }],
  ['GET', '/api/auth/sso/:key/callback', 'Where the provider sends the browser back', { tag: 'Session', public: true, query: { code: 'Authorization code.', state: 'The state sent at the start.' }, response: '302 redirect into the application' }],
  ['GET', '/api/auth/sso/pending', 'A provider sign-in waiting for the password to link it', { tag: 'Session', public: true, response: '{ pending, provider?, email? (masked) }' }],
  ['POST', '/api/auth/sso/pending/cancel', 'Do not link the waiting provider sign-in', { tag: 'Session', public: true }],
  ['POST', '/api/auth/sso/pending/complete', 'Link the waiting provider sign-in to the account just signed in with its password', { tag: 'Account security', description: SESSION, response: '{ ok, provider }' }],
  ['GET', '/api/auth/identities', 'Your linked sign-in providers and those you can link', { tag: 'Account security', description: SESSION }],
  ['POST', '/api/auth/sso/:key/link', 'Start linking a provider to your account', { tag: 'Account security', description: `${SESSION} ${CONFIRM}`, body: '{ returnTo? }', response: '{ redirectUrl }' }],
  ['POST', '/api/auth/sso/:key/reauth', 'Confirm it is you through a linked provider', { tag: 'Account security', description: SESSION, body: '{ returnTo? }', response: '{ redirectUrl }' }],
  ['DELETE', '/api/auth/identities/:id', 'Unlink one of your providers', { tag: 'Account security', description: `${SESSION} ${CONFIRM} The last way to sign in cannot be unlinked.` }],
  ['POST', '/api/auth/sso/:key/backchannel-logout', 'Back-channel sign-out: the provider ends sessions here (OpenID Connect Back-Channel Logout)', { tag: 'Session', public: true, body: 'logout_token=<signed JWT> (form)', description: 'Answers 404 unless the provider is switched on with back-channel sign-out on. Ends the sessions made through that provider for the subject or provider session named in the token.' }],
  ['GET', '/api/auth/sso/session', 'How this session was made (method, provider, break-glass)', { tag: 'Account security', description: SESSION }],
  ['GET', '/api/admin/identity-providers', 'Sign-in providers, the password switch and the break-glass account', { tag: 'Sign-in providers', permission: A }],
  ['POST', '/api/admin/identity-providers', 'Add a sign-in provider', { tag: 'Sign-in providers', permission: A, description: CONFIRM, body: '{ key, name, type: "oidc", enabled?, isDefault?, secret?, config: { issuer, clientId, ... } }' }],
  ['PATCH', '/api/admin/identity-providers/:id', 'Change a sign-in provider', { tag: 'Sign-in providers', permission: A, description: CONFIRM }],
  ['POST', '/api/admin/identity-providers/:id/test', 'Fetch the provider\'s discovery document and key set now', { tag: 'Sign-in providers', permission: A, response: '{ ok, message, details? }' }],
  ['DELETE', '/api/admin/identity-providers/:id', 'Remove a switched-off provider', { tag: 'Sign-in providers', permission: A, description: CONFIRM }],
  ['GET', '/api/admin/users/:id/sign-in', 'A user\'s linked identities, sign-in limits, link permit and break-glass state', { tag: 'Users', permission: A }],
  ['PATCH', '/api/admin/users/:id/sign-in', 'Limit how a user may sign in', { tag: 'Users', permission: A, description: CONFIRM, body: '{ allowedMethods: null | ["local", providerKey] }' }],
  ['POST', '/api/admin/users/:id/link-permit', 'Let a user link a provider at their next sign-in (7 days)', { tag: 'Users', permission: A, description: CONFIRM, body: '{ providerId }' }],
  ['DELETE', '/api/admin/users/:id/link-permit', 'Withdraw a link permit', { tag: 'Users', permission: A }],
  ['DELETE', '/api/admin/users/:id/identities/:identityId', 'Unlink a user\'s provider', { tag: 'Users', permission: A, description: CONFIRM }],
  ['POST', '/api/admin/users/:id/break-glass', 'Make a user the break-glass account, or remove it', { tag: 'Users', permission: A, description: CONFIRM, body: '{ breakGlass: boolean }' }],

  ['GET', '/api/admin/users', 'List users', { tag: 'Users', permission: A, query: { q: 'Part of a name, username or email.', status: 'pending, active or disabled.', role: 'Role key.' } }],
  ['GET', '/api/admin/users/:id', 'One user', { tag: 'Users', permission: A }],
  ['POST', '/api/admin/users', 'Create a user and a one-time setup link', { tag: 'Users', permission: A, description: CONFIRM, body: '{ username, email, displayName, departmentId?, roles: [roleKey] }' }],
  ['PATCH', '/api/admin/users/:id', 'Change a user\'s profile, roles or status', { tag: 'Users', permission: A, description: 'A change of roles needs a recent password confirmation.', body: '{ username?, email?, displayName?, departmentId?, roles?, status? }' }],
  ['POST', '/api/admin/users/:id/disable', 'Disable a user', { tag: 'Users', permission: A }],
  ['POST', '/api/admin/users/:id/enable', 'Enable a user', { tag: 'Users', permission: A }],
  ['POST', '/api/admin/users/:id/setup-link', 'Issue a new one-time setup link', { tag: 'Users', permission: A, description: CONFIRM, response: '{ token, expiresAt, ... } (shown once)' }],
  ['POST', '/api/admin/users/:id/reset-link', 'Issue a one-time password reset link', { tag: 'Users', permission: A, description: CONFIRM, response: '{ token, expiresAt, ... } (shown once)' }],
  ['POST', '/api/admin/users/:id/unlock', 'Clear a lockout', { tag: 'Users', permission: A }],
  ['POST', '/api/admin/users/:id/end-sessions', 'End all of a user\'s sessions', { tag: 'Users', permission: A }],
  ['POST', '/api/admin/users/:id/reset-mfa', 'Remove a user\'s second factor and recovery codes', { tag: 'Users', permission: A, description: CONFIRM }],

  ['GET', '/api/admin/roles', 'Roles with their grants, and the permission vocabulary', { tag: 'Roles', permission: A }],
  ['GET', '/api/admin/roles/:id', 'One role with its members', { tag: 'Roles', permission: A }],
  ['POST', '/api/admin/roles', 'Create a role', { tag: 'Roles', permission: A, description: CONFIRM, body: '{ name, description?, grants: ["tickets.view", "assets.*"], requiresMfa? }' }],
  ['PATCH', '/api/admin/roles/:id', 'Change a role', { tag: 'Roles', permission: A, description: 'Changing grants, the second-factor flag or whether the role is on needs a recent password confirmation.', body: '{ name?, description?, grants?, requiresMfa?, enabled? }' }],
  ['POST', '/api/admin/roles/:id/enable', 'Switch a role on', { tag: 'Roles', permission: A, description: CONFIRM }],
  ['POST', '/api/admin/roles/:id/disable', 'Switch a role off', { tag: 'Roles', permission: A, description: CONFIRM }],
  ['GET', '/api/admin/roles/default-grants', 'What "sync default grants" would add to each default role', { tag: 'Roles', permission: A }],
  ['POST', '/api/admin/roles/sync-default-grants', 'Add new default grants to the default roles', { tag: 'Roles', permission: A, description: CONFIRM }],

  ['GET', '/api/admin/settings', 'Application settings', { tag: 'Settings', permission: A, response: '{ values: { [key]: value }, featureKeys }' }],
  ['PATCH', '/api/admin/settings', 'Change settings', { tag: 'Settings', permission: A, description: 'Keys beginning `auth.`, `tokens.` or `integrations.` need a recent password confirmation.', body: '{ [key]: value }' }],
  ['GET', '/api/admin/departments', 'Departments with member counts', { tag: 'Settings', permission: A }],
  ['POST', '/api/admin/departments', 'Add a department', { tag: 'Settings', permission: A, body: '{ name }' }],
  ['PATCH', '/api/admin/departments/:id', 'Rename a department', { tag: 'Settings', permission: A, body: '{ name }' }],
  ['DELETE', '/api/admin/departments/:id', 'Remove a department', { tag: 'Settings', permission: A }],
];

export function describeAdminRoutes(ctx: ModuleContext): void {
  for (const [method, path, summary, extra] of DOCS) ctx.describeRoute({ method, path, summary, ...extra });
}
