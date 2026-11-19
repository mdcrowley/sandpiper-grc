# Security

What protects the application today, and what does not yet. This describes a
**prototype** that listens on `127.0.0.1` only unless it is configured otherwise. It has
not had an independent security review or penetration test. Read the "Not yet" section
before deciding what to put in it.

Each item below names the file that implements it.

## Implemented today

### Network exposure

`server/src/core/http.ts`, `server/src/core/request.ts`, `server/src/main.ts`

- **Loopback by default.** The server listens on `127.0.0.1` unless `GRC_HOST` names
  another address. Plain HTTP on an address other machines can reach is **refused at
  start-up** unless HTTPS is configured or `GRC_ALLOW_INSECURE=1` declares that a proxy
  terminating HTTPS sits in front.
- **HTTPS.** With `GRC_TLS_CERT` and `GRC_TLS_KEY` (PEM files) the server speaks HTTPS
  itself. Responses that went out over HTTPS carry `Strict-Transport-Security`
  (`GRC_HSTS_MAX_AGE`, default one year; `0` switches it off).
- **Behind a reverse proxy.** `GRC_TRUST_PROXY` says whose `X-Forwarded-For`, `-Proto` and
  `-Host` headers to believe: a comma-separated list of addresses, CIDR ranges and the
  words `loopback`, `private` and `linklocal` (recommended), or a number of proxy hops.
  Unset, forwarded headers are ignored. Set it only for a proxy you control: otherwise
  anyone could forge the client address used for rate limits, sessions and the audit log.
- **Secure cookie.** `GRC_COOKIE_SECURE` = `off`, `auto` or `always`. When it is not set it
  is `auto` (the cookie is marked `Secure` whenever the request arrived over HTTPS) on an
  HTTPS server or behind a trusted proxy, and `off` otherwise.
- **Outbound connections are off until an administrator switches one on.** There is no
  telemetry and there are no externally hosted fonts or scripts. The application connects
  out only to: webhook receivers (see "Outbound webhooks"), a mail server (once email is
  set up), a sign-in provider (once switched on, or on **Test connection**), a ClamAV
  scanner and an S3-compatible object store (each once chosen; see "Files").

