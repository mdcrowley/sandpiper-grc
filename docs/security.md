# Security

What protects the application today, and what does not yet. This describes a **local
prototype** that listens on `127.0.0.1` only. It has not had an independent security
review or penetration test. Read the "Not yet" section before deciding what to put in it.

Each item below names the file that implements it.

## Implemented today

### Network exposure

- The server listens on `127.0.0.1` only; the address is fixed in `server/src/main.ts`.
- No HTTPS. Traffic never leaves the machine.
- Application code makes no outbound calls: no telemetry, no externally hosted fonts or
  scripts, no email.

### Accounts and passwords

`server/src/core/auth.ts`, `server/src/modules/admin/settings.ts`

- **No default account.** The first administrator is created in the setup wizard, which
  works only while no user exists.
- **Storage.** Passwords are hashed with Argon2id, with a salt per hash, using the
  library's default parameters. Plain passwords are never stored or logged.
- **Policy.**
  - Minimum length 14 by default; an administrator can set it from 12 to 128. Maximum 256.
  - Rejected if on the offline list of common passwords (`common-passwords.txt`; nothing
    is sent to any outside service).
  - Rejected if it contains the username.
  - Rejected if it matches one of the user's last 5 passwords (configurable, 0 to 24).
  - No composition rules and no forced expiry.
- **Changing a password** needs the current password and ends all of that user's sessions;
  the browser in use gets a new one.
- **New users and resets** use a one-time link: random token, only its SHA-256 hash stored,
  valid 24 hours, single use, and replaced when a newer link is issued. Redeeming a reset
  link ends the user's sessions. The administrator passes the link on by hand.
- **Least privilege for new users**: a new user has only the roles the administrator picks.

### Lockout and rate limiting

`server/src/core/auth.ts`, `server/src/modules/admin/account.ts`, `shared.ts`

- **Account lockout.** From the fifth consecutive failure an account is locked for 1
  minute, doubling with each further failure to a ceiling of 15 minutes. A wrong
  authenticator or recovery code counts as a failure. A successful sign-in clears the
  count; an administrator can unlock an account.
- **Sign-in rate limit.** 20 failed sign-ins from one source address in 5 minutes blocks
  further attempts from that address (HTTP 429).
- **One-time links.** 20 failed link attempts from one address in 5 minutes are blocked.
- **Second-factor changes.** 8 failed password or code checks per user in 5 minutes are
  blocked.
- **No account enumeration.** Every sign-in failure returns the same message, and a
  password hash is computed even when the account does not exist so that timing is
  similar.
- Sign-in successes, failures and lockouts are written to the audit log.

The limiters are held in memory: they reset when the server restarts.

### Sessions and time-outs

`server/src/core/auth.ts`, `server/src/modules/admin/account.ts`

- The session token is 32 random bytes. Only its SHA-256 hash is stored in the database,
  so a copy of the database does not yield usable session tokens.
- Cookie `grc_session`: `HttpOnly`, `SameSite=Strict`, path `/`. It is **not** marked
  `Secure`, because the prototype has no HTTPS.
- Absolute lifetime 8 hours. Idle time-out 30 minutes by default; an administrator can
  set it from 5 to 480 minutes.
- The user, their status and their roles are loaded on every request, so disabling a
  user or a role takes effect at once. Disabling a user also deletes their sessions.
- Users can see and end their own sessions; administrators can end a user's sessions.
- Signing out deletes the session on the server.

### Cross-site request forgery (CSRF)

`server/src/core/auth.ts`, `web/src/core/api.ts`

- Every `/api/` request that is not `GET`, `HEAD` or `OPTIONS` must carry the header
  `X-GRC-CSRF: 1`, or it is refused with 403. A page on another site cannot add a custom
  header to a cross-site request without the browser first asking the server's
  permission, and the server grants none (there is no CORS configuration).
- The session cookie is `SameSite=Strict`, so browsers do not send it on cross-site
  requests at all.
- There is no per-session CSRF token. The header is a fixed value.

### Security headers and content security policy

`server/src/app.ts` adds these to every response:

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `same-origin` |
| `Content-Security-Policy` | `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` |

Scripts load only from the application itself; inline scripts are not allowed. Inline
styles are allowed (`'unsafe-inline'` for styles only). There is no
`Strict-Transport-Security` header, because there is no HTTPS.

### Input handling

- All SQL uses parameters. Table and column names built into SQL come from module
  definitions and are checked against an identifier pattern (`server/src/core/resource.ts`).
- Resource input is validated by field type; unknown fields are ignored.
- Request bodies are limited to 10 MB.
- Unexpected errors are logged on the server and returned as a generic message.
- CSV exports of records prefix cells that begin with `=`, `+`, `-`, `@`, tab or carriage
  return, to stop spreadsheet formula injection.

