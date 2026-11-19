# Security

What protects the application today, and what does not yet. This describes a **local
prototype** that listens on `127.0.0.1` only. It has not had an independent security
review or penetration test. Read the "Not yet" section before deciding what to put in it.

Each item below names the file that implements it.

## Implemented today

### Network exposure

- The server listens on `127.0.0.1` only; the address is fixed in `server/src/main.ts`.
- No HTTPS. Traffic never leaves the machine.
- **Behind a proxy (configuration, off by default).** Two environment variables prepare for
  running behind one trusted HTTPS reverse proxy (`server/src/core/request.ts`):
  - `GRC_COOKIE_SECURE` = `off` (default), `auto` or `always`. `auto` marks the session
    cookie `Secure` when the request arrived over HTTPS; `always` marks it every time.
  - `GRC_TRUST_PROXY=1` makes the server believe the proxy's `X-Forwarded-Proto` (for
    `auto`) and the last address in `X-Forwarded-For` (for rate limits, sessions and the
    audit log). Leave it off unless a proxy you control sets those headers: without a
    proxy, anyone could forge them.
- Application code makes no outbound calls: no telemetry, no externally hosted fonts or
  scripts, no email. The one exception is **outbound webhooks**, which send nothing until
  an administrator switches on `integrations.outbound_enabled` and lists the receiving
  hosts (see "Outbound webhooks" below).

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

`server/src/core/auth.ts`, `server/src/core/ratelimit.ts`, `server/src/modules/admin/account.ts`

- **Account lockout.** From the fifth consecutive failure an account is locked for 1
  minute, doubling with each further failure to a ceiling of 15 minutes. A wrong
  authenticator or recovery code counts as a failure. A successful sign-in clears the
  count; an administrator can unlock an account.
- **Sign-in rate limit.** 20 failed sign-ins from one source address in 5 minutes blocks
  further attempts from that address (HTTP 429).
- **One-time links.** 20 failed link attempts from one address in 5 minutes are blocked.
- **Second-factor changes.** 8 failed password or code checks per user in 5 minutes are
  blocked.
- **Password confirmation.** 8 failed confirmations per user in 5 minutes are blocked.
- **No account enumeration.** Every sign-in failure returns the same message, and a
  password hash is computed even when the account does not exist so that timing is
  similar.
- Sign-in successes, failures and lockouts are written to the audit log.

The limiters count failures in the database (table `rate_limit_hits`), so a restart does
not reset them and every process using the same database shares them. Entries are removed
once they fall outside the window.

### Sessions and time-outs

`server/src/core/auth.ts`, `server/src/modules/admin/account.ts`

- The session token is 32 random bytes. Only its SHA-256 hash is stored in the database,
  so a copy of the database does not yield usable session tokens.
- Cookie `grc_session`: `HttpOnly`, `SameSite=Strict`, path `/`. By default it is **not**
  marked `Secure`, because the prototype has no HTTPS; set `GRC_COOKIE_SECURE` (see
  "Network exposure") when it is served over HTTPS.
- Absolute lifetime 8 hours. Idle time-out 30 minutes by default; an administrator can
  set it from 5 to 480 minutes.
- The user, their status and their roles are loaded on every request, so disabling a
  user or a role takes effect at once. Disabling a user also deletes their sessions.
- Users can see and end their own sessions; administrators can end a user's sessions.
- Signing out deletes the session on the server.

### Password confirmation before sensitive administrative actions

`requireRecentAuth` in `server/src/core/auth.ts`; `sensitive` in
`server/src/modules/admin/shared.ts`; prompt in `web/src/modules/admin/reauth.ts`

So that an unattended, signed-in browser cannot be used to change who can do what, these
actions need the password to have been proved **in the same session within the last 10
minutes** (setting `auth.reauth_minutes`, 1 to 60):

- creating a role; changing a role's permissions, its on/off switch or its
  "second factor required" flag; applying default permissions;
- creating a user; changing a user's roles;
- resetting a user's second factor; issuing a setup or password-reset link;
- changing any sign-in, API-token or outbound-connection setting (every setting whose key
  starts with `auth.`, `tokens.` or `integrations.`);
- creating a personal access token;
- adding a webhook, changing its address or switching on "include restricted records",
  and replacing its secret;
- removing a record for good from the retention review.

Signing in counts as proof. After that the server answers `403 reauth_required`; the
administration screens then ask for the password in place (`POST /api/auth/confirm`) and
carry on with the action. Each refusal, each wrong password and each successful
confirmation is audited (`reauth.required`, `reauth.failure`, `reauth.success`).

