# E02 Account security

**Status:** in progress (29 of 30 issues done)

## Goal

Make sign-in strong enough for a system that holds risk and incident records: a second
factor that is enforced, phishing-resistant options, single sign-on with the
organization's identity provider, tokens for automation, and a safe way back in when
everything else fails.

## Scope notes

- Passwords, lockout and sessions are in [E01](E01-platform-foundations.md).
- The second factor (authenticator app, passkeys and recovery codes) can be enforced. The
  setting's own default is `notice` so an upgrade locks nobody out; a new installation set up
  through the wizard starts at `required` (E02-17).
- Single sign-on with OpenID Connect needs outbound access to the identity provider; SAML 2.0
  (E02-10) needs none (the browser carries every message). It is off
  until an administrator switches a provider on; the application works without it. Running it
  for real also needs HTTPS on a real host name ([E16](E16-hosting-operations-and-hardening.md)).
- Directory (LDAP) sign-in (E02-26) needs an encrypted connection from this server to the
  directory (LDAPS or StartTLS); it too is off until switched on.

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
| E02-10 | Single sign-on with SAML | done | P3 |
| E02-11 | Link local accounts to single sign-on identities | done | P3 |
| E02-12 | Personal API tokens | done | P2 |
| E02-13 | Break-glass account | done | P2 |
| E02-14 | Secure session cookie when served over HTTPS | done | P1 |
| E02-15 | Send a blocked person straight to second-factor set-up | done | P1 |
| E02-16 | Keep the secret key out of the data folder by default | done | P2 |
| E02-17 | Enforce the second factor by default on new installations | done | P2 |
| E02-18 | Limit a token to source addresses | done | P3 |
| E02-19 | Second factor required when setup names no choice | done | P2 |
| E02-20 | Re-encrypt webhook secrets after a key change | done | P2 |
| E02-21 | A way back in for people whose only factor is a passkey | done | P3 |
| E02-22 | Trust the provider's own second factor | done | P2 |
| E02-23 | Sign out at the provider too | done | P3 |
| E02-24 | Groups by reference (group overage) | done | P3 |
| E02-25 | Break-glass banner on every page | done | P2 |
| E02-26 | Directory (LDAP) sign-in | done | P3 |
| E02-27 | SAML: act on sign-outs started at the identity provider | done | P3 |
| E02-28 | SAML: check metadata signatures and refresh metadata | done | P3 |
| E02-29 | Directory sign-in: passkey as second factor, linking and confirming from Account security | done | P3 |
| E02-30 | Remember the directory user name for identity confirmation | done | P3 |

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
- [x] The application state reports when the signed-in user still needs to enroll
- [x] The shell shows a notice linking to account security

**Implemented in:** `mfaEnrollmentRequired` (`server/src/core/auth.ts`); `auth.mfa_required_for_all` (`server/src/modules/admin/settings.ts`); `web/src/core/Shell.tsx`

### E02-05 Enforce the second factor

**Status:** done · **Priority:** P1 · **Type:** improvement

As an administrator, when I require a second factor I want it enforced: a person who
has not enrolled can do nothing except enroll.

Setting `auth.mfa_enforcement`: `off`, `notice` (default) or `required`. With `required`,
a person expected to have a second factor (their role says so, or
`auth.mfa_required_for_all` is on) who has none can call only: their own state, the
account security routes (begin and confirm set-up, change password, list own sessions,
confirm password) and sign-out. Everything else answers `403 mfa_enrolment_required`.

**Acceptance criteria**

- [x] A user for whom the factor is required and missing is limited to the enrollment routes
- [x] The web app sends them to enrollment after sign-in (built in E02-15: with `mfaEnrollmentBlocked` the shell shows only second-factor set-up and sign out, `EnrollmentGate` in `web/src/App.tsx`)
- [x] A grace period is configurable (`auth.mfa_grace_days`, default none)
- [x] The Administrator and Security lead roles are the ones enforced when the setting is `required` (they carry the "requires second factor" flag by default). The setting itself defaults to `notice`, by decision, so existing installations keep working; see E02-17
- [x] An administrator cannot switch to `required` before setting up their own second factor
- [x] Tests cover blocked and allowed requests

**Implemented in:** `mfaEnforcement`, `mfaStatus`, `MFA_ENROLLMENT_ROUTES` and the request hook (`server/src/core/auth.ts`); `auth.mfa_enforcement`, `auth.mfa_grace_days` (`server/src/modules/admin/settings.ts`); `users.mfa_required_since` (`server/src/core/migrations/002_hardening.sql`); `web/src/modules/admin/Settings.tsx`, `AccountSecurity.tsx`; tests "enforced second factor" in `server/src/modules/admin/admin.test.ts`

