# E02 Account security

**Status:** in progress

## Goal

Make sign-in strong enough for a system that holds risk and incident records: a second
factor that is enforced, phishing-resistant options, single sign-on with the
organisation's identity provider, tokens for automation, and a safe way back in when
everything else fails.

## Scope notes

- Passwords, lockout and sessions are in [E01](E01-platform-foundations.md).
- The second factor (authenticator app and recovery codes) can be enforced, but ships as
  a notice only (`auth.mfa_enforcement` = `notice`) so an upgrade locks nobody out.
- Single sign-on (OpenID Connect) needs outbound access to the identity provider. It is off
  until an administrator switches a provider on; the application works without it. Running it
  for real also needs HTTPS on a real host name ([E16](E16-hosting-operations-and-hardening.md)).

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E02-01 | Second factor with an authenticator app | done | P1 |
| E02-02 | Recovery codes | done | P1 |
| E02-03 | Administrator reset of a second factor | done | P1 |
| E02-04 | "Second factor expected" flag and notice | done | P1 |
| E02-05 | Enforce the second factor | done | P1 |
| E02-06 | Replay protection for authenticator codes | done | P1 |
| E02-07 | Encrypt second-factor secrets at rest | done | P1 |
| E02-08 | Passkeys and security keys (WebAuthn) | in progress | P3 |
| E02-09 | Single sign-on with OpenID Connect | done | P2 |
| E02-10 | Single sign-on with SAML | blocked | P3 |
| E02-11 | Link local accounts to single sign-on identities | done | P3 |
| E02-12 | Personal API tokens | in progress | P2 |
| E02-13 | Break-glass account | in progress | P2 |
| E02-14 | Secure session cookie when served over HTTPS | done | P1 |
| E02-15 | Send a blocked person straight to second-factor set-up | done | P1 |
| E02-16 | Keep the secret key out of the data folder by default | in progress | P2 |
| E02-17 | Enforce the second factor by default on new installations | in progress | P2 |
| E02-18 | Limit a token to source addresses | open | P3 |
| E02-19 | Second factor required when setup names no choice | open | P2 |
| E02-20 | Re-encrypt webhook secrets after a key change | open | P2 |
| E02-21 | A way back in for people whose only factor is a passkey | open | P3 |
| E02-22 | Trust the provider's own second factor | open | P2 |
| E02-23 | Sign out at the provider too | open | P3 |
| E02-24 | Groups by reference (group overage) | open | P3 |
| E02-25 | Break-glass banner on every page | open | P2 |
| E02-26 | Directory (LDAP) sign-in | open | P3 |

---

### E02-01 Second factor with an authenticator app

**Status:** done · **Priority:** P1 · **Type:** feature

As a user, I can add a second factor to my account using any authenticator app, and
from then on sign-in asks for a 6-digit code as well as my password.

**Acceptance criteria**

- [x] Set-up shows a key and a link for the authenticator app
- [x] The factor is only switched on after a correct code proves the app has the key
- [x] Sign-in asks for the code once the factor is on
- [x] Turning it off needs the password and a valid code
- [x] Wrong codes are rate-limited per user and audited

**Implemented in:** `server/src/core/totp.ts`; `/api/auth/totp/begin`, `/confirm`, `/disable`, `GET /api/auth/security` (`server/src/modules/admin/account.ts`); `web/src/modules/admin/AccountSecurity.tsx`

### E02-02 Recovery codes

**Status:** done · **Priority:** P1 · **Type:** feature

As a user who has lost my phone, I can sign in with one of the single-use recovery
codes I was given when I set up my second factor.

**Acceptance criteria**

- [x] Ten codes are shown once at set-up; only hashes are stored
- [x] Each code works once, in place of the authenticator code
- [x] Using a code is audited with the number left
- [x] New codes can be generated with the password; the old ones stop working

**Implemented in:** `consumeRecoveryCode` (`server/src/core/auth.ts`); `POST /api/auth/totp/recovery-codes` (`server/src/modules/admin/account.ts`); `web/src/modules/admin/Redeem.tsx` (recovery sign-in page)

### E02-03 Administrator reset of a second factor

**Status:** done · **Priority:** P1 · **Type:** feature

As an administrator, I can clear a person's second factor when they have lost both
their device and their recovery codes, so they can set it up again.