See [Installation](installation.md#server-installation) for setting these up.

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
  link ends the user's sessions. The administrator is shown the link to pass on; when email
  is set up it is also emailed to the person, and people can ask for their own reset link
  ("Forgot your password?"; valid 60 minutes by default and rate-limited), with the same
  answer whether or not the account exists.
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
- Cookie `grc_session`: `HttpOnly`, `SameSite=Strict`, path `/`. It is marked `Secure`
  on HTTPS requests when the server serves HTTPS or sits behind a trusted proxy (see
  "Network exposure"); on plain HTTP on `127.0.0.1` it is not.
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
- removing a record for good from the retention review;
- adding, changing or removing a sign-in provider; a person's sign-in limits, link permissions,
  unlinking and the break-glass designation; linking or unlinking one's own provider;
- changing the mail server, the malware-scanning, storage and removed-file settings, the
  backup settings or AI assistant access; making a token for an AI assistant.

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
styles are allowed (`'unsafe-inline'` for styles only). `Strict-Transport-Security` is
added to responses sent over HTTPS (see "Network exposure").

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
- **Restricted records.** Risks, security incidents, notification tasks and vulnerability
  findings need `security.view` in addition to their module permission. Without it they
  are absent from lists (and the totals of those lists), single reads, exports, global
  search, record pickers, links, reference labels (shown as "Restricted") and the audit
  search. A direct request for a restricted record returns "not found" rather than
  revealing that it exists. Figures follow their own rule (below).
- **Inherited restriction.** A record type can take its restriction from the record it
  arose from (`restrictedFrom` in a resource definition). Actions do: an action raised on
  a risk, a security incident or any record flagged restricted is itself restricted, and
  is hidden in the same places. The flag is set by the server (a caller cannot set or
  clear it), follows the action if it is moved to another source record, follows the
  source if its own restriction changes, and is repaired for existing rows at every
  start. A person cannot raise an action on, or move one to, a record they cannot see.
  Safety events flagged as holding personal information are restricted the same way.
- **Hand-written queries** that return records use `ctx.resources.visibleWhere(type, user)`
  to get the same condition as the generated routes. Queries that return figures do not
  (see below).

### Figures are the same for everyone

`server/src/core/resource.ts` (`GET {path}/stats`), `server/src/modules/reports/spec.ts`,
`server/src/modules/safety/indicators.ts`, `server/src/modules/risks/index.ts`
(`/api/actions/summary`)

**Rule: people never see different numbers.** Every figure the application shows (tiles,
totals, counts, rates, percentages, heat-map cells, chart series, report and dashboard
figures, scheduled deliveries, "needs attention" counts, summary endpoints) has one value,
whoever looks at it. Restricted records count in every figure. Who may see a figure *at
all* is still decided by permissions: someone without `risks.view` gets no risk summary,
and a report on a wholly restricted record type needs `security.view`.

Why: two people in the same meeting reading different totals for the same thing (open
actions, safety events this month) is worse than useless; it undermines every figure
the organisation reports. Restriction exists to protect what a record *says* and *who*
it concerns, not the fact that it is there: a safety manager may not read a restricted
event, but the monthly count of events must still be right. This rule replaces the
earlier one that left restricted records out of counts for people without
`security.view` "where a count of one would reveal that a record exists".

What still protects details in a figure:

- **Details are masked, for everyone.** Words and people (text, long-text and person
  fields, and fields reached through them) are a record's details. A figure that groups
  by such a field puts restricted records under **Restricted records** instead of their
  value, for every viewer, administrators included, so the figure is still the same for
  all. Categories (lists such as status or severity), yes/no fields, numbers, dates and
  references to other records are grouped by their value. Whether a detail is blank (an
  action with no owner) still counts.
- **A figure cannot be used to search details.** A search, or a condition on words or
  people (in `GET {path}/stats` or a report), never matches a restricted record, for
  anyone. Without this, "how many actions mention this person's name?" would read a
  restricted record one word at a time.
- **Labels stay protected.** A figure grouped by a reference to a restricted record
  labels it "Restricted" for people who may not see it; the count is the same.
- **A figure about "me"** (a report filtered on "me", the "mine" counts on the action
  tracker) is the viewer's own, not a shared figure, and keeps the list rule.
- **Lists keep filtering.** A list of records, its total, a drill-down from a figure,
  record pages, search, exports, pickers and the record rows of a report or a dashboard
  list widget show only what the viewer may see. So a figure can be larger than the list
  behind it; the difference is the restricted records the viewer may not open.
- **Exports of figures carry no watermark** (they hold no restricted details); a report
  of record rows that includes restricted records does, as before, and a stored copy of
  it opens only for people with `security.view`.
- Knowledge articles for IT agents only follow the same rule in `GET /api/knowledge/stats`:
  they count for everyone, unless the question searches or groups by their words, when
  they are left out for everyone.
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

  On a **new installation** the setup wizard sets it to `required` unless the person
  completing the wizard chooses otherwise (`core/webauthn/setup-default.ts`), and takes the
  first administrator straight to enrollment. The setting's own default stays `notice`, so
  upgrading an existing installation does not lock anyone out, and a setup made through
  the API without a choice also keeps `notice`. **Set it to `required` before real records
  are entered.** An administrator must have their own second factor (an authenticator app
  or a passkey) before they can choose `required`. A grace period
  (`auth.mfa_grace_days`, 0 to 30, default 0) lets a person keep working for that many
  days from their first request made while the factor is required.

#### Authenticator keys and other secrets are encrypted

`server/src/core/secretbox.ts`, `server/src/core/secretkey.ts`

- Each key is stored as `enc:v1:<iv>:<tag>:<ciphertext>`: AES-256-GCM with a random
  12-byte iv, bound to the user it belongs to (a ciphertext copied onto another user's row
  does not decrypt). `v1` is the format version. Webhook secrets, sign-in provider client
  secrets and the mail server password are encrypted the same way with the same key.
- The 32-byte encryption key (the **secret key**) comes from, in order: the environment
  variable `GRC_SECRET_KEY` (64 hex characters or base64); the file named by
  `GRC_SECRET_KEY_FILE`; or a file **beside** the data folder, named after it and
  generated on first start: for the data folder `C:\grc\data` it is
  `C:\grc\data.secret.key`. A copy of the data folder, or a `grc.ps1 backup`, therefore
  holds the encrypted values but not their key.
- An installation from before this change kept the key at `secret.key` inside the data
  folder. At start-up that file is moved beside the data folder (copied, read back and
  compared, then deleted).
- Keys stored in the clear by an earlier version are encrypted at the next start
  (audited as `mfa.secrets_encrypted`).
- **Back the key up, separately.** Without it, nobody with a second factor can sign in
  with their authenticator code: they would need a recovery code or an administrator
  reset. Keep a copy of the key somewhere safe, apart from the backups. An encrypted
  backup can carry it on request (`backup -Encrypt -IncludeSecretKey`).
- **Seeing and changing the key.** `npx tsx server/src/core/secretkey-cli.ts show` says
  where the key comes from (it prints a short fingerprint, never the key). `rotate`, with
  the server stopped, writes a new key and keeps the old one as a retired key. Retired keys
  can also be given in `GRC_SECRET_KEY_PREVIOUS` (comma-separated). Authenticator keys are
  re-encrypted with the new key at the next start. Other secrets (webhook, provider and
  mail-server secrets) are not yet: they stay readable only while the retired key is still
  supplied, so keep it until they have been replaced.
- Recovery codes and passwords are hashed, not encrypted, and are unaffected.

### Passkeys and security keys

`server/src/core/webauthn/`, `web/src/modules/account-keys/`

- **WebAuthn**, built on Node's own crypto (no extra package). A passkey or hardware
  security key can be a person's second factor in place of the six-digit code, or, while
  `auth.passkey_sign_in` is on (the default), sign them in on its own. Signing in with a
  passkey alone goes through the same sign-in policy hooks as a password, so per-person
  limits and switched-off passwords apply.
- **Checks.** Each registration and sign-in uses a single-use challenge that expires after
  5 minutes; the origin, the relying-party ID and the signature are checked every time.
  Accepted algorithms are ES256, EdDSA and RS256. A signature counter that does not go up
  is refused, as it can mean a copied key. `auth.passkey_user_verification` = `required`
  makes every use check a PIN or biometric (default `preferred`).
- **Attestation is not verified.** Checking it would need the makers' root certificates
  from an outside service, and would tell only the make of the key, not who holds it.
- **Where passkeys are bound.** `GRC_WEBAUTHN_RP_ID` (a host name) and
  `GRC_WEBAUTHN_ORIGINS` (comma-separated origins) default to the address the request was
  sent to. Set both whenever the application is reached through a proxy or by more than
  one name, so that a forged `Host` header cannot change them. Browsers refuse IP
  addresses, so on one machine use `http://localhost:8080`, not `http://127.0.0.1:8080`.
- A person can hold up to 10 keys; adding, renaming and removing them is audited.

### Sign-in providers (single sign-on)

`server/src/core/identity/` (protocol and policy), `server/src/modules/admin/sso.ts` and
`providers.ts` (routes), `server/src/modules/admin/migrations/001_identity.sql`

- **OpenID Connect, any compliant provider.** Issuer, client and claims are entered by an
  administrator; every endpoint comes from the issuer's discovery document, whose `issuer`
  must match exactly. Nothing is hard-coded, so commercial, government and sovereign cloud
  tenants and self-hosted servers are configured the same way. Providers sit behind a driver
  interface (`core/identity/types.ts`): a redirect-style driver (OpenID Connect; SAML would be
  another) or a credentials-style driver (a directory over LDAP, not built). Everything after
  "the provider says this is subject X" is shared.
- **Off until switched on.** A provider that is not switched on is never contacted. The only
  other outbound call is **Test connection**, made when an administrator selects it. Calls go
  over `https` only (plain `http` only to the loopback address), never follow redirects, time
  out after 10 seconds and are size-limited.
- **The flow.** Authorisation code with PKCE (S256), a random `state` bound to the browser by a
  short-lived `HttpOnly`, `SameSite=Lax` cookie (needed because the provider sends the browser
  back cross-site) and single-use in the database, and a `nonce` checked in the ID token. The
  nonce and PKCE verifier are stored encrypted with the application key and expire after 10
  minutes. The callback address is per provider, and an `iss` response parameter (RFC 9207)
  must match.
- **ID token checks, with Node's own crypto (no extra package).** Signatures RS256, PS256
  (2048-bit keys or more) and ES256 only, never `none` or HMAC; the key is chosen from the
  provider's key set by `kid`, with use and type checked. The key set is cached for an hour and
  fetched again when an unknown key id appears (key rotation, at most once a minute). Claims:
  issuer, audience (and `azp` with several audiences), expiry, issue time (not in the future,
  not older than 10 minutes, 2 minutes' clock tolerance), `nbf` and nonce.
- **Client secret** stored encrypted with the application key (`core/secretbox.ts`, bound to the
  provider), never returned by the API.
- **Accounts.** A returning person is found by provider and subject. A first sign-in whose
  *verified* email matches an account is not linked until the account's password is also given
  (or an administrator allowed it in advance for that provider, for 7 days). Linking from
  Account security needs a recent confirmation and the provider's verified email to equal the
  account's. Just-in-time account creation and group-to-role mapping are both **off** by
  default; account creation is limited to listed email domains; mapping only touches roles that
  a rule names and never leaves nobody able to administer. An email claim other than `email`, or
  one without `email_verified`, is trusted only when the administrator says so.
- **Per-person limits and passwords off.** A person can be limited to chosen ways of signing in.
  The setting `auth.local_signin` switches passwords off for everyone except the break-glass
  account; it can be switched off only when a break-glass account exists and every other active
  person has an identity at a switched-on provider. The rules are applied by sign-in policy
  hooks (`core/identity/hooks.ts`) that password and passkey sign-in both consult.
- **Break-glass account.** Exactly one (a unique index), an active administrator with a password
  and no linked identity. It always signs in with its password (and second factor), never
  through a provider. Every sign-in writes `signin.break_glass`, notifies every administrator in
  the application and, when email is on, by email, and marks the session, whose Account security
  page shows a red notice. It cannot be disabled, lose administrator access or lose the
  designation while passwords are off.
- **Audit.** Sign-ins (naming the provider), failures with the reason, provider changes and
  tests, links, unlinks, link permissions, per-person limits and break-glass changes, each with
  time and source address. Failures count against the same per-address sign-in limit as
  passwords.
- **Unlinking** needs a recent confirmation (a password, or signing in at the provider again),
  ends the other sessions made through that provider, and never removes a person's last way in.
- **SAML 2.0 is not built**, on purpose: it cannot be done safely without an XML-signature
  implementation (see E02-10).

### AI assistant access (MCP)

`server/src/modules/mcp/`; details in [AI assistant access](mcp.md)

- **Off by default.** The `/mcp` endpoint answers only once an administrator switches on
  `mcp.enabled` (Administration > AI assistant access). These settings are not on the
  general Settings screen, need a signed-in session with a recent password confirmation,
  and can never be changed with a token.
- **Token only.** A request must carry a personal access token in the `Authorization`
  header; cookies are ignored, so a web page cannot drive the endpoint. The token must
  carry the scope `mcp.use` (or `mcp.*`); `*` alone is not enough. Assistant tokens are
  made by a signed-in person after a recent password confirmation, never with a token.
- **Origin check.** A request carrying an `Origin` header is refused unless that origin is
  listed in `mcp.allowed_origins` (empty by default). MCP clients send no `Origin`.
- **As the person, never more.** Every tool calls the application's own `/api` routes
  in-process with the same token, so permissions, restricted records, validation and audit
  are exactly the REST API's. Tools that change records are offered only when
  `mcp.write_enabled` is on and the token's permissions include a `.create` or `.edit`.
  **Nothing can be deleted** through MCP. `mcp.allowed_tools` narrows the tools offered.
- **Rate-limited** per token (`mcp.rate_per_minute`, default 120), on top of the general
  token limit.
- **Audited.** Each change names the token, and each write tool adds an `mcp.write` event
  that reads "... via MCP (tool ...) with API token ..." in the record's History. Every
  call is logged without its arguments or results and kept for 90 days.

### Files: malware scanning, storage and purge

`server/src/modules/attachments/` (`clamd.ts`, `s3.ts`, `housekeeping.ts`)

- **Malware scanning (off by default).** When switched on, every new file is sent to a
  ClamAV scanning service (`clamd`) before it is accepted. A file found to contain malware
  is refused, its content deleted and the refusal audited. When the scanner cannot be
  reached, an administrator chooses whether to refuse the file or accept it marked
  **Not scanned**. Earlier files can be scanned later; one found to contain malware is
  removed and every administrator is notified. Run `clamd` on the same machine or one you
  control: each file's content is sent to it.
- **Checksums.** Every file's SHA-256 is recorded, and a file whose content has changed
  since it was attached is not sent.
- **Object store (optional).** New files can go to an S3-compatible object store instead
  of the data folder. Its secret key is stored encrypted, or read from a file or the
  environment (`GRC_S3_ACCESS_KEY_ID`, `GRC_S3_SECRET_ACCESS_KEY`).
- **Purge.** A removed file keeps its content for a period an administrator sets, then a
  daily job deletes it; until then it can be put back. Every purge is audited.

### Backups

`server/src/ops/backup.ts`, `server/src/ops/archive.ts`; details in
[Operations](operations.md#backup)

- Every backup is checked against its checksums before it is reported as done, and
  `restore` verifies a backup before replacing anything.
- **Encrypted backups and exports** (`-Encrypt`) are one file, AES-256-GCM in chunks, keyed
  by a 32-byte key file or a passphrase (scrypt). An encrypted backup writes nothing
  unencrypted on the way. A key file inside the data folder is refused. Without the key, nobody can read the
  backup.

## Not yet

These are known and listed in [Known gaps](known-gaps.md). Treat them as reasons not to
put the prototype on a network or to hold sensitive real records in it.

**Sign-in**

- The second factor is required from the start only on a new installation set up through
  the wizard. An existing installation stays at `notice` until an administrator switches
  it to `required`.
- Passkeys and security keys have been checked with a virtual authenticator in the
  browser, not yet with hardware keys over real HTTPS.
- Password confirmation before sensitive actions asks for the password only, not the
  second factor, and covers the administration screens only.
- Single sign-on is OpenID Connect only: no SAML 2.0 and no directory (LDAP) sign-in. A
  provider sign-in does not ask for this application's second factor and does not read the
  provider's own (`amr`/`acr`); signing out here does not sign out at the provider (no
  back-channel or front-channel logout); group "overage" (groups by reference) gives no groups.
- Setup and reset links are emailed only when email is set up; otherwise the
  administrator passes them on by hand.

**Platform**

- The data folder holds the database and files in the clear, including password hashes.
  The application encrypts only its stored secrets (authenticator keys, webhook, provider
  and mail-server secrets) and, on request, backups and exports.
- After a change of secret key, only authenticator keys are re-encrypted; other secrets
  need the retired key until they are replaced.
- `backup` and `restore` cover the embedded database only; a PostgreSQL server is backed
  up with its own tools. Files in the object store are not in backups.
- No access log, no alerting, no log retention. Server logs are overwritten at each start.
- Retention flags records for review but nothing anonymizes them, and audit events are
  kept indefinitely (`retention.audit_months` is recorded, not enforced).
- Personal access tokens cannot be limited to source addresses or particular records.
- Webhook receivers' addresses are checked by host name only: an allowed name that
  resolves to an internal address is still called. Keep the allow-list to names you control.
- MCP has no OAuth for remote connectors, and once it is switched on anyone with a role may
  make an assistant token; there is no role permission for it yet.

**Access control details**

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
  when individual rows are flagged restricted (labels are still hidden). This is in line
  with "Figures are the same for everyone" above.

**Assurance**

- No independent security review, penetration test or load test.
- Continuous integration runs a dependency audit (`npm audit`), which reports but does not
  yet fail the build.
- An automated accessibility audit (axe-core, `npm run test:a11y`) exists; continuous
  integration runs it without failing the build, and there has been no screen-reader
  walkthrough.
- Non-administrator roles are exercised in the browser by the end-to-end suite
  (`npm run test:e2e`, every default role on every page), as well as by API tests.

## Reporting a vulnerability

Report it privately, as described in [`SECURITY.md`](../SECURITY.md): through GitHub's
private vulnerability reporting (a private security advisory), not as a public issue. Do
not include real data in a report.