Not covered: editing a user's name, email or department, disabling or unlocking an
account, ending sessions, departments, configurable lists and non-security settings. The
confirmation is the password only; it does not ask for the second factor.

### Personal access tokens

`server/src/core/tokens.ts`, `server/src/core/auth.ts`,
`server/src/core/migrations/003_platform_services.sql`

For scripts and other tools that call the API without a browser.

- **Created by the person themselves** (`POST /api/me/tokens`), after a recent password
  confirmation. Each token has a name, a list of permissions ("scopes", such as
  `tickets.view`, `assets.*`) and a **required** expiry no later than `tokens.max_days`
  (default 365, 1 to 3650). A person can only ask for permissions they hold.
- **Shown once.** The token (`grc_pat_` followed by 32 random bytes) is returned only in
  the response that creates it. Only its SHA-256 hash is stored, with its first few
  characters so a person can tell their tokens apart.
- **Used as** `Authorization: Bearer <token>` on `/api/` routes. A request that carries an
  `Authorization` header never falls back to the session cookie and needs no
  `X-GRC-CSRF` header: a browser cannot be made to add that header to a cross-site
  request.
- **Never more than the owner.** On every request the token acts with the permissions
  its scopes and its owner's current grants have in common. Removing a role from the
  owner, or disabling the owner, takes effect at once. Restricted-record rules apply as
  for the owner's session.
- **Never for account security.** A token is refused (`403 token_not_allowed`) on every
  `/api/auth/...` route except `/api/auth/state` (sign-in, password change, second factor,
  sessions, password confirmation), on `/api/setup`, and on token management
  (`/api/me/tokens`, `/api/admin/tokens`). A token cannot confirm a password, so it can
  never perform the sensitive actions listed above.
- **Rate-limited.** `tokens.rate_per_minute` (default 600) requests a minute per token
  (`429 rate_limited`). Wrong, expired or revoked tokens count as failures against the
  source address: 20 in 5 minutes block that address. Each refusal is audited
  (`token.refused`).