### E02-06 Replay protection for authenticator codes

**Status:** done · **Priority:** P1 · **Type:** bug

As a security lead, I want a 6-digit code to work once only.

**Acceptance criteria**

- [x] The last accepted time step is stored per user (`users.totp_last_step`)
- [x] A code from that step or earlier is refused, at sign-in, at enrollment and when turning the factor off
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
- [x] The card is on the Account security page and on an administrator's user page, and the sign-in page offers **Sign in with a passkey** and **Use a passkey or security key instead** (`PasskeysCard` in `web/src/modules/admin/AccountSecurity.tsx` and `UserDetail.tsx`; `PasskeySignIn` and `PasskeySecondFactorButton` in `web/src/core/AuthPages.tsx`)
- [x] An administrator's second-factor reset also removes the person's passkeys (`revokeAllPasskeys` in `POST /api/admin/users/:id/reset-mfa`, `server/src/modules/admin/users.ts`), and the "set up your own second factor first" check on `auth.mfa_enforcement` counts a passkey (`hasActivePasskey` in `server/src/modules/admin/settings.ts`); both tested in `server/src/modules/admin/security.test.ts` ("passkeys count as a second factor for administrators")

**Implemented in:** `server/src/core/webauthn/` (`cbor.ts`, `cose.ts`, `ceremony.ts`, `config.ts`, `store.ts`, `routes.ts`, `apidocs.ts`, `softauthn.ts` test authenticator, `webauthn.test.ts`); hooks in `server/src/core/auth.ts` (`registerWebAuthn`, `passkeySecondFactor`, `hasActivePasskey`, `WEBAUTHN_ENROLLMENT_ROUTES`); `server/src/core/migrations/004_webauthn.sql`; web `web/src/modules/account-keys/` (`PasskeysCard`, `PasskeySignIn`, `PasskeySecondFactorButton`, pages `/account/passkeys` and `/sign-in/passkey`); `tools/browse.mjs` (`VIRTUAL_AUTHENTICATOR=1`); [user guide](../../user/16-passkeys-and-security-keys.md)

### E02-09 Single sign-on with OpenID Connect

**Status:** done · **Priority:** P2 · **Type:** feature

As a user, I sign in with my organization account. As an administrator, I configure the
identity provider in settings and map its groups to roles.

**Acceptance criteria**

- [x] Provider details are entered in settings, not in code (Administration > Sign-in providers; issuer and every endpoint from the discovery document, so commercial, government-cloud and self-hosted providers are configured alike)
- [x] Authorization-code flow with proof key (PKCE S256), `state` bound to the browser and single-use, `nonce`
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

**Status:** done · **Priority:** P3 · **Type:** feature

As an administrator whose identity provider only offers SAML, I can connect it in the
same way as OpenID Connect.

Unblocked by decision: no paid service; an open-source XML-signature library inside the
application. **@node-saml/node-saml** 5.2.0 (MIT, the maintained successor of passport-saml's
core; on xml-crypto 6.4.0 and @xmldom/xmldom 0.8.15, with xml-encryption 3.1.0), pinned to exact
versions; `npm audit` clean. Since wave 12 the application's own parsing (`samlxml.ts`) is on
@xmldom/xmldom 0.9.12 and its decryption (`saml.ts`) on xml-encryption 6.0.2; the library and
xml-crypto keep their own @xmldom/xmldom 0.8.15 until they move. It checks the XML signatures (configured certificates only, signed
bytes read, one assertion, InResponseTo, audience, issuer, times); this application adds hardened
parsing, a signature-wrapping and algorithm allow-list check, exact Destination and Recipient,
browser binding and one-time assertion IDs (see [Security](../../security.md)).

**Acceptance criteria**