### Authorisation and restricted records

`server/src/core/services.ts`, `server/src/core/resource.ts`, `server/src/core/routes.ts`

- Every `/api/` route needs a session unless explicitly public (health, auth state,
  setup, sign-in, sign-out, one-time links). Routes then check a permission.
- Roles grant permissions of the form `<module>.<action>`, with wildcards. A role that is
  switched off grants nothing.
- **Restricted records.** Risks, security incidents and notification tasks need
  `security.view` in addition to their module permission. Without it they are absent from
  lists, counts, statistics, single reads, exports, global search, record pickers, links,
  reference labels (shown as "Restricted") and the audit search. A direct request for a
  restricted record returns "not found" rather than revealing that it exists.
- An export that contains restricted records ends with a line naming who exported it and
  when.
- **Administrator safeguards** (`server/src/modules/admin/shared.ts`, `roles.ts`): only
  the Administrator role may hold every permission; that role cannot be switched off; and
  a change that would leave no active administrator, or remove the acting administrator's
  own access, is refused.
- Administrative routes all need `admin.administer`, and a test checks each one refuses
  a non-administrator.

### Audit log

`server/src/core/services.ts`, `server/src/core/migrations/001_core.sql`

- Every data change writes an event: who (or "System"), source address, action, record,
  a summary, and before/after values. So do sign-ins and failures, lockouts, password and
  second-factor changes, role and user changes, setting changes, ended sessions and
  exports.
- **Append-only.** A database trigger raises an error on any `UPDATE` or `DELETE` of an
  audit row. The application has no route that edits or removes events.
- Each record's own history is visible to anyone who may see that record. The full audit
  search and its CSV export need `audit.view`.
- Password hashes, second-factor secrets and recovery codes are never written to audit
  events or returned by the user administration API.

Limit: the trigger protects against changes made through SQL. Anyone with access to the
database files, or able to drop the trigger, can still alter history. There is no
separate, tamper-evident copy.

### Second factor

`server/src/core/totp.ts`, `server/src/core/auth.ts`, `server/src/modules/admin/account.ts`

- Time-based one-time passwords (RFC 6238: SHA-1, 6 digits, 30-second step) from any
  authenticator app. One step either side is accepted for clock drift. Codes are compared
  in constant time.
- Enrolment is confirmed with a code before it takes effect.
- Ten single-use recovery codes are issued at enrolment and shown once. Only their
  SHA-256 hashes are stored. A used code is removed.
- Turning the second factor off needs the password and a current code (or a recovery
  code). Issuing new recovery codes needs the password. An administrator can reset a
  user's second factor; all of these are audited.
- A role can be marked as expecting a second factor (Administrator and Security lead are
  by default), and a setting can expect it of everyone. **This produces a notice only; it
  does not block sign-in or access.**

## Not yet

These are known and listed in [Known gaps](known-gaps.md). Treat them as reasons not to
put the prototype on a network or to hold sensitive real records in it.

**Sign-in**

- Second factor is not enforced, and a code can be replayed within its validity window.
- Second-factor secrets are stored in the database without field-level encryption.
- No single sign-on (OpenID Connect or SAML), no passkeys, no break-glass account.
- No re-authentication before administrative actions.
- Setup and reset links are shown to the administrator to pass on; there is no email.

**Platform**

- No HTTPS; the session cookie is not `Secure`; no HSTS.
- Rate limiters are in memory: they reset on restart and would not work across several
  processes. Source addresses are taken from the connection; nothing is configured for
  running behind a proxy.
- No encryption at rest by the application. The `data\` and `backups\` folders hold
  everything, including password hashes and second-factor secrets.
- No scheduled backup and no restore command.
- No access log, no alerting, no log retention. Server logs are overwritten at each start.
- No retention settings: records and audit events are kept indefinitely.
- No personal access tokens or API keys (and so no way to revoke them).

**Access control details**

- Lookup list names and labels are visible to every signed-in user through `/api/meta`.
- Titles of actions linked to a restricted risk are visible to anyone who can see actions.
- The "agents only" audience on knowledge articles is not enforced.
- The CSV export of the audit log does not neutralise formula characters as record
  exports do. Open it with care.

**Assurance**

- No independent security review, penetration test, dependency audit in continuous
  integration, load test or accessibility audit.
- Non-administrator roles have been exercised by automated API tests, not in a browser.

## Reporting a vulnerability

> **Maintainer: replace this paragraph with your contact details** (a monitored email
> address or private reporting channel, and how quickly reporters can expect a reply)
> before sharing this repository.

Until then, if you find a security problem:

- Do not open a public issue and do not include real data in a report.
- Tell the person who gave you access to the repository, privately.
- Include what you did, what you expected, what happened, and the version (commit) you
  tested.
