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
  out only to: webhook receivers (see "Outbound webhooks"), the text-message webhook for alerts
  (once switched on, with the same fences as webhooks; see [Installation](installation.md#text-messages-for-alerts)), a mail server, or Microsoft Graph or the Gmail API at their fixed published addresses (once email is
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

### Password confirmation before sensitive actions

`requireRecentAuth` in `server/src/core/auth.ts`; `sensitive` in
`server/src/modules/admin/shared.ts`; prompt `withReauth` in `web/src/core/reauth.ts`

So that an unattended, signed-in browser cannot be used to change who can do what, to open
a way in from outside or to destroy data, the actions marked "Ask" in the table below need
the password to have been proved **in the same session within the last 10 minutes**
(setting `auth.reauth_minutes`, 1 to 60). An API token never carries a confirmation, so a
token can never do them.

Signing in counts as proof. After that the server answers `403 reauth_required`; the
screens then ask for the password in place (`POST /api/auth/confirm`) and
carry on with the action. **A person who has a second factor is asked for it too** (E01-29):
after the right password the server answers `400 second_factor_required` (not counted as a
failure), and the prompt asks for a 6-digit code, a recovery code, or the person's passkey or
security key (`POST /api/auth/webauthn/confirm/options`, then the answer as `webauthn`). A wrong
code or a refused key counts towards the same limit as a wrong password (8 in 5 minutes). Each
refusal, each wrong password or code and each successful confirmation is audited
(`reauth.required`, `reauth.failure`, `reauth.success`, which says what was proved). A person
with no password confirms through a linked sign-in provider instead; when that provider is
trusted for multi-factor sign-in, the confirmation must show one too.

#### Actions that ask you to confirm your identity

Reviewed module by module (E01-33). The rule: ask when an action changes who can do what,
opens a way in or out of the application (an integration, a secret, a link for outsiders),
switches a part of the application on or off for everyone, or removes or merges data in a way
that cannot be undone. Do not ask for ordinary configuration that is audited and can be put
back, for work on one record, or for anything that only narrows access. A new sensitive
action is added to this table and to its module's tests in the same change.

| Area | Action | Decision | Why |
|---|---|---|---|
| Administration | Create a role; change a role's permissions, on/off switch or "second factor required" flag; apply default permissions | Ask | Changes who can do what |
| Administration | Create a user; change a user's roles | Ask | Changes who can do what |
| Administration | Enable a disabled user again | Ask | Gives the account its access back, like creating it |
| Administration | Change a user's email address | Ask | Password-reset links go to that address |
| Administration | Reset a user's second factor; issue a setup or password-reset link | Ask | Lets someone take over the account |
| Administration | Change a sign-in, API-token or outbound-connection setting (keys starting `auth.`, `tokens.`, `integrations.`) | Ask | Sign-in rules and ways out of the application |
| Administration | Sign-in providers: add, change, remove; a person's sign-in limits, link permits, unlinking, break-glass designation | Ask | Who can sign in, and how |
| Administration | Switch parts of the application on or off (Features) | Ask | Changes what everyone can use |
| Administration | Webhooks: add, change the address or switch on "include restricted records", replace the secret | Ask | Sends data out; a secret |
| Administration | Anonymize a record, or remove it for good, from the retention review | Ask | Cannot be undone |
| Administration | Change a retention period or what its review may do | Don't ask | Nothing is changed until the review, which asks |
| Administration | Disable a user, unlock an account, end sessions, rename a user or move department | Don't ask | Takes access away or changes nothing about access |
| Administration | Departments, configurable lists, custom fields (retiring keeps the values), tag renames, email templates, background jobs, non-security settings | Don't ask | Ordinary configuration, audited and reversible |
| Your account | Create a personal access token; add or remove a passkey; new recovery codes; link or unlink a sign-in provider | Ask | Credentials for your account |
| Your account | End your own sessions, read and change your preferences | Don't ask | Only narrows access, or affects only you |
| Notifications and email | Change the mail server or mail provider (including its password, client secret, certificate or service account key) | Ask | A secret, and a way out of the application |
| Notifications and email | Reminder settings, email digest runs, your own notification preferences | Don't ask | Timing only; audited |
| Files | Change where files are stored, malware scanning, how long removed files are kept; purge removed files now; move every stored file; backup settings | Ask | Safeguards, secrets and data that cannot be brought back |
| Files | Allow another file type for uploads | Ask | Widens what may be uploaded |
| Files | Remove a file type, change the size limit, rescan, restore a removed file, check stored files, back up now | Don't ask | Narrows, or changes nothing about access |
| AI assistants | AI assistant access settings; make an assistant token; approve a connector sign-in; add a connector | Ask | Lets a program act for you |
| AI assistants | Limit an assistant's tools, revoke a connection, remove a connector | Don't ask | Only narrows access |
| Service desk | Email-to-ticket settings (mailbox password) and a new mail relay key | Ask | Secrets, and a way in from outside |
| Service desk | Switch the self-service portal on or off (portal settings) | Ask | The same feature switch as Administration > Features |
| Service desk | Portal title, welcome line, banner, reopen window, who may ask for a colleague, safety reports from the portal; service levels, calendars, priority matrix, escalation rules, catalog | Don't ask | Service configuration, audited and reversible |
| Vendors | Switch on vendor response links | Ask | Opens a way in for people outside the organization |
| Vendors | Switch response links off, link length and files; make or revoke a link for one assessment; set many contract terms at once | Don't ask | Narrows access, or one record at a time; links expire and can be revoked |
| Vulnerabilities | Merge duplicate findings | Ask | Cannot be undone |
| Vulnerabilities | Remediation policy, imports and import presets | Don't ask | Configuration and new records, audited; imports are made for scripts |
| Changes, Frameworks, Risks, Security incidents, Policies, Training, Projects, Fleet, Safety, Inventory | Module settings (templates, blackout windows, scoring weights, risk scales, incident lists and clocks, reminder intervals, requirements, exposure figures, disposal routing), imports, reminder runs | Don't ask | Configuration of how work is done, audited and reversible; access is unchanged |
| Reports and records | Export lists, reports, dashboards and packs (CSV, Excel, PDF), including restricted records; schedule and share reports | Don't ask | Only what the person may already see; restricted rows are watermarked and every export is audited; schedules run with each recipient's own permissions |
| Any record | Mark or clear "restricted" on one record | Don't ask | Work on one record by someone who already holds security access; audited with before and after |

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
- **Source addresses.** A token may be limited to up to 20 addresses or ranges (IPv4, IPv6,
  CIDR), checked against the client address the application trusts (the trusted-proxy
  setting). The owner or an administrator can change the list later
  (`PATCH /api/me/tokens/:id`, `PATCH /api/admin/tokens/:id`) after a recent identity
  confirmation; each change is audited as `token.update` with the lists before and after.
- **Listing and revoking.** A person lists and revokes their own tokens (with when each
  was last used, and from which address); an administrator lists and revokes anyone's
  (`/api/admin/tokens`). Creation and revocation are audited.

- **Source addresses** (E02-18, optional). A token can be limited to up to 20 addresses or
  ranges (IPv4, IPv6, CIDR). A request from anywhere else answers 403
  `token_source_not_allowed` and writes a `token.refused` audit event.

Limits: a token cannot be narrowed to particular records, and the per-token request count
is kept in memory (a restart resets the current minute).

### Outbound webhooks

`server/src/core/webhooks.ts`

Outbound connections the administrator configures (webhooks here; also the mail provider, sign-in providers and, when allowed, the object store and malware scanner, the SAML metadata refresh, and the fetch of an MCP connector's client ID metadata document). Webhooks are fenced in three ways:

1. **Off by default.** Nothing is queued or sent unless the setting
   `integrations.outbound_enabled` is on. Switching it off again stops deliveries already
   queued (they are recorded as `blocked`).
2. **Allow-list.** A delivery goes only to a host listed in `integrations.allowed_hosts`
   (`host`, `host:port` or `*.domain`); anything else is recorded as `blocked`. Redirects
   are never followed, and each attempt times out after 10 seconds. **The address is checked
   again after the name is resolved** (E13-08): the host name is looked up when the connection
   is made, and if any address it resolves to is private, loopback, link-local, carrier-grade
   NAT, multicast, a documentation range or otherwise reserved (IPv4 and IPv6, including IPv4
   carried in IPv6), the delivery is `blocked` unless that exact address is itself on the
   allow-list (`10.0.0.5` or `10.0.0.5:8443`; a wildcard never counts). The connection then
   goes to the addresses that were checked, so a name cannot resolve one way for the check and
   another for the connection.
3. **Restricted records stay in.** Events about restricted records are not sent unless
   the webhook has "include restricted records" switched on, which only a person holding
   `security.view` can do, and which stops applying if the person who switched it on no
   longer holds `security.view`.

Events that are not record changes (E13-19: notification clocks, a declared incident, an
approval decided, a scheduled report delivered, a failed backup) follow the same rules:
restricted ones go only to webhooks that include restricted records, and a switched-off area
emits nothing.

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

Anonymizing a flagged record (E14-19) keeps the record and its figures and removes its
personal details: the fields its definition marks `personal` (by default person, long-text
and contact-detail fields), long-text and person custom fields, the creator and last editor,
its comments' text and authors, its files' contents and names, the titles of notifications
about it, and its watchers; the search index follows. It needs the same reason,
confirmation and recent identity confirmation, is allowed only when the type's policy
allows it (`disposal`: keep, anonymize or delete), and is audited (`retention.anonymize`,
without the removed values). **The audit log is append-only and is not changed**: it keeps
who changed what, by design, including earlier values in its before-and-after entries, and
its own period (`retention.audit_months`) is recorded, not enforced.

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
- One route is exempt: the sign-in provider's back-channel sign-out
  (`POST /api/auth/sso/:key/backchannel-logout`), called server to server. It is public, never
  uses a session, does nothing unless back-channel sign-out is switched on for that provider,
  and acts only on a logout token signed by the provider (see Sign-in providers).

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

### Authorization and restricted records

`server/src/core/services.ts`, `server/src/core/resource.ts`, `server/src/core/routes.ts`

- Every `/api/` route needs a session unless explicitly public (health, auth state,
  setup, sign-in, sign-out, one-time links). Routes then check a permission.
- **Switched-off parts** (Administration > Features, `server/src/core/features.ts`): the
  permissions of a part an administrator has switched off are held by nobody, `*` and API
  tokens included; its routes answer 404, its record types are hidden everywhere and its
  background jobs are skipped. Switching parts on or off needs a recent password
  confirmation and is audited. Its data is kept.
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
the organization reports. Restriction exists to protect what a record *says* and *who*
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
  sign-in, at enrollment and when turning the factor off.
- Enrollment is confirmed with a code before it takes effect.
- Ten single-use recovery codes are issued at enrollment and shown once. Only their
  SHA-256 hashes are stored. A used code is removed. A person whose only second factor is a
  passkey or security key is offered recovery codes as soon as the first key is added (E02-21);
  they stand in for the key at sign-in. Codes go when the person's last factor goes (the last
  key removed with no authenticator app, or the app turned off with no key left).
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
  secrets and directory (LDAP) service account passwords, the mail server password, the Microsoft Graph client secret or certificate and the Gmail service account key, the object store secret key, set-up and reset links
  waiting to be emailed, single sign-on requests in progress and the provider sign-out details
  of open sessions are encrypted the same way with the same key. Every kind is listed in
  `core/secretkey-reseal.ts`.
- The 32-byte encryption key (the **secret key**) comes from, in order: the environment
  variable `GRC_SECRET_KEY` (64 hex characters or base64); the file named by
  `GRC_SECRET_KEY_FILE`; or a file **beside** the data folder, named after it and
  generated on first start: for the data folder `C:\grc\data` it is
  `C:\grc\data.secret.key`. A copy of the data folder, or a `grc.ps1 backup`, therefore
  holds the encrypted values but not their key. In the container image the key is generated
  in its own volume at `/var/lib/sandpiper-key`, separate from the data volume (see
  [Docker](docker.md)).
- An installation from before this change kept the key at `secret.key` inside the data
  folder. At start-up that file is moved beside the data folder (copied, read back and
  compared, then deleted).
- Keys stored in the clear by an earlier version are encrypted at the next start
  (audited as `mfa.secrets_encrypted`).
- **Every stored secret is re-encrypted after a key change** (E02-20). At each start, every
  value written with a retired key is re-encrypted with the current one: authenticator keys
  (audited as `mfa.secrets_encrypted`) and all the other kinds (audited as
  `secret_key.reencrypted`, with a count of each). Values that no supplied key can open are
  left as they are, reported in the start-up log and audited (`mfa.secrets_unreadable`,
  `secret_key.unreadable`); a webhook whose secret cannot be read is `blocked` with that reason
  rather than sent unsigned.
- **Back the key up, separately.** Without it, nobody with a second factor can sign in
  with their authenticator code: they would need a recovery code or an administrator
  reset. Keep a copy of the key somewhere safe, apart from the backups. An encrypted
  backup can carry it on request (`backup -Encrypt -IncludeSecretKey`).
- **Seeing and changing the key.** `npx tsx server/src/core/secretkey-cli.ts show` says
  where the key comes from (it prints a short fingerprint, never the key). `rotate`, with
  the server stopped, writes a new key and keeps the old one as a retired key. Retired keys
  can also be given in `GRC_SECRET_KEY_PREVIOUS` (comma-separated). Every stored secret is
  re-encrypted with the new key at the next start. `show` also reads the database (with the
  server stopped, for the embedded database) and says whether any value still needs a retired
  key: once it says they are no longer needed, delete `<key file>.previous` and clear
  `GRC_SECRET_KEY_PREVIOUS`.
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
`providers.ts` (routes), `server/src/modules/admin/migrations/001_identity.sql` to `003_saml.sql`

- **OpenID Connect, any compliant provider.** Issuer, client and claims are entered by an
  administrator; every endpoint comes from the issuer's discovery document, whose `issuer`
  must match exactly. Nothing is hard-coded, so commercial, government and sovereign cloud
  tenants and self-hosted servers are configured the same way. Providers sit behind a driver
  interface (`core/identity/types.ts`): a redirect-style driver (OpenID Connect, SAML 2.0) or a
  credentials-style driver (a directory over LDAP, E02-26). Everything after
  "the provider says this is subject X" is shared.
- **Off until switched on.** A provider that is not switched on is never contacted. The only
  other outbound call is **Test connection**, made when an administrator selects it. Calls go
  over `https` only (plain `http` only to the loopback address), never follow redirects, time
  out after 10 seconds and are size-limited.
- **The flow.** Authorization code with PKCE (S256), a random `state` bound to the browser by a
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
- **The provider's own second factor** (E02-22, off by default per provider). When an
  administrator says a provider enforces multi-factor sign-in, a session made through it
  satisfies this application's second-factor requirement **only when its ID token shows it**:
  an `amr` value from the provider's list (default `mfa`) or an `acr` from its list (those
  `acr` values are also asked for with `acr_values`). The result is kept with the session
  (`identity_sessions.mfa`) and checked against the provider's current setting on every request,
  so switching the trust off takes effect at once. Other sessions of the same person, and the
  person's other ways of signing in, are judged on their own.
- **Signing out at the provider** (E02-23, off by default per provider). RP-initiated logout:
  signing out here sends the browser to the provider's `end_session_endpoint` with
  `id_token_hint`, `client_id` and `post_logout_redirect_uri` (the application's address
  followed by `/`). The ID token is kept for that only, encrypted with the application key and
  deleted with the session. **Back-channel sign-out**: the provider may call
  `POST /api/auth/sso/<key>/backchannel-logout` with a logout token, which is checked like an ID
  token (signature from the provider's key set, issuer, audience, issue time within 10 minutes)
  and must carry the back-channel logout event, a `sub` or `sid` and no `nonce`. The sessions made
  through that provider for that person (or that provider session) end. A token is acted on once
  (its `jti` is remembered for a day). Failures are audited and count against the sign-in limit.
- **Groups by reference** (E02-24). When a token says the person has groups but names a source
  instead of listing them ("group overage": `_claim_names`/`_claim_sources`, or `hasgroups`),
  the groups are read from the provider's userinfo endpoint, then from the named source, with the
  access token from the sign-in. Only a JSON answer about the same subject is used. If the groups
  cannot be had, role mapping leaves the person's roles as they are (audited as
  `identity.groups_unknown`) instead of removing them. An administrator can also choose to read
  groups from userinfo at every sign-in.
- **SAML 2.0** (E02-10; `core/identity/saml.ts`, `samlxml.ts`, `x509.ts`). Web Browser SSO
  started here: the AuthnRequest goes out with the HTTP-Redirect binding (optionally signed with
  RSA-SHA256), the Response comes back with the HTTP-POST binding to the provider's assertion
  consumer service, `POST /api/auth/sso/<key>/acs`. XML signature verification is done by
  **@node-saml/node-saml** (MIT; on **xml-crypto** and **@xmldom/xmldom**, MIT, with
  **xml-encryption**, MIT, for encrypted assertions), pinned to exact versions: only the
  configured certificates are trusted (several, for a certificate change; RSA of 2048 bits or
  more), never a key carried in the message; what is read is the signed bytes the library
  returns, not the message as received. Around the library, this application adds:
  - **Hardened parsing first.** Every message and metadata document is refused if it has a
    document type declaration (so no external entities and no entity expansion), any other
    markup declaration or processing instruction, is over 256 KB (1 MB for metadata), has more
    than 5,000 elements or is nested more than 40 deep, is not UTF-8, or is not well formed.
  - **Signature wrapping defenses.** Exactly one assertion in the whole message (encrypted or
    not), as a direct child of the Response; ID values unique in the message; a signature only
    directly on the Response or the Assertion, with exactly one reference, to its own parent.
  - **An algorithm allow-list.** RSA-SHA256, RSA-SHA256-MGF1 (PSS) and RSA-SHA512 signatures;
    SHA-256 and SHA-512 digests; exclusive or inclusive canonicalization **without comments**
    and the enveloped-signature transform, at most two. Encrypted assertions: AES-128/256-GCM
    with RSA-OAEP only (no CBC or RSA 1.5 padding oracles); the inner signature is checked
    against the same list after decryption, and an encrypted assertion must still be signed.
  - **Exact matching.** Status Success; `Destination` equal to the ACS address (required on a
    signed Response); `InResponseTo` equal to the request this sign-in sent (unsolicited,
    identity-provider-initiated responses are refused); issuer equal to the configured entity
    ID (Response and Assertion); audience equal to this application's entity ID; a **bearer**
    `SubjectConfirmation` whose `Recipient` is the ACS address and whose `InResponseTo` is
    the request, in time; `NotBefore`/`NotOnOrAfter` on the conditions and the
    confirmation, with 60 seconds of clock tolerance, and no assertion older than 10 minutes.
    The NameID read here must equal the library's (text split by a comment is read whole, as
    signed), and a transient NameID is refused.
  - **One use.** The request ID is kept (encrypted) with the sign-in in flight and works once;
    each assertion ID is remembered per provider until it could no longer be presented
    (`identity_saml_assertions`), in the database, so a replay is refused on every server.
  - **Bound to the browser.** The provider's POST is cross-site, so the `SameSite=Lax` state
    cookie is not sent with it. The ACS therefore only keeps the posted response (encrypted,
    once) for the sign-in its `RelayState` names, and redirects the browser (303) to the
    callback with a GET, which does carry the cookie; the response is checked there, against the
    browser that started the sign-in. A response is never read from an address. The ACS asks for
    no CSRF header (route `noCsrf`: it is a top-level form post from another site) and counts
    failures against the sign-in limit.
  - **Keys.** Each SAML provider gets its own RSA-3072 key pair and a self-signed certificate
    when it is added; the private key is stored encrypted with the application key (as a client
    secret is), never returned by the API, and can be replaced on request. The certificate is
    published in the provider's metadata (`GET /api/auth/sso/<key>/metadata`) for request
    signing and, when encryption is asked for, for encryption.
  - **No outbound calls by default.** The application never calls a SAML identity provider.
    Its metadata is pasted or uploaded; fetching it by address happens only when an
    administrator asks, outbound connections are on (`integrations.outbound_enabled`) and the
    host is on `integrations.allowed_hosts` (https only, no redirects, 1 MB), and is audited.
    Without a pinned metadata signing certificate, metadata signatures are not checked: the
    administrator vouches for what they import.
  - **Signed metadata and its refresh (E02-28).** With a **metadata signing certificate** (PEM,
    one, RSA of 2048 bits or more) on the provider, imported metadata must carry exactly one
    signature, directly on the root element and covering it (a reference to its ID, or the whole
    document), with the same algorithm allow-list as sign-in, valid for that certificate and no
    other (`verifyMetadataSignature` in `samlxml.ts`, on **xml-crypto**). Only the signed bytes
    are read afterwards; metadata past its `validUntil` is refused. An optional daily refresh
    runs through the job queue (`admin.saml_metadata_refresh`, `scheduleWork`), only with
    outbound connections on and the host allowed, and accepts signed metadata only. It adds new
    signing certificates, updates the sign-in and sign-out addresses, never changes the entity ID
    (metadata naming another one is refused), and keeps a certificate the metadata stops listing
    for 7 days (`certsDropped`) so a rollover in progress does not break sign-in. It writes only
    the keys it owns. Every refresh and every failure is audited
    (`identity_provider.metadata_refresh`, with the certificate fingerprints before and after).
  - **The same rules as OpenID Connect** for accounts, linking, just-in-time accounts, role
    mapping (from a groups attribute), break-glass, audit and rate limits. Email addresses are
    trusted only when the administrator says so (SAML has no "email verified"). The provider's
    multi-factor sign-in counts only when the assertion's `AuthnContextClassRef` is in the
    administrator's list (also sent as `RequestedAuthnContext`).
  - **Single logout.** With signing out at the provider on, signing out here sends a signed
    LogoutRequest (NameID and SessionIndex, kept encrypted with the session) to the identity
    provider's sign-out address; it returns to `/api/auth/sso/<key>/slo`.
  - **Sign-outs started at the identity provider (E02-27)**, off unless the administrator
    switches them on for the provider. A LogoutRequest to `/api/auth/sso/<key>/slo`, with the
    HTTP-Redirect binding (GET) or the HTTP-POST binding (a cross-site form post: no CSRF header,
    route `noCsrf`), is acted on only when it is signed by one of the configured certificates:
    for HTTP-Redirect a query-string signature with RSA-SHA256 or RSA-SHA512 (an unsigned request
    is refused, although the library would accept it), for HTTP-POST one XML signature directly on
    the request, checked like a sign-in response. The deflated message is inflated to at most
    256 KB and parsed with the same hardening (no DTD, limits, unique IDs). Its issuer must be the
    configured entity ID, its `Destination` this provider's single logout address, its
    `IssueInstant` no more than five minutes old (60 seconds of clock tolerance) and its
    `NotOnOrAfter`, when present, not passed; an encrypted or base identifier is refused, and
    each request ID works once (remembered per provider in `identity_saml_assertions`). Then the
    sessions made through that provider for the account linked to the NameID end (only those
    whose SessionIndex the request names, when it names any), the session cookie is cleared, the
    sign-out is audited (`identity.saml_logout`, with the number of sessions) and a LogoutResponse
    signed with this application's key goes back to the identity provider's sign-out address with
    the HTTP-Redirect binding. A refused request is audited as a failure, counts against the
    sign-in limit and gets no answer. While the option is off, such requests are ignored, as
    before. The service-provider metadata then lists the single logout address for both bindings.
