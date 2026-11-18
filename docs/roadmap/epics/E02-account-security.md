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
- Single sign-on needs outbound network access, which the local prototype does not
  have. Those issues depend on [E16](E16-hosting-operations-and-hardening.md).

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
| E02-08 | Passkeys and security keys (WebAuthn) | open | P3 |
| E02-09 | Single sign-on with OpenID Connect | open | P2 |
| E02-10 | Single sign-on with SAML | open | P3 |
| E02-11 | Link local accounts to single sign-on identities | open | P3 |
| E02-12 | Personal API tokens | open | P2 |
| E02-13 | Break-glass account | open | P2 |
| E02-14 | Secure session cookie when served over HTTPS | in progress | P1 |
| E02-15 | Send a blocked person straight to second-factor set-up | open | P1 |
| E02-16 | Keep the secret key out of the data folder by default | open | P2 |
| E02-17 | Enforce the second factor by default on new installations | open | P2 |

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
- [ ] Backups contain no usable authenticator keys: true only when the key is supplied through `GRC_SECRET_KEY` or a `GRC_SECRET_KEY_FILE` outside the data folder. With the default key file, `backup` copies the key with the database (E02-16)

**Implemented in:** `server/src/core/secretbox.ts`; `secretBox`, `storeTotpSecret`, `readTotpSecret`, `encryptStoredSecrets` (`server/src/core/auth.ts`); `Db.dataDir` (`server/src/core/db.ts`); tests in `server/src/core/core.test.ts`

### E02-08 Passkeys and security keys (WebAuthn)

**Status:** open · **Priority:** P3 · **Type:** feature

As a user, I can register a passkey or a hardware security key as my second factor, or
as my only factor, so sign-in resists phishing.

**Acceptance criteria**

- [ ] Register, name and remove more than one key
- [ ] Sign in with a key in place of an authenticator code
- [ ] Works once the application is served over HTTPS on a real host name
- [ ] All key events are audited

### E02-09 Single sign-on with OpenID Connect

**Status:** open · **Priority:** P2 · **Type:** feature

As a user, I sign in with my organisation account. As an administrator, I configure the
identity provider in settings and map its groups to roles.

**Acceptance criteria**

- [ ] Provider details are entered in settings, not in code
- [ ] Authorisation-code flow with proof key
- [ ] Groups or claims map to roles
- [ ] Local sign-in can be limited to named accounts once single sign-on is on
- [ ] Sign-in events record which method was used

### E02-10 Single sign-on with SAML

**Status:** open · **Priority:** P3 · **Type:** feature

As an administrator whose identity provider only offers SAML, I can connect it in the
same way as OpenID Connect.

**Acceptance criteria**

- [ ] Service-provider metadata is published and identity-provider metadata imported
- [ ] Signed assertions are verified; unsigned ones are refused
- [ ] Attributes map to roles

### E02-11 Link local accounts to single sign-on identities

**Status:** open · **Priority:** P3 · **Type:** feature

As a user who already has a local account, my first single sign-on visit links to it
rather than creating a duplicate.

**Acceptance criteria**

- [ ] Matching is on a verified email address and needs one confirmation
- [ ] An administrator can link and unlink identities by hand
- [ ] Links are shown on the user page and audited

### E02-12 Personal API tokens

**Status:** open · **Priority:** P2 · **Type:** feature

As a user who automates work, I can create a named token with an expiry and limited
permissions, and use it instead of a browser session.

**Acceptance criteria**

- [ ] Tokens are shown once and stored as hashes
- [ ] Each token has an expiry and a subset of the owner's permissions
- [ ] Tokens can be listed and revoked by the owner and by an administrator
- [ ] Requests made with a token are audited as such
- [ ] The asset ingest route accepts a token (see [E13](E13-imports-api-integrations.md))

### E02-13 Break-glass account

**Status:** open · **Priority:** P2 · **Type:** feature

As an administrator, I have one documented emergency account that works when single
sign-on or second factors are unavailable, and every use of it raises an alarm.

**Acceptance criteria**

- [ ] One local account can be marked as break-glass
- [ ] It is exempt from single sign-on but has a long password and its own factor
- [ ] Every sign-in is audited prominently and notified to administrators
- [ ] The procedure is described in the operations runbook

### E02-14 Secure session cookie when served over HTTPS

**Status:** in progress · **Priority:** P1 · **Type:** debt

As a security lead, I want the session cookie marked "secure" whenever the application
is not on the local loopback address. The flag is off by default because the prototype
is served over plain HTTP on the local machine.

**Acceptance criteria**

- [x] The cookie carries the secure flag when the application is served over HTTPS: `GRC_COOKIE_SECURE=auto` (with `GRC_TRUST_PROXY=1` behind a proxy) or `always`; default `off`
- [x] A forwarded-protocol header is believed only when the proxy is declared trusted, with tests
- [ ] The application refuses to start on a non-loopback address without HTTPS (the listen address is fixed to 127.0.0.1 in `server/src/main.ts` today)
- [ ] Depends on [E16-07](E16-hosting-operations-and-hardening.md)

**Implemented in:** `server/src/core/request.ts`; `setSessionCookie` (`server/src/core/auth.ts`); tests "session cookie" in `server/src/core/core.test.ts`

### E02-15 Send a blocked person straight to second-factor set-up

**Status:** open · **Priority:** P1 · **Type:** bug

When the second factor is required and missing, the server refuses everything but
enrolment, and `GET /api/auth/state` says so (`mfaEnrollmentBlocked: true`). The web shell
does not act on it: after sign-in it still loads the overview, whose requests fail, and
the person has to find Account security themselves.

**Acceptance criteria**

- [ ] With `mfaEnrollmentBlocked`, the shell skips loading list metadata and shows only the Account security page and sign-out
- [ ] A `403 mfa_enrolment_required` from any request leads there too
- [ ] Checked in a browser as a blocked user

**Where:** `web/src/core/auth.tsx`, `Shell.tsx`, `api.ts`

### E02-16 Keep the secret key out of the data folder by default

**Status:** open · **Priority:** P2 · **Type:** debt

The generated key file sits beside the database, so a copy of the data folder (and every
`backup`) holds both the encrypted authenticator keys and the key that opens them.

**Acceptance criteria**

- [ ] `backup` leaves the key file out, or the key is generated outside the data folder
- [ ] A command shows where the key comes from and writes a new one
- [ ] `restore` documents how the key is brought back

### E02-17 Enforce the second factor by default on new installations

**Status:** open · **Priority:** P2 · **Type:** improvement

`auth.mfa_enforcement` defaults to `notice` everywhere so that upgrades lock nobody out.
A new installation should start at `required`, with the setup wizard taking the first
administrator through set-up.

**Acceptance criteria**

- [ ] The setup wizard enrols the first administrator and sets `required`
- [ ] Existing installations keep their current value
- [ ] Depends on E02-15