**Acceptance criteria**

- [x] Reset removes the key and the recovery codes
- [x] The reset is audited against the user
- [x] Only administrators can do it

**Implemented in:** `POST /api/admin/users/:id/reset-mfa` (`server/src/modules/admin/users.ts`); `web/src/modules/admin/UserDetail.tsx`

### E02-04 "Second factor expected" flag and notice

**Status:** done · **Priority:** P1 · **Type:** feature

As an administrator, I can say that a role, or everyone, is expected to use a second
factor. People who have not set one up see a notice until they do.

**Acceptance criteria**

- [x] Each role has a "requires second factor" flag
- [x] A site-wide setting expects it of everyone
- [x] The application state reports when the signed-in user still needs to enrol
- [x] The shell shows a notice linking to account security

**Implemented in:** `mfaEnrollmentRequired` (`server/src/core/auth.ts`); `auth.mfa_required_for_all` (`server/src/modules/admin/settings.ts`); `web/src/core/Shell.tsx`

### E02-05 Enforce the second factor

**Status:** done · **Priority:** P1 · **Type:** improvement

As an administrator, when I require a second factor I want it enforced: a person who
has not enrolled can do nothing except enrol.

Setting `auth.mfa_enforcement`: `off`, `notice` (default) or `required`. With `required`,
a person expected to have a second factor (their role says so, or
`auth.mfa_required_for_all` is on) who has none can call only: their own state, the
account security routes (begin and confirm set-up, change password, list own sessions,
confirm password) and sign-out. Everything else answers `403 mfa_enrolment_required`.

**Acceptance criteria**

- [x] A user for whom the factor is required and missing is limited to the enrolment routes
- [ ] The web app sends them to enrolment after sign-in (the Account security page shows the reason, but the shell does not redirect: E02-15)
- [x] A grace period is configurable (`auth.mfa_grace_days`, default none)
- [x] The Administrator and Security lead roles are the ones enforced when the setting is `required` (they carry the "requires second factor" flag by default). The setting itself defaults to `notice`, by decision, so existing installations keep working; see E02-17
- [x] An administrator cannot switch to `required` before setting up their own second factor
- [x] Tests cover blocked and allowed requests

**Implemented in:** `mfaEnforcement`, `mfaStatus`, `MFA_ENROLMENT_ROUTES` and the request hook (`server/src/core/auth.ts`); `auth.mfa_enforcement`, `auth.mfa_grace_days` (`server/src/modules/admin/settings.ts`); `users.mfa_required_since` (`server/src/core/migrations/002_hardening.sql`); `web/src/modules/admin/Settings.tsx`, `AccountSecurity.tsx`; tests "enforced second factor" in `server/src/modules/admin/admin.test.ts`

### E02-06 Replay protection for authenticator codes

**Status:** done · **Priority:** P1 · **Type:** bug

As a security lead, I want a 6-digit code to work once only.

**Acceptance criteria**

- [x] The last accepted time step is stored per user (`users.totp_last_step`)
- [x] A code from that step or earlier is refused, at sign-in, at enrolment and when turning the factor off
- [x] A test proves a code cannot be used twice

**Implemented in:** `matchTotpStep` (`server/src/core/totp.ts`); `acceptTotpCode` (`server/src/core/auth.ts`); tests in `server/src/core/core.test.ts` and "replay protection" in `server/src/modules/admin/admin.test.ts`

### E02-07 Encrypt second-factor secrets at rest

**Status:** done · **Priority:** P1 · **Type:** debt

As a security lead, I want authenticator keys encrypted in the database with a key held
outside it, so a copy of the database or a backup does not reveal them.

AES-256-GCM, stored as `enc:v1:<iv>:<tag>:<ciphertext>` and bound to the user. The key
comes from `GRC_SECRET_KEY`, else the file named by `GRC_SECRET_KEY_FILE`, else
`secret.key` generated in the data folder on first start.

**Acceptance criteria**

- [x] Keys are encrypted with an application key supplied by configuration (or generated on first start)
- [x] Existing keys are migrated on start-up, audited
- [x] Key rotation is documented and works (`GRC_SECRET_KEY_PREVIOUS`; re-encrypted at start-up) in [Security](../../security.md)
- [x] Key backup is documented
- [x] Backups contain no usable authenticator keys: the default key file is now kept beside the data folder, not in it, so `backup` does not copy it (E02-16). A `GRC_SECRET_KEY_FILE` pointed inside the data folder is warned about at start-up