- **Directory (LDAP) sign-in** (E02-26; `core/identity/ldap.ts`, `ldapclient.ts`,
  `ldapfilter.ts`, `ber.ts`). A credentials provider: the person types a directory user name
  and password into this application's form (`POST /api/auth/sso/<key>/login`), and the
  directory checks them. The LDAP client is this application's own (simple bind, search,
  StartTLS and unbind on `node:tls`, a few hundred lines with its BER codec), not a package:
  the subset is small, the stand-in directory the tests use shares the codec, and the security
  rules stay in one place.
  - **Encrypted only.** `ldaps://`, or `ldap://` with StartTLS before anything else is sent.
    Plain LDAP is refused in the settings and in the client, except to `127.0.0.1` (tests). TLS
    1.2 or later; the certificate chain and the host name are always checked. With a **pinned CA
    certificate** only that CA (or that very certificate) is trusted; otherwise the built-in and
    operating-system trust stores. Every operation times out after 10 seconds; answers are limited
    to 1 MB a message and 1,000 entries; continuation references are not followed; aliases are
    never dereferenced.
  - **The service account** (DN and password) finds the person. Its password is the provider's
    stored secret, encrypted with the secret key (re-encrypted after a key change like every
    other secret: `SEALED_KINDS` in `core/secretkey-reseal.ts`), never returned by the API and
    never written to the audit log or the server log (the audit records only that one is set).
    Without a service account, a DN template can be used instead; the user name is then escaped
    for a DN (RFC 4514).
  - **No injection.** The user name goes into the administrator's search filter only through
    RFC 4515 escaping (`\ * ( )`, NUL, and every byte that is not printable ASCII), and the filled
    filter is parsed and sent in binary (BER) form, so it can only ever be one value. Exactly one
    entry must match. Group searches put the person's DN in the same way.
  - **The password.** Checked by binding as the entry found, on a connection of its own (the
    service account's connection is never re-bound as the person). An empty password is never
    sent: an "unauthenticated bind" (RFC 4513 5.1.2) would succeed. Disabled, expired and locked
    accounts are refused (Active Directory bind sub-codes and `userAccountControl`, OpenLDAP
    `pwdAccountLockedTime`, `nsAccountLock`).
  - **Identity and groups.** The entry is linked by an attribute that never changes
    (`objectGUID`, shown as a GUID, or `entryUUID`). Groups for role mapping come from
    `memberOf`, a group search, and optionally Active Directory nested groups through the
    `LDAP_MATCHING_RULE_IN_CHAIN` matching rule; rules match the group's full DN.
  - **One factor.** A directory password never counts as a second factor (the provider's
    multi-factor option is forced off). A person with an authenticator app is asked for its code,
    or a recovery code; a person whose second factor is a passkey is asked for it, the key list being
    given only after the directory password is checked again (`POST /api/auth/sso/:key/passkey-options`,
    same limits and lockout; E02-29). The enrollment requirement applies as for everyone.
  - **Linking and confirming.** A directory can be linked from Account security with its user name and
    password, after a recent confirmation, when the entry gives the account's trusted email. A person may
    confirm their identity for sensitive actions with a linked directory's password
    (`POST /api/auth/sso/:key/confirm`) followed by their second factor; it is limited by the same
    `confirm` bucket as a password confirmation.
  - **Limits and lockout as for a password.** Failures count against the sign-in limit by source
    address (shared with password sign-in), and against a limit by provider and user name (5 wrong
    passwords in 15 minutes); a wrong password also counts toward the progressive lockout of the
    account the entry is linked to, and a locked account is refused. Every answer to a failure is
    the same generic message; the reason is audited (`signin.failure`), with the user name as
    typed but never the password. `no_account` is told only after the directory accepted the
    password. Accounts, linking (an existing account matched by verified email needs its own
    password first), just-in-time accounts, role mapping, break-glass and per-person limits are
    the shared rules.

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
- **Who may connect.** `mcp.allowed_roles` limits assistant tokens, OAuth consent and every
  `/mcp` request to members of the chosen roles; `mcp.role_tools` narrows the tools per role,
  and an owner can narrow them per token.
- **OAuth 2.1 for remote connectors** (off by default, `mcp.oauth_enabled`). Authorization
  code with PKCE (S256 only) and a consent screen that asks for the password again; served
  only over HTTPS or on this computer. Access tokens last an hour and work only at `/mcp`,
  never on `/api`. Refresh tokens rotate on every use, and a reused code or refresh token
  ends the whole grant. Dynamic client registration only when an administrator allows it
  (`mcp.oauth_registration`). Client secrets, codes and tokens are stored only as SHA-256
  hashes and never logged.
- **Audited.** Each change names the token, and each write tool adds an `mcp.write` event
  that reads "... via MCP (tool ...) with API token ..." in the record's History. Every
  call is logged without its arguments or results and kept for 90 days.

### Vendor response links

`server/src/modules/vendors/responseLinks.ts`, `responseFiles.ts`, `responseEmail.ts`

Vendors can answer an assessment through a link without an account (E06-21). Off by default
(`vendors.response_links_enabled`; switching it off revokes every open link). A link expires
(1 to 90 days), can be revoked, stops working once the assessment is completed, and only a
SHA-256 hash of its secret is stored. The public routes are rate limited per address (60 a
minute, and 20 wrong links in 15 minutes block the address) and answer the same "not valid"
for an unknown, expired or revoked link and when the feature is off. Every public route that
changes something (saving answers, sending or removing a file) needs the `X-GRC-CSRF` header
like any other, so a form posted from another site is refused. The vendor sees the
questions only, never the weights or staff answers; their answers stay apart until staff take
them over. Link tokens in paths are masked in the server log, and pages send
`Referrer-Policy: same-origin`.

- **Files through the link (E06-22).** Only while the link works and the answers have not been
  sent. The link is checked (and the address rate limited) before any byte of the file is
  read. Each file goes through the attachments module's own intake
  (`modules/attachments/intake.ts`, the same code as every upload): allowed types, the content
  compared with the type the name claims (programs and scripts refused whatever their name),
  the malware scanner when one is set up, and the size limit while the bytes arrive. A link
  adds its own limits, which can only narrow the attachments settings: a list of file types
  (documents and pictures as installed; no archives, web pages or images that can carry
  script), at most 10 files and 50 MB per link as installed (checked again under a lock on the
  link before the file is kept), and 30 uploads an hour per link. The name is reduced to a
  display name (no path, control or direction characters); the stored object's key is random.
  A received file waits in a holding area tied to the link (record type
  `vendor_response_link`), which no record page, list, search or download route serves; staff
  download it from the link panel (`Content-Disposition: attachment`, a sandboxing content
  policy, `nosniff`, checksum verified first), then take it over onto the vendor or discard it,
  which deletes the content at once. Every file sent, refused, withdrawn, taken over or
  discarded is audited on the vendor, never with the link's secret.
- **Emailing the link (E06-23).** Only when outgoing email is on. The secret is never stored,
  so emailing creates a new link (the open one is revoked) and puts it in that message only: it
  is sealed with the secret key in the queued message, as account set-up links are, and
  decrypted only to send it; it is not in the answer to staff, the delivery log or the audit
  log. At most 5 emails a day per assessment. The one reminder before expiry does not carry the
  link.

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
- SAML sign-in must start here (identity-provider-initiated sign-in is refused). A SAML
  sign-out started at the identity provider is acted on only when switched on, and answered with
  the HTTP-Redirect binding only. After a directory (LDAP) password, a passkey cannot yet be the
  second factor (a recovery code can), and a directory is linked at sign-in, not from Account
  security (E02-29).
  An OpenID Connect or SAML sign-in does not ask for this application's own second factor; it counts as one only
  when the provider is trusted for multi-factor sign-in and its token shows it. There is no
  front-channel logout. Groups by reference are read from userinfo or a JSON source only: a
  directory whose group source needs a provider-specific call (for example a POST) gives no
  groups, and roles are then left unchanged.
- Setup and reset links are emailed only when email is set up; otherwise the
  administrator passes them on by hand.

**Platform**

- The data folder holds the database and files in the clear, including password hashes.
  The application encrypts only its stored secrets (authenticator keys, webhook, provider
  and mail-server secrets) and, on request, backups and exports.
- `backup` and `restore` cover the embedded database only; a PostgreSQL server is backed
  up with its own tools. Files in the object store are not in backups.
- No alerting. The server log (JSON lines, one per request with its request id) rotates by
  size; secrets in messages, query strings and link tokens in paths are masked.
- Audit events are kept indefinitely and are not anonymized with a record
  (`retention.audit_months` is recorded, not enforced): the audit log keeps earlier values
  of a record's personal fields.
- Personal access tokens cannot be limited to particular records.
- Retention decisions raise webhook events (E14-33) that carry no values from before the
  change; they do not run the record type's after-save hooks.
- Anonymizing or removing a record from the retention review raises no webhook event
  (E14-33).

**Access control details**

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