- **Audited as such.** Every change made with a token names the token in its audit
  event (`audit_events.token_id`, `token_name`, shown in a record's History), and each
  successful non-read request also writes a `token.use` event.
- **Listing and revoking.** A person lists and revokes their own tokens (with when each
  was last used, and from which address); an administrator lists and revokes anyone's
  (`/api/admin/tokens`). Creation and revocation are audited.

Limits: a token cannot be narrowed to particular records or source addresses, and the
per-token request count is kept in memory (a restart resets the current minute).

### Outbound webhooks

`server/src/core/webhooks.ts`

The only outbound connection the application makes. Fenced in three ways:

1. **Off by default.** Nothing is queued or sent unless the setting
   `integrations.outbound_enabled` is on. Switching it off again stops deliveries already
   queued (they are recorded as `blocked`).
2. **Allow-list.** A delivery goes only to a host listed in `integrations.allowed_hosts`
   (`host`, `host:port` or `*.domain`); anything else is recorded as `blocked`. Redirects
   are never followed, and each attempt times out after 10 seconds.
3. **Restricted records stay in.** Events about restricted records are not sent unless
   the webhook has "include restricted records" switched on, which only a person holding
   `security.view` can do, and which stops applying if the person who switched it on no
   longer holds `security.view`.

Webhooks are managed by administrators only, and changing a webhook's address or
restricted-records choice needs a recent password confirmation. Each delivery is signed:
`X-GRC-Signature: sha256=<hex HMAC-SHA256(secret, timestamp + "." + body)>`, with the
timestamp (seconds) in `X-GRC-Timestamp`; a receiver should check both and refuse old
timestamps. The secret is shown once, stored encrypted with the application key
(`core/secretbox.ts`) and can be replaced. Deliveries are rows in `webhook_deliveries`
(a table-backed queue that survives a restart), retried after 1, 5, 30, 120 and 720
minutes, and listed with their outcome for administrators. Every change to a webhook is
audited; the delivery log is its own record of what was sent.

### Retention and the one hard delete

`server/src/core/retention.ts`

An administrator sets a retention period per record type. A daily check flags records
past their period for review; **it never deletes anything**. Removing a flagged record
for good is the only hard delete in the application: it needs `admin.administer`, a
reason, an explicit confirmation and a recent password confirmation; it is refused while
the record still has files attached; it removes the record with its comments, tags,
watchers, links and search entry; and it is audited (`retention.delete`). Its audit
history is kept.

### Cross-site request forgery (CSRF)

`server/src/core/auth.ts`, `web/src/core/api.ts`

- Every `/api/` request that is not `GET`, `HEAD` or `OPTIONS` must carry the header
  `X-GRC-CSRF: 1`, or it is refused with 403. (Requests made with a personal access
  token are exempt; see above.) A page on another site cannot add a custom
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
- Typed amounts may carry any currency symbol, the configured currency code and thousands
  separators; nothing else is stripped.
- Unexpected errors are logged on the server and returned as a generic message.
- CSV exports of records and of the audit log prefix cells that begin with `=`, `+`, `-`,
  `@`, tab or carriage return, to stop spreadsheet formula injection.

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
- **Inherited restriction.** A record type can take its restriction from the record it
  arose from (`restrictedFrom` in a resource definition). Actions do: an action raised on
  a risk, a security incident or any record flagged restricted is itself restricted, and
  is hidden in the same places, including the action tracker's summary counts. The flag
  is set by the server (a caller cannot set or clear it), follows the action if it is
  moved to another source record, follows the source if its own restriction changes, and
  is repaired for existing rows at every start. A person cannot raise an action on, or
  move one to, a record they cannot see.
- **Hand-written queries** over a record table use `ctx.resources.visibleWhere(type, user)`
  to get the same condition as the generated routes.
- **Labels of referenced records** are shown only to people who hold view on the
  referenced record's module; others see "Restricted".
- **Audit search.** Events about restricted record types, and about individual records
  flagged restricted (for example a restricted action), are left out for people without
  `security.view`.
- **Configurable lists.** The names and labels of a list are returned (`GET /api/meta`,
  `GET /api/lookups/:list`) only to people who may view a record type with a field that
  uses the list, or who hold view on the module that owns it
  (`ctx.lookups.ensure(list, values, { module })`), or when the list is marked public.
  The lists of a restricted module (security incidents, risks) therefore need
  `security.view`. A list with no owner that no record type uses can be read by
  administrators only; the server names such lists in its log at start-up.
- An export that contains restricted records ends with a line naming who exported it and
  when.
- **Administrator safeguards** (`server/src/modules/admin/shared.ts`, `roles.ts`): only
  the Administrator role may hold every permission; that role cannot be switched off; and
  a change that would leave no active administrator, or remove the acting administrator's
  own access, is refused.
- **Default roles are never changed behind an administrator's back.** A new version may
  add permissions to a default role; an existing database gets them only when an
  administrator applies them on the Roles page (`GET /api/admin/roles/default-grants` to
  see, `POST /api/admin/roles/sync-default-grants` to apply; audited as
  `role.sync_defaults`). Applying only adds. A default permission removed by an
  administrator after a sync is not offered again. On a database from before this
  feature, the first sync offers every default the role does not hold, including any an
  administrator had removed on purpose: read the list before applying.
- **The Approver role does not accept risks.** Seeing a risk needs `security.view`, which
  would also open every security incident, so the default Approver role has no risk
  permission. A risk acceptance is recorded by someone who can see the risk and names
  the approver.
- Administrative routes all need `admin.administer`, and a test checks each one refuses
  a non-administrator.

### Audit log

`server/src/core/services.ts`, `server/src/core/migrations/001_core.sql`

- Every data change writes an event: who, source address, action, record, a summary, and
  before/after values. Events written by the application itself (seeding, timers,
  start-up repairs) carry the actor "System" and no address. Events from a request with
  nobody signed in (a failed sign-in, a refused one-time link) carry no actor and the
  source address; the audit screen shows them as "Not signed in". So do sign-ins and failures, lockouts, password and
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

`server/src/core/totp.ts`, `server/src/core/auth.ts`, `server/src/core/secretbox.ts`,
`server/src/modules/admin/account.ts`

- Time-based one-time passwords (RFC 6238: SHA-1, 6 digits, 30-second step) from any
  authenticator app. One step either side is accepted for clock drift. Codes are compared
  in constant time.
- **Each code works once.** The time step of the last accepted code is stored per user
  (`users.totp_last_step`); a code from that step or an earlier one is refused, at
  sign-in, at enrolment and when turning the factor off.
- Enrolment is confirmed with a code before it takes effect.
- Ten single-use recovery codes are issued at enrolment and shown once. Only their
  SHA-256 hashes are stored. A used code is removed.
- Turning the second factor off needs the password and a current code (or a recovery
  code). Issuing new recovery codes needs the password. An administrator can reset a
  user's second factor; all of these are audited.
- A role can be marked as expecting a second factor (Administrator and Security lead are
  by default), and a setting can expect it of everyone (`auth.mfa_required_for_all`).
- **Enforcement** is a setting, `auth.mfa_enforcement`:

  | Value | Effect on a person who is expected to have a second factor and has none |
  |---|---|
  | `off` | Nothing |
  | `notice` (default) | A reminder on every page; nothing is blocked |
  | `required` | After sign-in they can reach only their own account state, the account security page's routes (set up the factor, change password, list own sessions) and sign-out. Every other `/api/` request is refused with `403 mfa_enrolment_required` |

  The default is `notice` so that upgrading an existing installation does not lock anyone
  out. **Set it to `required` before real records are entered.** An administrator must
  have their own second factor before they can choose `required`. A grace period
  (`auth.mfa_grace_days`, 0 to 30, default 0) lets a person keep working for that many
  days from their first request made while the factor is required.

#### Authenticator keys are encrypted

`server/src/core/secretbox.ts`

- Each key is stored as `enc:v1:<iv>:<tag>:<ciphertext>`: AES-256-GCM with a random
  12-byte iv, bound to the user it belongs to (a ciphertext copied onto another user's row
  does not decrypt). `v1` is the format version.
- The 32-byte encryption key comes from, in order: the environment variable
  `GRC_SECRET_KEY` (64 hex characters or base64); the file named by `GRC_SECRET_KEY_FILE`;
  or `secret.key` in the data folder, which is generated on first start.
- Keys stored in the clear by an earlier version are encrypted at the next start
  (audited as `mfa.secrets_encrypted`).
- **Back the key up, separately.** Without it, nobody with a second factor can sign in
  with their authenticator code: they would need a recovery code or an administrator
  reset. With the default key file, the key sits in the data folder, so `grc.ps1 backup`
  copies it **together with** the database, and a backup then contains everything needed
  to read the authenticator keys. To keep backups free of usable keys, supply the key
  through `GRC_SECRET_KEY` or point `GRC_SECRET_KEY_FILE` at a path outside the data and
  backup folders, and keep a copy of the key somewhere else that is safe.
- **Changing the key.** Start the server with the new key in `GRC_SECRET_KEY` (or the
  key file) and the old one in `GRC_SECRET_KEY_PREVIOUS` (comma-separated if several).
  Every stored key is re-encrypted with the new key at start-up; after one successful
  start the old key can be removed from the configuration.
- Recovery codes and passwords are hashed, not encrypted, and are unaffected.

## Not yet

These are known and listed in [Known gaps](known-gaps.md). Treat them as reasons not to
put the prototype on a network or to hold sensitive real records in it.

**Sign-in**

- Second-factor enforcement is off by default (`notice`); an administrator has to switch
  it to `required`. When a blocked person signs in, the web application does not yet
  take them straight to the enrolment page: they see errors until they open Account
  security themselves.
- Password confirmation before sensitive actions asks for the password only, not the
  second factor, and covers the administration screens only.
- No single sign-on (OpenID Connect or SAML), no passkeys, no break-glass account.
- Setup and reset links are shown to the administrator to pass on; there is no email.

**Platform**

- No HTTPS in the application itself and no HSTS header. The `Secure` cookie flag and the
  proxy settings exist but are off by default, and the server does not refuse to start on
  a non-loopback address without them (it only ever binds to 127.0.0.1 today).
- No encryption at rest by the application apart from authenticator keys. The `data\`
  and `backups\` folders hold everything else in the clear, including password hashes,
  and by default the key file that protects the authenticator keys.
- No scheduled backup and no restore command.
- No access log, no alerting, no log retention. Server logs are overwritten at each start.
- Retention flags records for review but nothing anonymises them, and audit events are
  kept indefinitely (`retention.audit_months` is recorded, not enforced).
- Personal access tokens cannot be limited to source addresses or particular records.
- Webhook receivers' addresses are checked by host name only: an allowed name that
  resolves to an internal address is still called. Keep the allow-list to names you control.

**Access control details**

- The `dashboards`, `reports` and `portal` permissions can be granted but nothing checks
  them: the overview shows each panel by its own module's permission, and there is no
  report builder or portal yet.
- The "agents only" audience on knowledge articles is not enforced.
- Opening a ticket list also runs the service-level sweep, so a read request can write
  breach flags and system audit events.
- A project item can be escalated to a risk by someone with `projects.edit` who cannot
  see risks; they get back only the new risk's id and reference.
- The modules added most recently (change enablement, policies, training, exercises,
  vulnerabilities, attachments, notifications, reports) have had one code review for
  permission, restriction, count-leak, audit and SQL-identifier gaps. Attachments,
  notifications and training were clean; the open findings have gone to those modules'
  owners (for example change approvals counted by typed name, and risk acceptance on a
  vulnerability through an unapproved exception).
- The retention review list counts flagged records of a type the reviewer may view even
  when individual rows are flagged restricted (labels are still hidden).

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