**Implemented in:** `server/src/core/secretbox.ts`; `secretBox`, `storeTotpSecret`, `readTotpSecret`, `encryptStoredSecrets` (`server/src/core/auth.ts`); `Db.dataDir` (`server/src/core/db.ts`); tests in `server/src/core/core.test.ts`

### E02-08 Passkeys and security keys (WebAuthn)

**Status:** in progress · **Priority:** P3 · **Type:** feature

As a user, I can register a passkey or a hardware security key as my second factor, or
as my only factor, so sign-in resists phishing.

WebAuthn ceremonies implemented with Node's crypto and a small CBOR/COSE reader of our own
(no new packages): ES256, EdDSA and RS256 keys; one-use challenges that expire after five
minutes; origin and RP ID checked (`GRC_WEBAUTHN_ORIGINS`, `GRC_WEBAUTHN_RP_ID`, default the
host the request was sent to); a use counter that goes backwards is refused and audited as a
possible copied key; attestation is not verified (format "none" is asked for; see
[Security](../../security.md)). A passkey counts as a second factor for enforcement. Signing in
with a passkey alone needs user verification (PIN or biometric); as the second factor after the
password, a touch-only security key is enough unless `auth.passkey_user_verification` is
`required`.

**Acceptance criteria**

- [x] Register, name, rename and remove more than one key (up to ten), with when each was last used and from where
- [x] Sign in with a key in place of an authenticator code, or with a passkey alone (`auth.passkey_sign_in`, default on)
- [x] Wrong origin, wrong RP ID, replayed or foreign challenge, counter regression and removed keys are refused, with tests using a software authenticator
- [x] Checked in a real browser (headless Edge with a virtual authenticator, `VIRTUAL_AUTHENTICATOR=1` in `tools/browse.mjs`): adding a passkey, signing in with it alone, and as the second factor after the password
- [ ] Works once the application is served over HTTPS on a real host name (configuration exists; not tried on a real host, depends on E16-07)
- [x] All key events are audited (`passkey.register`, `.rename`, `.revoke`, `.used`, `.refused`, `.register_refused`, `.sign_count_regression`; `signin.success` "via passkey")
- [ ] The card is on the Account security page and on an administrator's user page, and the sign-in page offers **Sign in with a passkey** and **Use a passkey or security key instead** (components are ready in `web/src/modules/account-keys`; the embeds belong to the administration and sign-in screens)
- [ ] An administrator's second-factor reset also removes the person's passkeys (`revokeAllPasskeys`), and the "set up your own second factor first" check on `auth.mfa_enforcement` counts a passkey

**Implemented in:** `server/src/core/webauthn/` (`cbor.ts`, `cose.ts`, `ceremony.ts`, `config.ts`, `store.ts`, `routes.ts`, `apidocs.ts`, `softauthn.ts` test authenticator, `webauthn.test.ts`); hooks in `server/src/core/auth.ts` (`registerWebAuthn`, `passkeySecondFactor`, `hasActivePasskey`, `WEBAUTHN_ENROLMENT_ROUTES`); `server/src/core/migrations/004_webauthn.sql`; web `web/src/modules/account-keys/` (`PasskeysCard`, `PasskeySignIn`, `PasskeySecondFactorButton`, pages `/account/passkeys` and `/sign-in/passkey`); `tools/browse.mjs` (`VIRTUAL_AUTHENTICATOR=1`); [user guide](../../user/16-passkeys-and-security-keys.md)

### E02-09 Single sign-on with OpenID Connect

**Status:** done · **Priority:** P2 · **Type:** feature

As a user, I sign in with my organisation account. As an administrator, I configure the
identity provider in settings and map its groups to roles.

**Acceptance criteria**