- [x] Service-provider metadata is published per provider (`GET /api/auth/sso/:key/metadata`), with this application's own RSA-3072 key and self-signed certificate (key stored encrypted, replaceable)
- [x] Identity-provider metadata imported by pasting or uploading it, or fetched by address only when outbound connections are on and the host is allowed; or entity ID, sign-in address and several signing certificates (for a rollover) entered by hand
- [x] SP-initiated Web Browser SSO: AuthnRequest with the HTTP-Redirect binding (optionally signed), Response with the HTTP-POST binding to the assertion consumer service; the posted response is bound to the browser that started the sign-in
- [x] Signed assertions (or a signed response around them) are verified; unsigned ones are refused; only RSA-SHA256 or stronger
- [x] Exact Destination, Recipient, Audience, issuer and InResponseTo (request IDs single-use, 10 minutes); NotBefore/NotOnOrAfter with 60 s skew; assertion IDs accepted once (database); signature wrapping, DTD/XXE, entity expansion and size limits refused
- [x] Optional encrypted assertions (AES-GCM, RSA-OAEP)
- [x] NameID and attributes (email, display name, groups) map to accounts and roles exactly as for OpenID Connect: linking, just-in-time accounts, role mapping, break-glass, audit and rate limits; the provider's multi-factor sign-in through AuthnContextClassRef
- [x] SP-initiated single logout (signed LogoutRequest, HTTP-Redirect); sign-outs started at the identity provider are E02-27
- [x] Tests with a stand-in identity provider whose key is made at test time: happy paths, and refusals for unsigned, untrusted key, SHA-1, wrong audience, expired, not yet valid, wrong InResponseTo, unsolicited, wrong Recipient, Destination and issuer, transient NameID, error status, DTD/XXE, entity expansion, changed content, two kinds of signature wrapping, a reference to another element, replayed assertion, replayed response, another browser, oversized response, rate limit
- [x] Checked in a browser: the provider screens (light and dark, 1440 and 820) and a whole sign-in through the stand-in identity provider