- [x] Provider details are entered in settings, not in code (Administration > Sign-in providers; issuer and every endpoint from the discovery document, so commercial, government-cloud and self-hosted providers are configured alike)
- [x] Authorisation-code flow with proof key (PKCE S256), `state` bound to the browser and single-use, `nonce`
- [x] ID token signature (RS256, ES256, PS256) and claims (iss, aud/azp, exp, iat, nbf, nonce) checked with Node's crypto; key set cached, refetched on an unknown key id (rotation)
- [x] Client secret stored encrypted with the application key
- [x] Groups or claims map to roles (off by default); just-in-time accounts for allowed email domains (off by default)
- [x] Several providers side by side, each switched on or off, one default; the sign-in page shows only enabled ones; no self-registration
- [x] Nothing is fetched from a provider until it is switched on, except **Test connection** when an administrator asks
- [x] Local sign-in can be limited to named accounts once single sign-on is on: per-person "ways to sign in", and `auth.local_signin` off (allowed only with a break-glass account and everyone else linked)
- [x] Sign-in events record which method was used, with failures' reasons, provider changes, links and unlinks, time and source address
- [x] Tests against an in-process stand-in provider (`fake-provider.ts`): happy path, bad signature, wrong audience, expiry, wrong issuer, replayed state, wrong nonce, unknown email, JIT off/on, mapping, ES256/PS256, key rotation
- [x] Checked in a browser: signing in through the stand-in provider, the provider screens, user page and Account security (light and dark, 1440 and 820)

**Implemented in:** `server/src/core/identity/` (`types.ts` driver interface, `jwt.ts`, `oidc.ts`, `http.ts`, `config.ts`, `accounts.ts`, `service.ts`, `hooks.ts`, `fake-provider.ts`, `jwt.test.ts`); `checkSignIn`/`afterSignIn` in `server/src/core/auth.ts`; `server/src/modules/admin/sso.ts`, `providers.ts`, `migrations/001_identity.sql`, settings `auth.local_signin` and `auth.public_url` (`settings.ts`), `sso.test.ts`; web `web/src/core/AuthPages.tsx` (provider buttons), `web/src/modules/admin/Providers.tsx`, `ProviderEditor.tsx`, `UserSignIn.tsx`, `LinkedIdentities.tsx`; [user guide](../../user/09-administration.md#sign-in-providers-single-sign-on), [Security](../../security.md)

### E02-10 Single sign-on with SAML

**Status:** blocked · **Priority:** P3 · **Type:** feature

As an administrator whose identity provider only offers SAML, I can connect it in the
same way as OpenID Connect.

**Why it is not built.** Verifying a SAML response safely needs a complete XML Signature
implementation: a hardened XML parser (no DTDs or external entities), Exclusive XML
Canonicalisation 1.0 (with and without comments, in-scope namespaces), resolving each
`Reference` by ID and applying only the enveloped-signature and exc-c14n transforms, digest
and signature checks against the configured certificate only (never a `KeyInfo` key), and
defences against signature wrapping (the signed element must be exactly the assertion that is
then read; one assertion; IDs unique). Node has no XML parser or canonicaliser, and writing
one here would be the riskiest code in the application. It needs either an approved, maintained
XML-signature package, or a decision to support SAML only through an OpenID Connect bridge
(many identity providers offer both).

**When unblocked:** a `saml` driver in `server/src/core/identity/` with `style: 'redirect'`:
`start` builds the AuthnRequest (HTTP-Redirect binding), the callback (POST binding, which needs
a `SameSite=None` state cookie or a relay-state store) calls `complete`, which returns the same
`ExternalIdentity` (NameID, email attribute, groups attribute); linking, mapping, just-in-time
accounts, break-glass and audit then work unchanged. Also: service-provider metadata at
`/api/auth/sso/:key/metadata`, `InResponseTo`, `NotOnOrAfter`, `Audience` and `Recipient` checks,
and replay protection by assertion ID.

**Acceptance criteria**

- [ ] Service-provider metadata is published and identity-provider metadata imported
- [ ] Signed assertions are verified; unsigned ones are refused
- [ ] Attributes map to roles

### E02-11 Link local accounts to single sign-on identities

**Status:** done · **Priority:** P3 · **Type:** feature

As a user who already has a local account, my first single sign-on visit links to it
rather than creating a duplicate.

**Acceptance criteria**

- [x] Matching is on a verified email address and needs one confirmation: the account's password at the sign-in page ("Link your sign-in"), or from Account security after a recent confirmation, with the provider's email equal to the account's
- [x] An administrator can link (by allowing a link at the next sign-in, 7 days) and unlink identities by hand
- [x] Links are shown on the user page and Account security, and audited; unlinking needs re-authentication and never removes the last way in; history, roles and audit are kept
- [x] A person without a password can confirm through a linked provider (`/api/auth/sso/:key/reauth`) for actions that need a recent confirmation

**Implemented in:** `server/src/core/identity/accounts.ts`; `server/src/modules/admin/sso.ts`, `providers.ts`; `web/src/modules/admin/LinkedIdentities.tsx`, `UserSignIn.tsx`, `web/src/core/AuthPages.tsx`; tests in `server/src/modules/admin/sso.test.ts`

### E02-12 Personal API tokens

**Status:** done · **Priority:** P2 · **Type:** feature

As a user who automates work, I can create a named token with an expiry and limited
permissions, and use it instead of a browser session.

**Acceptance criteria**

- [x] Tokens are shown once and stored as hashes (SHA-256; `grc_pat_` prefix)
- [x] Each token has a required expiry (at most `tokens.max_days`, default 365) and a
  subset of the owner's permissions, re-checked against the owner's grants on every request
- [x] Tokens can be listed (with last use and address) and revoked by the owner and by an
  administrator
- [x] Requests made with a token are audited as such (`token_name` on every event,
  `token.use` for each change, `token.refused` for bad tokens)
- [x] The asset ingest route accepts a token (see [E13](E13-imports-api-integrations.md))
- [x] `Authorization: Bearer` needs no CSRF header and ignores the cookie; tokens are
  refused on sign-in, account-security and token-management routes and cannot confirm a
  password
- [x] Rate-limited per token (`tokens.rate_per_minute`) and per address for wrong tokens
- [x] **API tokens** section on the Account security page (create with scopes and expiry,
  show once, list, revoke) and an administrator list of everyone's tokens (web)

**Implemented in:** web: `web/src/modules/admin/ApiTokens.tsx` (`MyTokensCard` on
`AccountSecurity.tsx`, `AdminTokensPage` at `/admin/tokens`), the **API tokens** group in
`web/src/modules/admin/Settings.tsx`; server: `server/src/core/tokens.ts`, `server/src/core/auth.ts` (bearer
handling), `server/src/core/migrations/003_platform_services.sql`, settings in
`server/src/modules/admin/settings.ts`; tests in `server/src/core/platform.test.ts`
("personal access tokens"). Routes: `GET/POST /api/me/tokens`, `DELETE /api/me/tokens/:id`,
`GET /api/admin/tokens?user_id=`, `DELETE /api/admin/tokens/:id`.

### E02-13 Break-glass account

**Status:** in progress · **Priority:** P2 · **Type:** feature

As an administrator, I have one documented emergency account that works when single
sign-on or second factors are unavailable, and every use of it raises an alarm.

**Acceptance criteria**

- [x] One local account can be marked as break-glass (exactly one; an active administrator with a password and no linked provider)
- [x] It is exempt from single sign-on (refused through any provider, always keeps its password even with `auth.local_signin` off) and the guidance asks for a long random password and a hardware key; it cannot be disabled or lose administrator access while passwords are off
- [x] Every sign-in is audited prominently (`signin.break_glass`) and notified to every administrator in the application (`app.notify`) and by email when email is on (`app.sendMail`)
- [x] The session is marked; its Account security page shows a red notice (`BreakGlassBanner` is exported from `web/src/core/AuthPages.tsx` for the shell: E02-25)
- [ ] The procedure is described in the operations runbook (`docs/operations.md`; the steps are in the user guide, Administration > The break-glass account)

**Implemented in:** `registerSignInPolicy` and the alarm in `server/src/core/identity/service.ts`; `POST /api/admin/users/:id/break-glass` (`server/src/modules/admin/providers.ts`); guards in `users.ts`; `web/src/modules/admin/UserSignIn.tsx`, `Providers.tsx`, `LinkedIdentities.tsx`; tests in `server/src/modules/admin/sso.test.ts`

### E02-14 Secure session cookie when served over HTTPS

**Status:** done · **Priority:** P1 · **Type:** debt

As a security lead, I want the session cookie marked "secure" whenever the application
is not on the local loopback address. The flag stays off on plain HTTP on the local
machine.

**Acceptance criteria**

- [x] The cookie carries the secure flag when the application is served over HTTPS: `GRC_COOKIE_SECURE=auto` (with `GRC_TRUST_PROXY` behind a proxy) or `always`
- [x] `auto` is the default when the server has a certificate or a trusted proxy is configured; otherwise `off`
- [x] A forwarded-protocol header is believed only when the proxy is declared trusted, with tests
- [x] The application refuses to start on a non-loopback address without HTTPS (`GRC_HOST`; `GRC_ALLOW_INSECURE=1` when a TLS proxy is in front)
- [x] Depends on [E16-07](E16-hosting-operations-and-hardening.md)

**Implemented in:** `server/src/core/request.ts`; `setSessionCookie` (`server/src/core/auth.ts`); `planListen` and `defaultCookieSecure` (`server/src/core/http.ts`), `server/src/main.ts`; tests "session cookie" in `server/src/core/core.test.ts` and `server/src/core/http.test.ts`

### E02-15 Send a blocked person straight to second-factor set-up

**Status:** done · **Priority:** P1 · **Type:** bug

When the second factor is required and missing, the server refuses everything but
enrolment, and `GET /api/auth/state` says so (`mfaEnrollmentBlocked: true`). The web shell
does not act on it: after sign-in it still loads the overview, whose requests fail, and
the person has to find Account security themselves.

**Acceptance criteria**

- [x] With `mfaEnrollmentBlocked`, the shell skips loading list metadata and shows only the Account security page and sign-out
- [x] A `403 mfa_enrolment_required` from any request leads there too
- [x] Checked in a browser as a blocked user

**Where:** `web/src/core/auth.tsx`, `Shell.tsx`, `api.ts`

**Done:** the web shell shows only second-factor enrolment and sign out when /api/auth/state reports mfaEnrollmentBlocked.

### E02-16 Keep the secret key out of the data folder by default

**Status:** in progress · **Priority:** P2 · **Type:** debt

The generated key file sits beside the database, so a copy of the data folder (and every
`backup`) holds both the encrypted authenticator keys and the key that opens them.

Now: `GRC_SECRET_KEY`, else `GRC_SECRET_KEY_FILE`, else `<data folder>.secret.key` BESIDE the
data folder (for `data\` that is `data.secret.key`), generated on first start. An existing
`data\secret.key` is moved out at start-up (copied, read back, compared, then deleted); a
second identical copy (an old backup restored) is deleted; a different one is used as a
retired key so its values are re-encrypted, and left for the operator to delete. If the
parent folder cannot be written, the old place is used with a warning. Every start says
where the key came from.

**Acceptance criteria**

- [x] The key is generated outside the data folder, so `backup` does not copy it; existing installations are moved safely, with tests
- [x] A command shows where the key comes from and writes a new one: `npx tsx server/src/core/secretkey-cli.ts show | rotate` (`rotate` keeps the old key in `<key file>.previous` so the next start re-encrypts; refused while the server runs)
- [ ] `grc.ps1 secret-key show|rotate` runs that command (operations script)
- [ ] `restore` and the backup pages of the operations guide say how the key is brought back (text supplied to the operations guide's owner)

**Implemented in:** `server/src/core/secretkey.ts`, `secretkey-cli.ts`, `secretkey.test.ts`; `loadSecretBox` (`server/src/core/secretbox.ts`)

### E02-17 Enforce the second factor by default on new installations

**Status:** in progress · **Priority:** P2 · **Type:** improvement

`auth.mfa_enforcement` defaults to `notice` everywhere so that upgrades lock nobody out.
A new installation should start at `required`, with the setup wizard taking the first
administrator through set-up.

`POST /api/setup` takes `secondFactor: 'required' | 'notice'`. With `required` the setting is
stored (audited as `setup.second_factor`), the first administrator is blocked until enrolled,
and the web shell's enrolment gate (E02-15) takes them straight to Account security, where an
authenticator app or a passkey both enrol them. The wizard's choice (`SecondFactorChoice`)
starts at `required`.

**Acceptance criteria**

- [x] Setup with `secondFactor: 'required'` sets `required` and leads the first administrator to enrolment (tests)
- [x] Existing installations keep their current value (setup runs only once)
- [x] Depends on E02-15
- [ ] The setup wizard shows `SecondFactorChoice` and sends its value (component ready in `web/src/modules/account-keys`; the wizard belongs to the sign-in screens)
- [ ] A setup call that names no choice still keeps `notice` (scripts and the test helper rely on it): E02-19

**Implemented in:** `applySetupSecondFactor` (`server/src/core/webauthn/setup-default.ts`), called from `POST /api/setup` (`server/src/core/auth.ts`); `web/src/modules/account-keys/SecondFactorChoice.tsx`; tests "second factor on a new installation" in `server/src/core/webauthn/webauthn.test.ts`

### E02-18 Limit a token to source addresses

**Status:** open · **Priority:** P3 · **Type:** improvement

As a security lead, a token used by one integration works only from that integration's
machine, so a copied token is useless elsewhere. Found while building E02-12.

**Acceptance criteria**

- [ ] A token may carry a list of allowed source addresses or ranges
- [ ] A request from elsewhere is refused and audited as `token.refused`
- [ ] The per-token request count moves out of process memory with E14-12

### E02-19 Second factor required when setup names no choice

**Status:** open · **Priority:** P2 · **Type:** improvement

Found while building E02-17. `POST /api/setup` without `secondFactor` keeps `notice`, because
the test helper (`server/src/test/helpers.ts`) and the browser-check scripts create the first
administrator that way and would otherwise be blocked at once.

**Acceptance criteria**

- [ ] The test helper and documented scripts pass `secondFactor: 'notice'` explicitly
- [ ] Then a setup call without the field defaults to `required`

### E02-20 Re-encrypt webhook secrets after a key change

**Status:** open · **Priority:** P2 · **Type:** bug

Found while building E02-16. At start-up only authenticator keys are re-encrypted with the
current secret key (`encryptStoredSecrets`). Webhook signing secrets written with a retired key
keep working only while that key is still supplied (`GRC_SECRET_KEY_PREVIOUS` or
`<key file>.previous`); once it is removed they can no longer be read.

**Acceptance criteria**

- [ ] Every value sealed with the secret box is re-encrypted at start-up, with a count in the audit log
- [ ] `secret-key show` says when retired keys are still needed

### E02-21 A way back in for people whose only factor is a passkey

**Status:** open · **Priority:** P3 · **Type:** improvement

Found while building E02-08. Recovery codes are issued with the authenticator app only, so a
person whose only second factor is a passkey who loses it needs an administrator.

**Acceptance criteria**

- [ ] Recovery codes are offered when the first passkey is added and no app is set up
- [ ] The user guide explains the choice

### E02-22 Trust the provider's own second factor

**Status:** open · **Priority:** P2 · **Type:** improvement

A sign-in through a provider does not ask for this application's second factor, and a person
expected to have one here is still blocked by `auth.mfa_enforcement = required` until they set one
up. Found while building E02-09.

**Acceptance criteria**

- [ ] A per-provider choice "the provider enforces multi-factor", checked against the ID token's `amr`/`acr`
- [ ] Sessions made that way satisfy the second-factor requirement; others do not

### E02-23 Sign out at the provider too

**Status:** open · **Priority:** P3 · **Type:** feature

Signing out here leaves the provider session alive. Add RP-initiated logout (`end_session_endpoint`)
and, for a server deployment, back-channel logout so a disabled directory account ends its sessions here.

### E02-24 Groups by reference (group overage)

**Status:** open · **Priority:** P3 · **Type:** improvement

Some cloud directories send a reference (`_claim_names`) instead of the groups when a person is
in many groups; role mapping then sees none. Support fetching them, or document using application
roles or a filtered groups claim (documented today).

### E02-25 Break-glass banner on every page

**Status:** open · **Priority:** P2 · **Type:** improvement

The break-glass session is marked (`GET /api/auth/sso/session`) and shown on Account security, but
the shell does not yet show it on every page. Render `BreakGlassBanner` (exported from
`web/src/core/AuthPages.tsx`) in `web/src/core/Shell.tsx` beside the second-factor notice.

### E02-26 Directory (LDAP) sign-in

**Status:** open · **Priority:** P3 · **Type:** feature

A `credentials`-style driver in `server/src/core/identity/` (`authenticate(provider, secret,
username, password)` returning an `ExternalIdentity`) offered on the password form. Needs an LDAP
client (a new package) and LDAPS only.