**Implemented in:** `server/src/core/identity/saml.ts` (driver, metadata, logout), `samlxml.ts` (hardened XML, response and assertion checks, metadata), `x509.ts` (certificates), `saml-fake-idp.ts` (stand-in identity provider), `saml.test.ts`; `keepPostedResponse`, `acceptAssertionOnce`, `consumeFlow` (`service.ts`); routes `/api/auth/sso/:key/acs`, `/metadata`, `/slo` (`server/src/modules/admin/sso.ts`), `POST /api/admin/identity-providers/saml-metadata` and key handling (`providers.ts`), `migrations/003_saml.sql`, `saml.test.ts`; web `ProviderEditor.tsx`, `SamlFields.tsx`, `saml.css`, `Providers.tsx`; [user guide](../../user/09-administration.md#saml-20-providers), [Security](../../security.md)

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

**Status:** done · **Priority:** P2 · **Type:** feature

As an administrator, I have one documented emergency account that works when single
sign-on or second factors are unavailable, and every use of it raises an alarm.

**Acceptance criteria**

- [x] One local account can be marked as break-glass (exactly one; an active administrator with a password and no linked provider)
- [x] It is exempt from single sign-on (refused through any provider, always keeps its password even with `auth.local_signin` off) and the guidance asks for a long random password and a hardware key; it cannot be disabled or lose administrator access while passwords are off
- [x] Every sign-in is audited prominently (`signin.break_glass`) and notified to every administrator in the application (`app.notify`) and by email when email is on (`app.sendMail`)
- [x] The session is marked; its Account security page shows a red notice (`BreakGlassBanner` is exported from `web/src/core/AuthPages.tsx` for the shell: E02-25)
- [x] The banner is shown on every page (E02-25)
- [x] The procedure is described in the operations runbook (`docs/operations.md`, owned by operations: the text was handed to its owner in wave 4; the steps are in the user guide, Administration > The break-glass account)

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
enrollment, and `GET /api/auth/state` says so (`mfaEnrollmentBlocked: true`). The web shell
does not act on it: after sign-in it still loads the overview, whose requests fail, and
the person has to find Account security themselves.

**Acceptance criteria**

- [x] With `mfaEnrollmentBlocked`, the shell skips loading list metadata and shows only the Account security page and sign-out
- [x] A `403 mfa_enrolment_required` from any request leads there too
- [x] Checked in a browser as a blocked user

**Where:** `web/src/core/auth.tsx`, `Shell.tsx`, `api.ts`

**Done:** the web shell shows only second-factor enrollment and sign out when /api/auth/state reports mfaEnrollmentBlocked.

### E02-16 Keep the secret key out of the data folder by default

**Status:** done · **Priority:** P2 · **Type:** debt

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
- [x] `grc.ps1 secret-key show|rotate` (and `grc.sh`) runs that command (operations script; the change was handed to its owner in wave 4)
- [x] `restore` and the backup pages of the operations guide say how the key is brought back (text supplied to the operations guide's owner)

- [x] `show` says whether retired keys are still needed (E02-20)

**Implemented in:** `server/src/core/secretkey.ts`, `secretkey-cli.ts`, `secretkey.test.ts`; `loadSecretBox` (`server/src/core/secretbox.ts`)

### E02-17 Enforce the second factor by default on new installations

**Status:** done · **Priority:** P2 · **Type:** improvement

`auth.mfa_enforcement` defaults to `notice` everywhere so that upgrades lock nobody out.
A new installation should start at `required`, with the setup wizard taking the first
administrator through set-up.

`POST /api/setup` takes `secondFactor: 'required' | 'notice'`. With `required` the setting is
stored (audited as `setup.second_factor`), the first administrator is blocked until enrolled,
and the web shell's enrollment gate (E02-15) takes them straight to Account security, where an
authenticator app or a passkey both enroll them. The wizard's choice (`SecondFactorChoice`)
starts at `required`.

**Acceptance criteria**

- [x] Setup with `secondFactor: 'required'` sets `required` and leads the first administrator to enrollment (tests)
- [x] Existing installations keep their current value (setup runs only once)
- [x] Depends on E02-15
- [x] The setup wizard shows `SecondFactorChoice` and sends its value (`SetupPage` in `web/src/core/AuthPages.tsx`; verified in wave 4)
- [x] A setup call that names no choice still keeps `notice` (scripts and the test helper rely on it); changing that is E02-19

**Implemented in:** `applySetupSecondFactor` (`server/src/core/webauthn/setup-default.ts`), called from `POST /api/setup` (`server/src/core/auth.ts`); `web/src/modules/account-keys/SecondFactorChoice.tsx`; tests "second factor on a new installation" in `server/src/core/webauthn/webauthn.test.ts`; wizard in `web/src/core/AuthPages.tsx` (`SetupPage`)

### E02-18 Limit a token to source addresses

**Status:** done · **Priority:** P3 · **Type:** improvement

As a security lead, a token used by one integration works only from that integration's
machine, so a copied token is useless elsewhere. Found while building E02-12.

**Acceptance criteria**

- [x] A token may carry a list of allowed source addresses or ranges (up to 20, IPv4 and IPv6, CIDR; `allowedSources` on `POST /api/me/tokens` and `POST /api/mcp/tokens`; shown on the token screens)
- [x] A request from elsewhere is refused (`403 token_source_not_allowed`) and audited as `token.refused`; it counts toward the wrong-token limit for that address
- [x] The address checked is the one the application trusts (`clientIp`: the connection's own, or the entry the trusted proxy appended under `GRC_TRUST_PROXY`; a forwarded header is ignored otherwise) (tested)
- [x] The list can be changed on a live token, by its owner (`PATCH /api/me/tokens/:id`, **Addresses** on Account security) or an administrator (`PATCH /api/admin/tokens/:id`, **Addresses** on Administration > API tokens), with a recent identity confirmation; an empty list allows any address again; audited as `token.update` with the lists before and after
- [x] The administrators' token list shows "From any address" for a token without a list
- [ ] The per-token request count moves out of process memory: not part of this issue, raised as [E16-43](E16-hosting-operations-and-hardening.md) (the count behind `tokens.rate_per_minute` is kept per server process, so a restart resets the current minute and each of several processes counts on its own)

**Implemented in:** `server/src/core/tokens.ts` (`checkSources`, `sourceAllowed`, `changeSources`), `server/src/core/migrations/008_token_source_addresses.sql`, route descriptions in `server/src/core/api/docs/tokens.ts`; `web/src/modules/admin/ApiTokens.tsx` (`SourcesDialog`), `web/src/modules/mcp/ConnectCard.tsx`; tests `server/src/core/api/token-sources.test.ts`, browser test "API token: change the allowed source addresses" (`tools/e2e/suites/07-dialogs.mjs`)

### E02-19 Second factor required when setup names no choice

**Status:** done · **Priority:** P2 · **Type:** improvement

Found while building E02-17. `POST /api/setup` without `secondFactor` keeps `notice`, because
the test helper (`server/src/test/helpers.ts`) and the browser-check scripts create the first
administrator that way and would otherwise be blocked at once.

**Acceptance criteria**

- [x] The test helper and documented scripts pass `secondFactor: 'notice'` explicitly (`server/src/test/helpers.ts` `ADMIN`, `tools/e2e/lib/instance.mjs`, the `POST /api/setup` description in `server/src/core/apidocs.ts`: changes handed to their owners in wave 4, as one change with the next line, so no running test is blocked in between)
- [x] Then a setup call without the field defaults to `required` (`applySetupSecondFactor` in `server/src/core/webauthn/setup-default.ts`: `choice !== 'notice'` instead of `choice !== 'required'`, and its test)

**Implemented in:** `server/src/core/webauthn/setup-default.ts` (only an explicit `notice` keeps the reminder), `webauthn.test.ts`, `server/src/test/helpers.ts`, `tools/e2e/lib/instance.mjs`, `tools/load/run.mjs`, the `POST /api/setup` description.

### E02-20 Re-encrypt webhook secrets after a key change

**Status:** done · **Priority:** P2 · **Type:** bug

Found while building E02-16. At start-up only authenticator keys are re-encrypted with the
current secret key (`encryptStoredSecrets`). Webhook signing secrets written with a retired key
keep working only while that key is still supplied (`GRC_SECRET_KEY_PREVIOUS` or
`<key file>.previous`); once it is removed they can no longer be read.

**Acceptance criteria**

- [x] Every value sealed with the secret box is re-encrypted at start-up, with a count in the audit log: authenticator keys (`mfa.secrets_encrypted`), webhook secrets, provider client secrets, the mail password, the object store key, links waiting to be emailed, sign-on requests in progress and provider sign-out details (`secret_key.reencrypted`); unreadable ones are reported (`secret_key.unreadable`) and a webhook whose secret cannot be read is `blocked` with that reason
- [x] `secret-key show` says when retired keys are still needed (it reads the database without changing it; with the embedded database the server must be stopped)

**Implemented in:** `server/src/core/secretkey-reseal.ts` (`SEALED_KINDS`, `resealStoredSecrets`, `retiredKeyAdvice`); `encryptStoredSecrets` (`server/src/core/auth.ts`); `secretkey-cli.ts`; `SecretBox.retiredKeys` (`secretbox.ts`); webhook delivery (`server/src/core/webhooks.ts`); tests "every stored secret is re-encrypted after a key change" in `server/src/modules/admin/security.test.ts`

### E02-21 A way back in for people whose only factor is a passkey

**Status:** done · **Priority:** P3 · **Type:** improvement

Found while building E02-08. Recovery codes are issued with the authenticator app only, so a
person whose only second factor is a passkey who loses it needs an administrator.

**Acceptance criteria**

- [x] Recovery codes are offered when the first passkey is added and no app is set up (a **Recovery codes** card on Account security, "None yet"; `offerRecoveryCodes` in the register answer); made with the password, shown once
- [x] A recovery code stands in for the passkey at sign-in (the sign-in page offers it when the key does not answer) and when confirming identity; codes go with the last factor, and stay when the app is turned off while a key remains
- [x] The user guide explains the choice ([Passkeys and security keys](../../user/16-passkeys-and-security-keys.md#recovery-codes-for-passkeys))

**Implemented in:** `POST /api/auth/login` (`server/src/core/auth.ts`); `GET /api/auth/security`, `POST /api/auth/totp/recovery-codes`, `/totp/disable` (`server/src/modules/admin/account.ts`); `dropOrphanRecoveryCodes` and `offerRecoveryCodes` (`server/src/core/webauthn/routes.ts`); web `PasskeyRecoveryCodes` (`web/src/modules/admin/AccountSecurity.tsx`), recovery-code step in `LoginPage` (`web/src/core/AuthPages.tsx`); tests in `server/src/modules/admin/security.test.ts`

### E02-22 Trust the provider's own second factor

**Status:** done · **Priority:** P2 · **Type:** improvement

A sign-in through a provider does not ask for this application's second factor, and a person
expected to have one here is still blocked by `auth.mfa_enforcement = required` until they set one
up. Found while building E02-09.

**Acceptance criteria**

- [x] A per-provider choice "the provider enforces multi-factor" (`providerMfa`, off), checked against the ID token's `amr` (`mfaAmr`, default `mfa`) or `acr` (`mfaAcr`, also sent as `acr_values`)
- [x] Sessions made that way satisfy the second-factor requirement; others do not (kept per session in `identity_sessions.mfa`, re-checked against the provider's current setting on every request); a confirmation through that provider must show it too

**Implemented in:** `providerMfaSatisfied` (`server/src/core/identity/config.ts`); `identityFromClaims`, `start` (`oidc.ts`); `finishSignIn` and the `sessionSecondFactor` policy (`service.ts`, `hooks.ts`); `mfaStatusForSession` (`server/src/core/auth.ts`); `server/src/modules/admin/migrations/002_provider_sessions.sql`; web `ProviderEditor.tsx` (**Second factor**), `AccountSecurity.tsx`; tests in `server/src/modules/admin/sso.test.ts`

### E02-23 Sign out at the provider too

**Status:** done · **Priority:** P3 · **Type:** feature

Signing out here leaves the provider session alive. Add RP-initiated logout (`end_session_endpoint`)
and, for a server deployment, back-channel logout so a disabled directory account ends its sessions here.

**Acceptance criteria**

- [x] RP-initiated logout, per provider (`endSession`, off): `POST /api/auth/logout` answers `redirectUrl` (`end_session_endpoint` with `id_token_hint`, `client_id`, `post_logout_redirect_uri`), which the web app follows; the ID token is kept encrypted with the session for that only
- [x] Back-channel logout, per provider (`backchannelLogout`, off): `POST /api/auth/sso/:key/backchannel-logout` checks the logout token (signature, issuer, audience, issue time, event, `sub`/`sid`, no nonce), ends the sessions made through that provider for that subject or provider session, acts once per `jti`, and audits
- [x] Tests: the redirect, a password session getting none, bad signature, wrong audience, nonce, missing event, neither `sub` nor `sid`, replay, by `sid`

**Implemented in:** `endSessionUrl`, `verifyLogoutToken` (`server/src/core/identity/oidc.ts`); the `signOutRedirect` policy (`service.ts`, `hooks.ts`); `/api/auth/logout` and the `noCsrf` route option (`server/src/core/auth.ts`); the back-channel route (`server/src/modules/admin/sso.ts`); `002_provider_sessions.sql`; web `logout` (`web/src/core/auth.tsx`), `ProviderEditor.tsx` (**Signing out**); stand-in provider `/logout`, `logoutToken()` (`fake-provider.ts`); tests in `sso.test.ts`

### E02-24 Groups by reference (group overage)

**Status:** done · **Priority:** P3 · **Type:** improvement

Some cloud directories send a reference (`_claim_names`) instead of the groups when a person is
in many groups; role mapping then sees none. Support fetching them, or document using application
roles or a filtered groups claim (documented today).

**Acceptance criteria**

- [x] Overage is recognized (`_claim_names`/`_claim_sources` for the groups claim, or `hasgroups`), and the groups are read from the userinfo endpoint, then the named source, with the sign-in's access token; only a JSON answer about the same subject is used
- [x] When they cannot be had, role mapping leaves roles unchanged (`identity.groups_unknown`) rather than removing them
- [x] A per-provider choice to read groups from userinfo at every sign-in (`groupsFromUserinfo`)
- [x] Documented, with application roles or a filtered groups claim for directories whose source needs its own kind of request

**Implemented in:** `groupsOverage`, `fetchGroups` (`server/src/core/identity/oidc.ts`); `finishSignIn` (`service.ts`); `ExternalIdentity.groupsUnknown` (`types.ts`); stand-in provider `/userinfo`, `/groups`; tests in `sso.test.ts`

### E02-25 Break-glass banner on every page

**Status:** done · **Priority:** P2 · **Type:** improvement

The break-glass session is marked (`GET /api/auth/sso/session`) and shown on Account security, but
the shell does not yet show it on every page. Render `BreakGlassBanner` (exported from
`web/src/core/AuthPages.tsx`) in `web/src/core/Shell.tsx` beside the second-factor notice.

**Done:** `web/src/core/Shell.tsx` renders `BreakGlassBanner` at the top of the main area on every page (verified in wave 4); the session marking is tested in `sso.test.ts`.

### E02-26 Directory (LDAP) sign-in

**Status:** done · **Priority:** P3 · **Type:** feature

As an administrator of an organization whose people have directory accounts, I can let them sign
in here with their directory user name and password (Active Directory, OpenLDAP), configured as a
sign-in provider beside OpenID Connect and SAML.

**Acceptance criteria**

- [x] A `credentials`-style driver (`authenticate(provider, secret, username, password)` returning an `ExternalIdentity`) offered on the password form as a **Sign in with** choice; the provider list shows it as **Directory (LDAP)**
- [x] Encrypted only: `ldaps://` or `ldap://` with StartTLS; plain LDAP refused except to 127.0.0.1 (tests); TLS 1.2+, certificate and host name checked; optional pinned CA certificate
- [x] Service account bind (its password stored encrypted with the secret key, covered by `SEALED_KINDS`), then a search with the administrator's filter and the user name escaped (RFC 4515), sent in binary form; exactly one entry; a DN template without a service account (RFC 4514 escaping)
- [x] The password checked by binding as the entry on its own connection; an empty password never sent; disabled, expired and locked accounts refused
- [x] Groups from `memberOf`, a group search, or Active Directory nested groups (`LDAP_MATCHING_RULE_IN_CHAIN`), mapped to roles like the other providers; account matching, linking and just-in-time accounts as for the other providers
- [x] The second factor still applies (authenticator code or recovery code); the provider never counts as a second factor
- [x] Rate limits and lockout as for a password (by address, by user name, and the linked account's progressive lockout); audited; passwords and service account details never logged
- [x] **Test connection** reports the TLS version and certificate, the service account and base DN, and can look a person up (DN, identifier, email, disabled, groups) without a password
- [x] Tests against an in-process stand-in directory (no network): LDAPS, StartTLS, StartTLS refused, untrusted certificate, wrong password, disabled and locked accounts, ambiguous and unknown names, injection attempts, second factor, lockout
- [x] Checked in a browser: the provider editor and list, and a directory sign-in on the sign-in page (light and dark, 1440 and 820)

**Implemented in:** `server/src/core/identity/ldap.ts` (driver), `ldapclient.ts` (LDAP v3 client on `node:tls`: no package), `ldapfilter.ts` (RFC 4515 filters, RFC 4514 DN escaping), `ber.ts`, `ldap-fake-server.ts` (stand-in directory), `ldap.test.ts`; the second-factor step in `finishSignIn` (`service.ts`); `POST /api/auth/sso/:key/login` (`server/src/modules/admin/sso.ts`), the test with a user name and the service account password (`providers.ts`), `ldap.test.ts`; web `LdapFields.tsx`, `ProviderEditor.tsx`, `Providers.tsx`, `web/src/core/AuthPages.tsx`; [user guide](../../user/09-administration.md#directory-ldap-sign-in), [Security](../../security.md)

### E02-27 SAML: act on sign-outs started at the identity provider

**Status:** done · **Priority:** P3 · **Type:** feature

Split from E02-10. Signing out here already signs out at a SAML identity provider (SP-initiated).
A LogoutRequest the identity provider sends to `/api/auth/sso/:key/slo` (when the person signs out
there, or elsewhere) is now acted on when the administrator switches it on for the provider.

**Acceptance criteria**

- [x] Off by default (**Act on sign-outs started at the identity provider**); while off, requests are ignored as before
- [x] HTTP-Redirect (query-string signature) and HTTP-POST (XML signature) bindings; unsigned requests refused, SHA-1 refused, only the configured certificates trusted
- [x] Issuer, `Destination`, issue time (five minutes) and `NotOnOrAfter` checked; each request ID works once; hardened parsing and a size limit on the inflated message
- [x] The sessions made through that provider for the NameID (and the SessionIndex, when given) end; a signed LogoutResponse goes back to the identity provider's sign-out address; audited (`identity.saml_logout`); refusals audited as failures
- [x] The service-provider metadata lists the single logout address for both bindings
- [x] Tests with the stand-in identity provider: both bindings, one session index or all, replay, unsigned, foreign key, SHA-1, wrong or missing destination, stale and future, wrong issuer, changed after signing, switched off

**Implemented in:** `verifyIdpLogoutRequest`, `idpLogoutResponseUrl` (`server/src/core/identity/saml.ts`), `inspectLogoutRequest` (`samlxml.ts`), `logoutRequest` in `saml-fake-idp.ts`; GET and POST `/api/auth/sso/:key/slo` (`server/src/modules/admin/sso.ts`), `saml-slo.test.ts`; web `ProviderEditor.tsx`; [user guide](../../user/09-administration.md#saml-20-providers), [Security](../../security.md)

### E02-28 SAML: check metadata signatures and refresh metadata

**Status:** done · **Priority:** P3 · **Type:** improvement

Split from E02-10. Identity-provider metadata was pasted, uploaded or fetched once, and its own
signature was not checked.

**Acceptance criteria**

- [x] An optional metadata signing certificate on the provider: metadata read with it must carry one valid signature on its root, with the sign-in algorithm allow-list; only the signed bytes are read; out-of-date metadata (`validUntil`) refused
- [x] An optional daily refresh through the job queue (`scheduleWork`, `admin.saml_metadata_refresh`), and **Refresh now**: only with outbound connections on and the host allowed, signed metadata only, never changing the entity ID
- [x] New signing certificates are added; ones the metadata stops listing are kept for 7 days (rollover), then removed; sign-in and sign-out addresses follow the metadata
- [x] Every refresh and every failure audited (`identity_provider.metadata_refresh`), the last result shown on the provider
- [x] Tests: valid, unsigned, foreign-signed, changed after signing, out of date; refresh with outbound off, a rollover, removal after 7 days, a bad signature changing nothing

**Implemented in:** `verifyMetadataSignature` and `validUntil` (`server/src/core/identity/samlxml.ts`), `mergeRefreshedCertificates` (`saml.ts`), signed metadata in `saml-fake-idp.ts`; `refreshMetadata`, `POST /api/admin/identity-providers/:id/refresh-metadata`, the daily job and `metadataCert` on `POST /api/admin/identity-providers/saml-metadata` (`server/src/modules/admin/providers.ts`), `saml-slo.test.ts`; web `SamlFields.tsx`, `Providers.tsx`; [user guide](../../user/09-administration.md#saml-20-providers), [Security](../../security.md)

### E02-29 Directory sign-in: passkey as second factor, linking and confirming from Account security

**Status:** done · **Priority:** P3 · **Type:** improvement

Split from E02-26. After a directory password, a person whose only second factor is a passkey must
use a recovery code: the passkey step (`/api/auth/webauthn/login/options` with a user name and
password) checks a local password. Also, a directory cannot be linked from **Account security**
(it is linked at sign-in), and a person without a local password cannot confirm their identity
with the directory password for sensitive actions. Offer a passkey challenge after a successful
directory password, linking a directory from Account security and a directory confirmation in the
confirmation dialog, and hide **Confirm with …** for a directory in `LinkedIdentities.tsx` until then.

**Acceptance criteria**

- [x] After a correct directory password, a person whose second factor is a passkey is asked for it: the sign-in answers 401 `mfa_required` with `fields.passkey: required`; `POST /api/auth/sso/:key/passkey-options` checks the directory user name and password again and gives the options for the linked account's keys; the sign-in takes the answer as `webauthn`. A recovery code still works; a person with an authenticator app can use a key instead of the code
- [x] The existing limits and lockout apply to every step: failures by address and by directory user name, a wrong password, code or key counts toward the linked account's lockout, refusals audited
- [x] A directory can be linked from **Account security** (`POST /api/auth/sso/:key/link-directory`, its user name and password after a recent confirmation; the directory must give the account's email address, trusted), audited as `identity.link`
- [x] A person can confirm their identity for sensitive actions with a linked directory's password (`POST /api/auth/sso/:key/confirm`, the same entry as the link, then their second factor as for a password confirmation); the confirmation dialog offers it (`GET /api/auth/sso/confirm-methods`), and **Confirm with …** is shown for a directory on the Single sign-on card
- [x] Tests with the stand-in directory and the software authenticator; the sign-in page's layout is unchanged (only the passkey step after a directory password is added)

**Implemented in:** `server/src/modules/admin/sso.ts` (`checkDirectory`, the login route, `passkey-options`, `link-directory`, `confirm`, `confirm-methods`), `passkeyLoginOptions` in `server/src/core/webauthn/routes.ts`, route descriptions in `server/src/modules/admin/docs.ts`; web `web/src/core/reauth.ts` (directory choice in the confirmation dialog, `confirmIdentity`), `web/src/modules/admin/LinkedIdentities.tsx` (`LinkDirectoryDialog`, **Confirm with …**), `web/src/modules/account-keys/PasskeySignIn.tsx` and the directory branch of `LoginPage` in `web/src/core/AuthPages.tsx`; test `server/src/modules/admin/ldap-account.test.ts`; [user guide](../../user/16-passkeys-and-security-keys.md)

### E02-30 Remember the directory user name for identity confirmation

**Status:** done · **Priority:** P3 · **Type:** improvement

Follow-up to E02-29. A person who confirms their identity with a linked directory had to type
their directory user name every time. Remember the user name that last worked, with the linked
identity, and fill it in; never the password.

**Acceptance criteria**

- [x] The directory user name that last worked to link, sign in or confirm is kept with the linked identity (`user_identities.login_name`, admin migration `004`; empty for OpenID Connect and SAML); the password is never stored
- [x] `GET /api/auth/sso/confirm-methods` gives it per directory (`username`); a wrong user name or a different directory entry does not replace it
- [x] The confirmation dialog fills it in and puts the cursor in the password field; a name the person typed is kept when they change the way of confirming
- [x] Tests with the stand-in directory, and a component test of the dialog

**Implemented in:** `server/src/core/identity/types.ts` (`loginName`), `ldap.ts`, `accounts.ts` (`linkIdentity`), `service.ts` (sign-in), `server/src/modules/admin/sso.ts` (`confirm`, `confirm-methods`), `docs.ts`, `migrations/004_identity_login_name.sql`; web `web/src/core/reauth.ts`; tests `server/src/modules/admin/ldap-account.test.ts`, `web/src/core/reauth.component.test.ts`; [user guide](../../user/09-administration.md)
