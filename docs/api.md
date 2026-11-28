# Integration guide: the REST API

Everything the application does on screen goes through a JSON API over HTTP, and other tools
can use the same API: a monitoring system that raises tickets, an endpoint-management tool
that keeps the asset register up to date, a vulnerability scanner that pushes its findings, a
reporting tool that reads risk summaries. This guide explains how to call it. The reference
for every route (parameters, request bodies, answers) is generated from the running
application:

- in the application: **Help > API reference** (`/help/api`), grouped by area, searchable,
  with copyable curl and PowerShell examples for every route. It lists only what you may use.
- machine-readable: `GET /api/v1/openapi.json` (OpenAPI 3.1), cut down to what the caller may
  use; or the whole document, without a running server:
  `npx tsx server/src/core/openapi-cli.ts openapi.json` (see the [developer guide](development.md)).

Examples in this guide use `https://grc.example.test` for the address of your installation;
by default it is `http://127.0.0.1:8080` on the machine that runs it. All data in them is
invented.

## Contents

- [Authentication: personal access tokens](#authentication-personal-access-tokens)
- [Base URL and versioning](#base-url-and-versioning)
- [Records: the generated routes](#records-the-generated-routes)
- [Pagination](#pagination)
- [Filtering](#filtering)
- [Sorting](#sorting)
- [Full-text search](#full-text-search)
- [Exports](#exports)
- [Imports](#imports)
- [Webhooks](#webhooks)
- [Errors](#errors)
- [Request ids](#request-ids)
- [Rate limits](#rate-limits)
- [Idempotency](#idempotency)
- [Optimistic concurrency](#optimistic-concurrency)
- [Paged answers added in wave 19](#paged-answers-added-in-wave-19)
- [Audit log and backups](#audit-log-and-backups)
- [Restricted records](#restricted-records)
- [User provisioning (SCIM 2.0)](#user-provisioning-scim-20)
- [Calendar feeds and the work-tracker bridge](#calendar-feeds-and-the-work-tracker-bridge)
- [Asset tags and inventory counts](#asset-tags-and-inventory-counts)
- [Vehicle and asset models](#vehicle-and-asset-models)
- [Routes added in wave 20](#routes-added-in-wave-20)
- [Routes added in waves 21 and 22](#routes-added-in-waves-21-and-22)
- [Changes in wave 23 (security review)](#changes-in-wave-23-security-review)
- [Routes added in wave 25](#routes-added-in-wave-25)
- [Routes added in wave 26](#routes-added-in-wave-26)
- [Routes added in wave 27](#routes-added-in-wave-27)
- [Data load mode](#data-load-mode)
- [Examples of common integrations](#examples-of-common-integrations)

## Authentication: personal access tokens

An integration authenticates with a **personal access token**:

1. Sign in, open **Account security > API tokens** and create a token. Give it a name that
   says what uses it, only the permissions (scopes) that integration needs, and the shortest
   expiry that works (an administrator sets the longest allowed, `tokens.max_days`, 365 days by
   default). Creating a token asks for your password again.
2. The token (`grc_pat_...`) is shown once. Store it in the integration's secret store or an
   environment variable, never in a script or in source control.
3. Send it on every request:

   ```
   Authorization: Bearer grc_pat_...
   ```

**Scopes.** A scope is a permission (`tickets.view`), every action of one area
(`tickets.*`), or everything you hold (`*`). A request made with a token acts as you, with the
permissions that the token's scopes and your own roles have in common, worked out on every
request: a token never does more than you can do at that moment, and stops working when your
account is disabled. Typical scopes:

| Integration | Scopes |
|---|---|
| Read open tickets into a dashboard | `tickets.view` |
| Raise tickets from monitoring | `tickets.view`, `tickets.create` |
| Sync assets from an endpoint-management tool | `assets.view`, `assets.create`, `assets.edit` |
| Push vulnerability findings | `vulnerabilities.view`, `vulnerabilities.create`, `vulnerabilities.edit`, `security.view` |
| Read risk summaries | `risks.view` (restricted risks, cybersecurity by default, also need `security.view`; figures list them as "Restricted risk") |

**Scope families.** Most scopes are permissions, and you may only give a token permissions you
hold. A few scopes are *capabilities* rather than permissions; no role grants them, and each
says who may add one to a token. They give no access to records by themselves: what the token
can read or change is still decided by its permission scopes and your own roles.

| Scope | What it allows | Who may add it |
|---|---|---|
| `mcp.use` (or `mcp.*`) | The token may be used at the MCP endpoint (`/mcp`), once an administrator has switched that endpoint on | Anyone who holds at least one permission, and, when an administrator has chosen roles under **Who may connect an assistant**, only people in those roles |

`GET /api/v1/me/tokens` (from a signed-in session) lists the capability scopes you may add, in
`scopeFamilies`. A `*` scope does not include them: they are always chosen deliberately.

**Source addresses.** A token may be limited to the addresses it is used from: give
`allowedSources` when you create it, a list of up to 20 addresses or CIDR ranges
(`"203.0.113.7"`, `"10.20.0.0/16"`, `"2001:db8::/32"`), or fill in **Allowed source addresses**
on the token screen. A request from anywhere else is refused with `403 token_source_not_allowed`
and audited as `token.refused`; it counts toward the wrong-token limit for that address. An
empty list allows every address. `GET /api/v1/me/tokens` returns each token's
`allowed_sources` and `yourAddress` (where that request came from, as the server sees it,
which behind a reverse proxy is the forwarded address only when the proxy is trusted).

```
POST /api/me/tokens
{ "name": "Nightly asset import", "scopes": ["assets.view", "assets.create", "assets.edit"],
  "expiresInDays": 90, "allowedSources": ["10.20.30.40"] }
```

**What a token cannot do.** It cannot call the sign-in, account-security, password,
second-factor or token routes (`403 token_not_allowed`), and it cannot pass a password
confirmation, so actions that need one (see [Security](security.md#actions-that-ask-you-to-confirm-your-identity)) answer `403 reauth_required`. A token
request needs no `X-GRC-CSRF` header and never falls back to a browser session. Every change
made with a token is audited with the token's name. You or an administrator can revoke a token
at any time; see [Security](security.md#personal-access-tokens). A token is also revoked when its
owner's password is changed or reset, or an administrator resets their second factor: make a new one then.

`GET /api/v1/auth/state` tells a client who it is acting as and which permissions it has.

## Base URL and versioning

Integrations use the **versioned base path**:

```
https://grc.example.test/api/v1/...
```

Every route of the API is served there. The same routes are also served under `/api/...`
without a version; the web application uses those, and they may change with it. Answers to a
versioned request carry `API-Version: 1`. Both spellings reach the very same route, with the same
permission and sharing checks. Send paths as they are: a path that percent-encodes a letter, digit
or `-._~`, encodes `/` or a backslash, has a malformed escape, or holds `.` or `..` segments is refused
with `400 bad_path` (values in the query string may be encoded freely).

**Compatibility promise for v1.** Within version 1, changes are additive only:

- new routes, new record types and new optional parameters may appear;
- answers may gain new members (ignore members you do not know), and configurable lists
  (statuses, priorities, categories) may gain values: read them with
  `GET /api/v1/lookups/<list>` rather than hard-coding them;
- nothing is removed or renamed, and no meaning changes.

When something must go, it is first **announced**: every answer from the route carries a
`Deprecation` header (`@<unix time>` of the announcement, RFC 9745), a `Sunset` header with
the date after which it may stop working once that date is set, and a `Link` to the notice
(`rel="deprecation"`); the OpenAPI document marks the operation `deprecated: true` and says
what to use instead. Watch for the header in your integration's logs. A change that cannot be
made compatibly would come as `/api/v2`, with v1 kept alongside it for a stated period.

### Deprecated paths

These paths were renamed to American spelling on 2026-11-19. The old paths still answer (also
under `/api/v1`) and carry the `Deprecation` header; use the new ones.

| Deprecated | Use instead |
|---|---|
| `/api/policies/acknowledgements/mine` | `/api/policies/acknowledgments/mine` |
| `/api/policies/acknowledgements/:ackId` | `/api/policies/acknowledgments/:ackId` |
| `/api/policies/acknowledgements/:ackId/acknowledge` | `/api/policies/acknowledgments/:ackId/acknowledge` |
| `/api/policies/:id/acknowledgements` | `/api/policies/:id/acknowledgments` |
| `/api/portal/catalogue` | `/api/portal/catalog` |
| `/api/reports/catalogue` | `/api/reports/catalog` |

One route was replaced on the same date and is deprecated in the same way:

| Deprecated | Use instead |
|---|---|
| `POST /api/assets/import` | `POST /api/import/asset`, the generic import (a dry run by default; CSV or Excel, sent as base64 in `content`). `POST /api/assets/ingest` is not affected |

Some stored values and field names keep their original spelling because data and integrations
depend on them, for example the status value `cancelled`, the asset type `software_licence`
and the error code `mfa_enrolment_required`. Treat them as identifiers.

Custom fields an administrator adds appear on records as `cf_<key>`; they are data, not part
of the compatibility promise, and can be switched off by an administrator.

## Records: the generated routes

Every record type (tickets, assets, systems, risks, vulnerabilities, ...) has the same six
routes under its path, for example `/api/v1/tickets`:

| Route | Does |
|---|---|
| `GET {path}` | A page of records, filtered, sorted and searched; or an export |
| `GET {path}/stats?group=<field>` | Counts by one field, with the same filters: `{ groups: [{ value, label, color, count }], total }` |
| `GET {path}/{id}` | One record |
| `POST {path}` | Create (answers `201` with the record) |
| `PATCH {path}/{id}` | Change the fields you send, and only those |
| `DELETE {path}/{id}` | Delete (soft: kept for audit and retention) |

A record carries its fields, `id`, `created_at`, `created_by`, `updated_at`, `updated_by`,
`_display` (display labels for its user, record and list fields: `{ "status": "In progress" }`)
and `_tags`. List fields hold the list's **value** (`in_progress`), not its label. User fields
hold a user id; `GET /api/v1/users/options?q=` finds people. Record fields hold the other
record's id; `GET /api/v1/records/lookup?type=<type>&q=` finds records. `GET /api/v1/meta`
lists every record type you may view, with its fields (custom fields included) and lists.

Many record types also have routes of their own (an asset's check-out, a change's approvals,
a risk's acceptances, ...). They are all in the API reference.

## Pagination

Lists page with `page` (from 1) and `pageSize` (default 50, at most 500):

```
GET /api/v1/tickets?page=2&pageSize=100
```

The answer is `{ rows, total, page, pageSize }`, and its headers say where to go next:

```
X-Total-Count: 1234
Link: </api/v1/tickets?page=1&pageSize=100>; rel="first", </api/v1/tickets?page=1&pageSize=100>; rel="prev",
      </api/v1/tickets?page=3&pageSize=100>; rel="next", </api/v1/tickets?page=13&pageSize=100>; rel="last"
```

Follow `rel="next"` until there is none. The links keep your filters and sort. Records added
while you page can shift later pages; for a reliable full sync, sort on something that does not
change and filter on it, for example `sort=created_at&dir=asc&f.created_at.gt=<the last one you
saw>` (keyset paging), or `f.updated_at.gt=<your last run>` to fetch only what changed.

## Filtering

Filters are query parameters named after fields:

| Parameter | Matches |
|---|---|
| `f.status=new,assigned` | any of the comma-separated values |
| `f.assignee_id=me` | user fields: `me` is the caller |
| `f.due_at.gt=2026-01-01`, `.gte`, `.lt`, `.lte` | dates, times and numbers |
| `f.vendor_id.null=true` (or `false`) | records with no value (or with one) |
| `f.tags=depot,radio` | records carrying any of these tags |
| `f.tags.all=depot,radio` | records carrying every one of them |
| `f.tags.null=true` | untagged records |
| `f.cf_depot_code=north` | custom fields work like any other field |

Filters combine with "and". The API reference lists every filter of every record type. A
filter on a field the type does not have, including a field hidden while its option is
switched off (Administration > Features), or an unknown operator, answers 400 `bad_filter`,
for the list, its counts (`/stats`) and its exports alike. (The application's own list pages
leave such a filter out of a link or saved view instead.)

## Sorting

`sort=<field>&dir=asc|desc`, for example `sort=due_at&dir=asc`. Without `sort`, each type has
its own default order (newest first for most), and a search puts the best matches first. Rows
with no value come last.

## Full-text search

`q=` searches a record type's text fields: whole words, word endings, several words at once,
and the last word as a prefix (`q=depot rout` finds "Depot router"). Reference numbers
(`TKT-00042`) match as typed. Below three characters it is a plain substring match. Without a
`sort`, the best matches come first. `GET /api/v1/search?q=` searches every record type you may
view, with comments and attached file names, and answers with snippets.

## Exports

Any list exports its filtered, sorted rows (up to 50,000) instead of a page. A list with more
rows stops at 50,000: the file ends with a line saying so, and the response carries
`X-GRC-Export-Truncated: 50000` (the audit log CSV, `GET /api/v1/audit?format=csv`, does the same with
the newest 50,000 events).

| `format=` | Gives |
|---|---|
| `csv` | CSV, UTF-8 with a byte-order mark, a header row of field labels, display labels for list, user and record fields |
| `xlsx` | A spreadsheet with typed cells and the filters above the table |
| `pdf` | A printable table with the filters and the time it was produced. At most 12 columns (more answer `422 too_many_columns`); without `columns=`, the reference, the title and up to six short fields. At most 2,000 rows, fewer with many columns (16,000 cells), with a note when rows were left out |

`columns=ref,title,status` chooses the columns and their order. Exporting needs the type's
`.export` permission (for example `tickets.export`) and is audited; restricted content is
watermarked. `GET /api/v1/records/{type}/{id}/pdf` gives one record as a PDF fact sheet.

## Imports

- **Any record type from CSV or XLSX**: `GET /api/v1/import/{type}/fields` (what can be
  imported and matched), `GET /api/v1/import/{type}/template` (a CSV template),
  `POST /api/v1/import/{type}/read` (headers, sample rows, a suggested mapping), and
  `POST /api/v1/import/{type}` with `dryRun: true` (the default) to check, then
  `dryRun: false` to import. `mode` is `create`, `update` or `upsert`, with a `matchKey`.
  Every record goes through the same validation, rules and audit as one made by hand. The
  check runs the record type's own rules too (its before-save checks and, for a record that
  takes its restriction from another, the check that you can see that record), without
  writing, so a row the check passes is not refused by the import unless something changed
  in between.
- **Assets from a discovery or endpoint-management tool**: `POST /api/v1/assets/ingest`
  (below).
- **Vulnerability findings from a scanner**: `POST /api/v1/vulnerabilities/import` (below).

The user guide's [Importing and exporting](user/17-importing-and-exporting.md) page shows the
same imports on screen.

## Webhooks

Instead of polling, an integration can be told when records change: an administrator adds a
webhook (a URL and the events it wants, such as `ticket.create` or `risk.*`) under
**Administration > Webhooks**. Each delivery is a signed JSON POST (HMAC-SHA256 in
`X-GRC-Signature`), retried with back-off. Webhooks are off by default: outbound connections
must be switched on and the receiving host allowed. See
[Webhooks in the user guide](user/09-administration.md#webhooks), the security notes in
[Security: outbound webhooks](security.md#outbound-webhooks), and
`examples/webhook-receiver.mjs` for checking a signature. Webhooks are managed through
`/api/v1/admin/webhooks` (administrators). Adding a webhook, changing its address or turning
on restricted records, and replacing its secret need a recent password confirmation, so they
cannot be done with a token; listing, other changes, testing, reading and retrying deliveries,
and removing can (a token with `admin.administer`).

Addresses are kept encrypted: `GET /api/v1/admin/webhooks` answers `url_display`, `url_host`,
`url_fingerprint` and `host_allowed`, never `url`, and an empty `url` in a `PATCH` keeps the
address. `POST /api/admin/webhooks/:id/reveal` shows it after a password confirmation (audited).
A webhook's `preset` chooses the body: the full event (the default), `chat_text` (`{ "text": "…" }`)
or `chat_card` (`{ "title", "text", "link", "facts": [{ "name", "value" }] }`). Chat bodies carry a
summary and the names of changed fields, never values, and are signed the same way; `presets` in the
list answer names the choices.

A record change is sent as `<type>.create`, `<type>.update` or `<type>.delete`:

```json
{ "id": "<delivery id>", "event": "ticket.update", "occurredAt": "2026-11-19T14:05:00.000Z",
  "record": { "type": "ticket", "id": "…", "ref": "TKT-00042", "label": "TKT-00042 Ticket machine offline", "route": "/tickets/…" },
  "data": { "title": "…", "status": "in_progress", "…": "…" },
  "changes": { "before": { "status": "new" }, "after": { "status": "in_progress" } },
  "actor": { "id": "…", "name": "…" } }
```

### Other events

A webhook can also ask for these events, which are not record changes. The payload has the
same envelope, with the event's own fields in `data`; `record` names the record the event is
about (or is `null`), and `actor` is the person whose action caused it (`null` for scheduled
work). Subscribe by name, by family (`notification_clock.*`), or with `*`, which takes every
record change and every other event. A family name that is also a record type
(`security_incident.*`, `change.*`) takes that type's record changes and its other events.

| Event | When | Restricted | `data` |
|---|---|---|---|
| `notification_clock.warning` | A security incident's notification deadline is close (the clock turned amber); once per notification task. `record` is the notification task | always | `incidentId`, `incidentRef`, `party`, `required`, `dueAt`, `secondsRemaining` |
| `notification_clock.overdue` | The deadline passed with the notification still pending (the clock turned red); once per notification task | always | `incidentId`, `incidentRef`, `party`, `required`, `dueAt` |
| `security_incident.declared` | A security incident was declared, starting its notification clocks. `record` is the incident | always | `severity`, `declaredAt`, `clocks`, `firstDeadline` |
| `change.approval_decided` | An approver approved or rejected a change. `record` is the change. Kept for this release only: change approval now runs on approval workflows, so move to `workflow.decided` and `workflow.finished` (which carry `kind`, and `onBehalfOf` for a stand-in's decision) | as the change | `decision` (`approved` or `rejected`), `approver`, `approvalsReceived`, `approvalsRequired`, `status` |
| `report_schedule.delivered` | A report schedule ran and reached at least one person. Counts only: the figures stay in the application | never | `name`, `delivered`, `skipped`, `failed` |
| `workflow.decided` | Someone approved or rejected a step of an approval workflow, on any record type. `record` is the record | as the record | `workflow`, `kind` (the part of the application the approval belongs to, such as `change_approval`, or `null` for a workflow's own approval), `step`, `decision` (`approved` or `rejected`), `approver`, `onBehalfOf` (name of the approver a stand-in decided for, or `null`), `comment`, `approvalsReceived`, `approvalsRequired`, `stepOutcome` (`approved`, `rejected` or `pending`) |
| `workflow.finished` | An approval workflow ended: approved after its last step, rejected, or canceled. `record` is the record | as the record | `workflow`, `kind` (as for `workflow.decided`), `outcome` (`approved`, `rejected` or `canceled`), `reason`, `outcomeError` |
| `retention.anonymized` | An administrator anonymized a record from the retention review. `record` is the record as it is now | as the record | `recordType`, `fields` (keys of the fields replaced, custom fields as `cf_<key>`), `comments`, `files` |
| `retention.deleted` | An administrator removed a record for good from the retention review. `record` names it by `type`, `id` and `ref` only (`label` is the reference, `route` is `null`) | as the record | `recordType`, `purged` (always `true`) |
| `backup.failed` | A scheduled or manual backup failed | never | `runId`, `trigger` (`scheduled` or `manual`), `destination`, `message` |

The rules are those of record changes. An event marked **always** (about security incidents)
goes only to a webhook that includes restricted records, chosen by a person who still holds
`security.view`; one marked **as the change** is held back in the same way when that change is
restricted. Nothing is sent for a part of the application that is switched off
(Administration > Features), and its events are not offered: the notification clock and
incident events belong to Security incidents, the change approval to Change enablement, and
the report delivery to Dashboards and reports. `GET /api/v1/admin/webhooks` lists the events
on offer in `otherEvents`. Receivers should ignore events and fields they do not know: new
ones may be added within v1.

### Retention decisions

Anonymizing a record or removing it for good from the retention review (Administration >
Retention) changes it outside the usual edit, so a system that mirrors records through
webhooks is told twice over, and never sent a value from before the change:

- **Record changes.** A webhook that follows the type (`ticket.*`, `ticket.update`,
  `ticket.delete` or `*`) receives `<type>.update` for an anonymized record, with only the
  replaced fields and their new values (the placeholder text, or `null` for a person) in `data`
  and `changes: { fields: [...], after: {...} }` (no `before`), and `<type>.delete` for a
  removed record, with `data: {}` and `purged: true`. Both carry `retention: { decision:
  "anonymized" | "deleted" }`.
- **Other events.** A webhook that asks for `retention.anonymized`, `retention.deleted` or
  `retention.*` receives the event in the table above.

A webhook subscribed to `*` receives both. A restricted record is held back from webhooks that
do not include restricted records, as for any change.

## Errors

Every error answer has the same shape, with a matching HTTP status:

```json
{ "error": { "code": "validation", "message": "Check the highlighted fields.", "fields": { "title": "Required." } } }
```

`code` is stable and meant for programs; `message` is plain English, safe to show to a person;
`fields` names the fields at fault on a validation error.

| Status | Common codes | Meaning |
|---|---|---|
| 400 | `validation`, `bad_json`, `bad_group`, `bad_idempotency_key`, `bad_path` | The request is not valid; fix it before sending it again |
| 401 | `unauthenticated`, `invalid_token` | No token, or the token is wrong, expired or revoked |
| 403 | `forbidden`, `token_not_allowed`, `reauth_required`, `csrf` | Not permitted |
| 404 | `not_found`, `switched_off` | Not there, or not visible to you (restricted records answer 404); `switched_off`: that part of the application is switched off by an administrator (Administration > Features), and its record types are also missing from `/api/meta`, search and the OpenAPI document |
| 409 | `version_conflict`, `idempotency_in_progress`, and route-specific conflicts | The record changed, or the request clashes with its state |
| 422 | `idempotency_key_reused` | The `Idempotency-Key` was used for a different request |
| 429 | `rate_limited` | Too many requests; wait for `Retry-After` seconds |
| 500 | `server_error` | Something went wrong on the server; it is logged. Quote the `X-Request-Id` |

Retry `429` (after `Retry-After`), `500`, `502`, `503` and network failures, with back-off;
make creates safe to retry with `Idempotency-Key`. Do not retry other `4xx` answers unchanged.

## Request ids

Every answer carries `X-Request-Id`. Send your own (1 to 128 letters, digits and `._:@-`, for
example your job's run id) and it is used and sent back; otherwise one is made up. Log it beside
your own records, and quote it when you report a problem: it ties your call to the server's
answer.

The same id is stored on every audit event the request causes (`request_id`), so you can find
your own changes in the audit log: `GET /api/v1/audit?request_id=<id>` (needs `audit.view`)
returns every event of that one request, and the audit log screen has a **Request id**
filter. The CSV export (`format=csv`) has `token_name` and `request_id` columns. Requests to the MCP endpoint (`/mcp`) carry it too: every
tool call an assistant makes in that request, and every change the tool causes, records the
id of the `/mcp` request, and the AI assistant call log shows it.

## Rate limits

Each token may make `tokens.rate_per_minute` requests a minute (600 by default; an
administrator can change it). The count is kept in the database, so it is the same whichever server
process answers. Answers to token requests say where you stand:

```
RateLimit-Limit: 600
RateLimit-Remaining: 593
RateLimit-Reset: 41
RateLimit-Policy: 600;w=60
```

`RateLimit-Reset` is the number of seconds until the count starts again (the window is the
clock minute). Over the limit, the answer is `429 rate_limited` with `Retry-After`. Repeated
requests with a wrong token are also limited, by source address. Spread large syncs out, use
large pages (`pageSize=500`) rather than many small ones, and use webhooks or
`f.updated_at.gt=` instead of re-reading everything.

## Idempotency

A network failure after you send a create leaves you not knowing whether the record was made.
Send an `Idempotency-Key` header (a UUID, or anything unique for that create, up to 255
characters) with `POST` to a record type's path, and send the same key when you retry:

- the first request is handled as usual and its answer stored for 24 hours;
- a repeat with the same key and the same body gets the stored answer again, with
  `Idempotent-Replayed: true`, and no second record is made;
- the same key with a different body is refused: `422 idempotency_key_reused`;
- while the first request is still running, a repeat gets `409 idempotency_in_progress`;
  try again shortly;
- a refused request (any `4xx` or `5xx`) is not stored, so you can correct it and send it again
  with the same key.

Keys belong to the token (or session) that sent them.

The mobile app's outbox (`POST /api/mobile/sync`, `PUT /api/mobile/sync/attachment`) has its own
per-item idempotency: each item's client-made UUID is kept for 7 days and a repeat is answered from
memory (see [Mobile app](mobile.md#offline-work)). These routes accept only the app's token. A photo
upload larger than the organization's attachment limit is refused from its `Content-Length` with
`too_large`, and a phone sending more than 2 photos at once gets `retry` with code `busy`.

## Optimistic concurrency

One record (`GET`, and the answers to `POST` and `PATCH`) carries an `ETag`, its version. To
change a record only if nobody else has changed it since you read it, send that value back in
`If-Match` with `PATCH` (or `DELETE`):

```
PATCH /api/v1/tickets/3b0f...   If-Match: "Xq3vY0n1V0lT5bm8x0dZbA"
```

If the record has changed since, the answer is `409 version_conflict` with the current `ETag`:
read the record again, reapply your change, and send it again. `If-Match: *` matches any
version. Without `If-Match`, the change is applied as it always is (the last change wins). The
web application does not send it. The `If-Match` check is made again in the save itself, so it holds
when several server processes serve the API.

## Paged answers added in wave 19

- `GET /api/legal-holds/:id/records` takes `state`, `page` and `pageSize` (at most 500) and answers
  `shown`, `page` and `pageSize`.
- `GET /api/controls/coverage-matrix` takes `state`, `type`, `page` and `pageSize`, and answers `all`,
  `total`, `page` and `pageSize`.
- `GET /api/fleet/impact` takes `limit` (default 500).
- `GET /api/fleet/coverage` and `GET /api/audits/coverage` take `page` and `pageSize` and answer
  `total`, `page` and `pageSize`.
- `GET /api/records/settings` adds `workingCalendar` and `holidays`.

## Audit log and backups

`GET /api/audit` returns `totalCapped` and `hasMore`: `total` counts at most 10,000 matching events;
page on with `hasMore`. `actor_id` must be a uuid (400 `bad_filter` otherwise). `POST /api/backups/run`
queues a job and returns `{ jobId, overview }`; follow it with `GET /api/backups` (`active`, `queued`,
`runs[].progress`). Any request may answer 503 `busy` with `Retry-After` when the database is
saturated: retry after that many seconds.

## Restricted records

Security incidents, vulnerabilities, restricted risks (cybersecurity risks by default), and records
an editor marks restricted (and actions raised on them) are visible only to people who hold `security.view`, and so only to tokens of
such people that include that scope. Without it, they are absent from lists, counts, stats,
search, links and exports, and answer `404` by id. An integration that must see them needs a
token with `security.view` from someone who holds it; keep such tokens especially well.

## User provisioning (SCIM 2.0)

An identity provider creates, changes and deactivates accounts through SCIM 2.0 at
`/api/scim/v2` (also `/api/v1/scim/v2`), once an administrator switches provisioning on and
makes a provisioning token (see
[User provisioning](user/35-user-provisioning-and-log-forwarding.md#user-provisioning)).

- Authenticate with `Authorization: Bearer grc_scim_…`; sessions and personal access tokens are
  not accepted there, and no CSRF header is needed. Bodies are `application/scim+json`.
- `Users` and `Groups` support create, read, replace, patch and delete (a user's delete or
  `active: false` deactivates; nothing is removed). `ServiceProviderConfig`, `ResourceTypes` and
  `Schemas` describe what is supported.
- Filters: users by `userName`, `externalId`, `emails.value` or `id`; groups by `displayName`,
  `externalId` or `id` (`eq`). `count` is at most 200; `excludedAttributes=members` leaves a
  group's members out. Bulk requests and sorting are not supported.
- Errors use the SCIM error shape (`schemas`, `status`, `scimType`, `detail`). Deactivating the
  last active administrator is refused with `409` and no `scimType`; a duplicate user name is
  `409` with `scimType: "uniqueness"`.
- An account that can administer (any `*` or `admin.` grant) may be deactivated (`DELETE` or
  `active: false`) only when provisioning created it; changing its email address or enabling it
  again answers 403 with `scimType: "mutability"`. `PUT /api/admin/scim/groups/:id/roles` refuses any
  role with an `admin.` grant (400).
- Without a trusted application address (`auth.public_url`, or a Host naming this computer), single
  sign-on start, link and re-confirmation and `GET /api/auth/sso/:key/metadata` answer 409
  `public_url_required`.

## Calendar feeds and the work-tracker bridge

Two public routes take no session or token; each proves itself another way (see
[Calendar feeds, work trackers and evidence links](user/36-calendar-feeds-work-trackers-and-evidence-links.md)):

- `GET /api/calendar/<secret>.ics`: a person's calendar feed, read as that person each time.
  It answers `404` while feeds are switched off or the address is revoked.
- `POST /api/integrations/tracker/:connectorId/status`: an outside work tracker's status update,
  signed with HMAC-SHA256 over `<timestamp>.<body>` (`X-GRC-Timestamp`, `X-GRC-Signature`),
  refused when more than five minutes off or replayed. The format is in the guide's
  [For the people setting up the tool](user/36-calendar-feeds-work-trackers-and-evidence-links.md#for-the-people-setting-up-the-tool).

The connections themselves are managed under `/api/admin/tracker-connectors` (administrators), and a
record is sent with `POST /api/tracker/send`. The kinds of record offered (`kinds` in the connection
list) leave out those of a switched-off part of the application, and the route descriptions name no
kind of record, so the API reference stays free of switched-off parts.

Exclusion-list checks of vendors never call an outside service; they are recorded by hand
against lists the organization names.

## Asset tags and inventory counts

The asset-tag routes are under `/api/asset-tags` (`/api/tags` is a different thing: the free-text
labels any record can carry). Request and response shapes are in
[`shared/asset-tags-api.ts`](../shared/asset-tags-api.ts); the guide page is
[Asset tags](user/38-asset-tags.md). All of them answer `404 switched_off` while the Asset tags area
is off.

- **Lookup:** `GET /api/asset-tags/lookup?value=<text>&source=typed|handheld` for one value, or
  `POST /api/asset-tags/lookup` with `{ candidates: [{ value, source }] }` (1 to 10; the app's
  camera sends what it read, `source` `code` or `text`). Each result has an `outcome`
  (`current`, `replaced`, `in_stock`, `unknown_format`, `identifier`, `misread`, `nothing`), a
  message and the tag cards with the actions the caller may take. Unknown values, records the caller
  may not see and records in a switched-off area answer `nothing` alike. Values are compared by
  their comparison form (`valueKey` in `shared/tag-format.ts`): case, spaces, dashes and underscores
  do not matter, leading zeros do.
- **Formats, stock, series:** `/api/asset-tags/formats` (and `POST .../formats/try`),
  `/api/asset-tags/ranges` (409 `overlap`), `/api/asset-tags/stock/mark`, `/api/asset-tags/series`
  (`tags.view` to read, `tags.manage` to change).
- **On a record:** `GET /api/asset-tags/record?type=&id=`, `POST /api/asset-tags/attach`,
  `/replace`, `/end` (`tags.manage` and edit on the record; 409 `in_use`, `on_hold`,
  `one_per_record`). `GET /api/asset-tags/last-seen?type=&id=` gives the newest logged lookup, or
  `null` unless the caller may edit the record; it never holds a location.
- **Printing:** `POST /api/asset-tags/print` gives a PDF or ZPL (`tags.manage`, at most
  `tags.print_limit` labels, audit-logged).
- **Inventory counts** are the record type `inventory_count` at `/api/inventory-counts` (the
  generated routes, `tags.view` to read). Starting, counting and finishing need `tags.count`:
  - `POST /api/inventory-counts/start` `{ site_id, area?, record_types?, title?, notes? }` creates a
    count and fixes its expected list (the generated `POST` does the same but also needs
    `tags.create`); `GET /api/inventory-counts/countable` lists the kinds a count can cover.
  - `GET /api/inventory-counts/:id/items?state=&expected=` lists what is expected and found, with
    totals (records the caller may not see are listed without their name).
  - `POST /api/inventory-counts/:id/found` `{ value, source }` or `{ recordType, recordId }` answers
    `found`, `already_found`, `unexpected` or `not_found`. Finding twice is harmless, and several
    people (or phones) may count at once.
  - `POST /api/inventory-counts/:id/finish` marks what was not found missing and returns the
    summary; `POST /api/inventory-counts/:id/cancel` closes an open count without that.
  - `POST /api/inventory-counts/:id/resolve` `{ itemIds, resolution: moved | marked_missing | left }`
    after finishing (record changes go through the normal update and need edit permission).
  - `POST /api/inventory-counts/:id/raise` `{ kind: ticket | action, title?, ownerId? }` turns the
    discrepancy summary into a ticket or an action.
  - `GET /api/inventory-counts/report?days=&site=` gives counts by status, coverage by site (the
    same for everyone) and the records not verified within `days`.

## Vehicle and asset models

Record types `vehicle_model` (`/api/vehicle-models`, fleet permissions, off with Fleet and services)
and `asset_model` (`/api/asset-models`, assets permissions). Vehicles and assets carry `model_id` and
`model_overrides` (inherited fields the record keeps as its own). On create or update, inherited
fields not sent and not overridden take the model's value; a field left empty on the model is not
passed on. A sent value that differs from the model's becomes an override, and sending
`model_overrides` without a field clears its override. A model's `PATCH` applies the change to its
members and answers with `_model_change` (`status`, `total`, `applied`, `kept`, `refused`).

Further routes, under `{base}` = `/api/vehicle-models` or `/api/asset-models`:
`{base}/:id/preview`, `/summary`, `/changes[/:changeId]`, `/assign/preview`, `/assign`
(`{ ids, keep }`), `{base}/suggestions`, `{base}/inherited-fields` (GET; PUT `{ custom: [keys] }`
needs `admin.administer`), and `/api/vehicle-models/:id/equipment` (GET; PUT
`{ items: [{ asset_type, count, asset_model_id? }] }`). `/api/fleet/coverage` rows add `detail` per
cell, and `/api/vehicles/:id/equipment` adds `count`, `source`, `installed`, `working`,
`not_working` and `missing`. Imports resolve a model by name.

## Routes added in wave 20

### Departments and scoped roles

- `/api/departments` (record type `department`, `people.*`; pickers and labels are open to everyone
  signed in); `POST /api/departments/:id/merge { into }` (`people.delete`).
- `GET /api/admin/roles` returns `scopable`; `POST`/`PATCH /api/admin/roles` accept
  `scopes: { <module>: 'department' | 'site' }`.
- Assets, actions, projects and business processes take `department_id`, and still accept
  `department` as a name; actions take `site_id`; sites take `parent_id` and `manager_id`.

### My work and the compliance calendar

- `GET /api/work/mine?days=30&limit=5&skip=<keys>`: your own due work across every area that is on,
  one section per kind (calendar source), overdue first.
- `GET /api/work/calendar?from&to&person=me|all|<user id>&area=<keys>&kind=<keys>`: everything dated
  in the window (at most 400 days; default the current month) that you may see; `ownOnly` lists
  kinds that give only your own items.
- Kinds of switched-off areas are left out of both.

### User access reviews

- `/api/system-accounts` (with `POST /import` and `POST /rematch`).
- `/api/access-reviews` (with `/:id/systems`, `/launch`, `/decisions`, `/systems/:systemId/sign-off`,
  `/items/:itemId/removed`, `/removals`, `/complete`, `/cancel`, `/control-test`, `/export`,
  `/totals`, and `GET /mine` and `GET /summary`).

### Figures over time

- `/api/figures` (GET list, `?months=`; POST create, needs `reports.create`), `/api/figures/:id`
  (GET with `months`; PATCH needs `reports.edit`; DELETE needs `reports.delete`).
- `POST /api/figures/record` (`reports.edit`).
- `GET /api/figures/:id/export?format=pdf|xlsx|csv|html&months=` (`reports.export`).
- Figures are the same for everyone; seeing one needs view on its record type's module.

### Disposal, meetings, heat map and the audit archive

- `GET /api/assets/:id/data-wiping-certificate.pdf` (`assets.view`).
- `GET /api/meetings/:id/invitations` (`governance.view`); `POST /api/meetings/:id/invitations`
  (`governance.edit`; 409 `mail_off`, `not_invited`, `meeting_past`, `minutes_approved`, `nobody`;
  429 `rate_limited` after 10 sends per meeting in an hour);
  `GET /api/meetings/:id/invitation.ics` (`governance.view`).
- `GET /api/risks/heatmap/common?basis=&include_closed=` (`risks.view`; `basis` is `residual`,
  `inherent` or `target`; restricted risks are counted but masked for people without
  `security.view`; the same shape as `/api/risks/heatmap`, scale key `_common`).
- `GET /api/audit/archive` now also returns `ownerCommand`.

### Version and the update check

- `GET /api/admin/about`, `PATCH /api/admin/about { updateCheck }` (administrators): the version and
  the update check.

## Routes added in waves 21 and 22

### Confidential safety reporting

- `GET /api/safety/confidential-viewers` (`safety.view`), `PUT /api/safety/confidential-viewers`
  (`safety.administer`; adding someone asks for a recent password confirmation): the people named to
  see confidential reporters.
- `GET /api/safety-events/:id/reporter`: a confidential event's reporter, for named people with
  `safety.view` only; every look is audited (`safety_event.reporter_view`).
- `POST /api/portal/safety-reports` takes `confidential: true`; `GET /api/portal/safety-reports`
  rows carry `confidential`, `outcome` and `closed_on`.

### Safety and security certification of projects

- `GET /api/projects/:id/certification`; `POST /api/projects/:id/certificates` (409
  `certification_open` while a required item is open);
  `POST /api/projects/:id/certificates/:certId/withdraw`;
  `GET /api/projects/:id/certificates/:certId/pdf`.
- Record types `cert_item` (`/api/certifiable-items`) and `cert_requirement`
  (`/api/certification-requirements`). Gate templates take `requires_certificate`.

### Registers

- `/api/registers/:register` (with `/stats` and `/:id`) serves every register's records with the
  usual list contract; `/api/admin/registers` defines registers.

### Translated policies and languages

- `GET /api/policies/translation-languages`; `GET /api/policies/:id/versions/:vid/translations`;
  `PUT` and `DELETE /api/policies/:id/versions/:vid/translations/:lang`.
- `lang` on `/api/policies/acknowledgments/mine`, `/api/policies/acknowledgments/:ackId` and
  `/api/policies/kiosk/pending`; `language` on acknowledge, on the kiosk (`languages` per document)
  and on sign-in sheets.

### Vendor intake, risk tiers and contractor performance

- Vendor intake and risk tiers: `GET`/`PUT /api/vendors/intake-settings`,
  `POST /api/vendors/intake/preview`, `GET`/`POST /api/vendors/:id/intake`,
  `GET`/`POST /api/vendors/:id/checks`, `DELETE /api/vendors/:id/checks/:checkId`.
- Contractor performance: `GET /api/contracts/:id/performance`, `GET /api/contracts/performance`,
  `POST`/`PATCH`/`DELETE /api/contracts/:id/measures[/:measureId]`,
  `POST /api/contracts/:id/measures/:measureId/scores`,
  `PATCH`/`DELETE /api/contracts/:id/scores/:scoreId` (send the score's `updated_at` to get 409
  `version_conflict` when it changed).

### Outside reviewers

- `GET`/`POST /api/audits/:id/outside-reviewers` and `/api/compliance-reviews/:id/outside-reviewers`,
  with `PATCH …/:grantId`, `POST …/:grantId/revoke` and `POST …/:grantId/resend`.
- `GET /api/admin/outside-reviewers`, `POST /api/admin/outside-reviewers/:grantId/revoke`.
- For the reviewer: `GET /api/outside-review`, `/api/outside-review/:grantId` and
  `/api/outside-review/:grantId/files/:fileId`.
- `PUT /api/audit-requests/:id/files`, with `GET`/`DELETE /api/audit-requests/:id/files/:fid`: the
  person asked for evidence attaches files without `audits.edit`.

### Control test steps and coverage import

- `GET`/`POST /api/controls/:id/steps`, `PATCH`/`DELETE /api/controls/:id/steps/:stepId`,
  `PUT /api/controls/:id/steps/order`.
- `GET /api/control-tests/:id/steps`, `POST /api/control-tests/:id/steps/copy`,
  `PATCH /api/control-tests/:id/steps/:rowId`.
- `POST /api/controls/coverage/import`, `GET /api/controls/coverage/import-template`.

### Call trees

- `POST`/`GET /api/emergency-activations/:id/call-outs`,
  `POST /api/emergency-activations/:id/call-outs/:cid/recipients/:rid/acknowledge`,
  `POST /api/emergency-activations/:id/call-outs/:cid/remind`.
- Public (no sign-in): `GET`/`POST /api/call-out/:token`, the acknowledgment link.

### Records retention and file previews

- `/api/record-series` and `/api/records-destructions`, with `/:id/state`, `/:id/submit`,
  `/:id/carried-out` and `/:id/cancel`.
- `GET /api/attachments/:id/preview`: images and PDFs inline; 415 `no_preview` otherwise.

## Changes in wave 23 (security review)

- `POST /api/meetings/:id/invitations`: 429 `rate_limited` after 10 sends per meeting per hour.
- `POST`/`PATCH /api/figures`: 400 on `record_type` when the caller may not report on that type
  (restricted types need `security.view`), 400 on `filters` for a link into a type the caller may
  not report on or for a filter on restricted records' words without `security.view`.
- `PUT`/`DELETE /api/policies/:id/versions/:vid/translations/:lang` on the published version: 403
  without `policies.approve`; translations carry `sha256`. Acknowledgment tracking rows carry
  `translation_sha256`; the CSV adds **Translation read (SHA-256)**.
- `PATCH /api/contracts/:id`: moving an active contract to another vendor is checked like an
  activation (400 on `vendor_id`).
- `DELETE /api/admin/registers/:key`: 409 `in_use` if a record arrived during the removal.
  `POST /api/admin/registers`: 400 on `key` while records are stored under that key.
- `GET {path}/stats`: for a person with a department or site scope, groups by a detail field put
  out-of-scope rows under `{ value: null, label: 'Other records', restricted: true }`.
- Access-review items: `own` and `mayDecide` also treat an account whose name or email matches the
  caller's username or email (case-insensitive) as the caller's own.
- `PATCH /api/admin/users/:id` with roles on an outside reviewer's account answers 400
  `fields.roles`. `/api/users/options?q=` leaves out outside reviewer accounts.
- `POST /api/departments/:id/merge`: 403 for people whose roles are scoped, unless they hold
  `admin.administer`.

## Routes added in wave 25

Every route below is also in the OpenAPI document (Help > API reference). A route of a switched-off
area answers 404 `switched_off`.

### Evidence library

Record type `evidence_record` (reference `EVD-`) at `/api/evidence-library` (permission module
`evidence`; area **Evidence library**). Restricted records and department scope apply as usual;
`GET /api/evidence-library/summary` gives figures over every record, the same for everyone.

- `GET /api/evidence-library/link-types`: the record types and parts evidence can be linked to.
- `GET /api/evidence-links?record_type=&record_id=&part=`, `POST /api/evidence-links { evidence_id,
  record_type, record_id, part?, relation? }`, `DELETE /api/evidence-links/:id`: linking needs
  `evidence.view` and the right to change the record (or the part's own rule); a part may refuse
  changes on link and unlink (a reviewed workpaper step). Answers give the visible links and a
  count of hidden ones.
- `GET /api/evidence-library/:id/used-by`: the records an evidence record is linked to.
- `POST /api/evidence-library/upload`: a finished chunked upload becomes a new evidence record,
  optionally linked to a record, in one step.

### Funders and connected funder reviews

- Record type `funder` (`FDR-`) at `/api/funders`; `GET /api/funders/:id/summary`. Awards,
  certifications and reviews take `funder_id` (a `funder_name` alone finds or files the funder).
- `GET`/`PUT /api/compliance-reviews/:id/awards`, `GET /api/funding-awards/:id/reviews`.
- `POST /api/compliance-reviews/:id/areas/:code/links` (a control, obligation or document),
  `DELETE .../links/:lid`, `GET .../areas/:code/suggested-evidence`.
- `POST /api/compliance-reviews/:id/requests/:rid/files` (the request's assignee or `funding.edit`):
  files a finished upload into the evidence library and links it to the request.
- `POST /api/compliance-reviews/:id/carry-forward`, `POST /api/compliance-reviews/:id/next`,
  `GET /api/compliance-reviews/:id/previous`.

### Audits

- `GET`/`PUT /api/audits/plan/settings` (`audits.administer` to change), `GET /api/audits/plan` (the
  ranked audit universe), `POST /api/audits/plans`, `GET /api/audits/plans/:id`,
  `POST /api/audits/plans/:id/approve` (`audits.approve`, not the preparer),
  `POST /api/audits/plans/:id/create-audits`.
- `POST /api/audits/:id/steps/:itemId/prepare | review | notes`,
  `POST /api/audits/:id/steps/:itemId/notes/:noteId/clear`, `GET /api/audits/:id/workpaper-status`.
  A reviewed step is locked (409 `step_reviewed`).
- `POST /api/audit-findings/:id/ready-for-verification`, `POST /api/audit-findings/:id/verify`
  (date, note and evidence; not by a person who owns the fix). A person closes a finding only once
  it is verified; a corrective action plan raised from a finding closes only once that finding is
  verified.
- Control tests take `audit_id` and `reviewer_name`.

### Committees and meetings

- `GET`/`POST /api/meetings/:id/agenda`, `PATCH`/`DELETE /api/meetings/:id/agenda/:itemId`,
  `PUT /api/meetings/:id/agenda/order`, `POST /api/meetings/:id/agenda/:itemId/papers`,
  `DELETE /api/meetings/:id/agenda/:itemId/papers/:paperId`.
- `POST /api/meetings/:id/motions`, `PATCH /api/meetings/:id/motions/:decisionId`,
  `POST /api/meeting-decisions/:id/resolution-number`.
- `GET /api/meetings/:id/minutes/approvals`, `POST /api/meetings/:id/minutes/approve`,
  `POST /api/meetings/:id/minutes/publish`, `GET /api/meetings/:id/minutes/pdf?version=public|members`,
  `GET /api/meetings/:id/book?version=public|members&text=1` (the board book PDF).
- Member reading view (session only, no permission; answers only for the committee's members):
  `GET /api/governance/my-meetings`, `/my-meetings/:id`, `/my-meetings/:id/book`,
  `/my-meetings/:id/minutes`, `/my-meetings/:id/papers/:paperId`.

### Service desk, security incidents, vulnerabilities and IT figures

- `POST /api/tickets/:id/security-incident`, `POST /api/tickets/:id/change`,
  `POST /api/tickets/:id/problem`, `POST /api/tickets/:id/duplicate`, `POST /api/problems/:id/tickets`,
  `DELETE /api/problems/:id/tickets/:ticketId`.
- `GET /api/security-incidents/:id/next-step`, `POST /api/security-incidents/:id/advance`.
- `GET /api/vulnerabilities/groups`, `GET /api/vulnerabilities/group`, `POST /api/vulnerabilities/bulk`,
  `POST /api/vulnerabilities/raise-change`, `GET`/`POST /api/vulnerabilities/known-exploited` (the
  catalog loaded from a JSON or CSV file; no outbound request).
- `POST /api/frameworks/:id/send-to-owners { due_on, snapshot_id?, priority_only?, dry_run? }`
  (`frameworks.edit` and `actions.create`).
- `GET /api/contracts/spend-summary`, `GET /api/vendors/spend-summary` (totals over every record).
- `GET /api/changes/success-rate?from=&to=` (default the last 90 days).
- The inventory reminders run also answers `systems` (end-of-support reminders).

### Risks, documents and AI assistants

- `GET /api/risks/appetite/versions`; `PUT /api/risks/appetite` records a version (see
  [Read risk summaries](#read-risk-summaries)); risks take `target_likelihood`, `target_impact`
  and `target_on`, and `restricted` (set only by people holding `security.view`).
- `POST /api/policies/:id/versions/:vid/acknowledgments { user, acknowledged_at, language? }`
  (`policies.edit`; data load mode only, 409 `not_loading` otherwise): a reader's past
  acknowledgment of a version.
- `GET /api/mcp/people?q=` (AI assistant tokens only): an account by exact username, email or
  display name.

## Routes added in wave 26

Every route below is also in the OpenAPI document (Help > API reference). A route of a switched-off
area answers 404 `switched_off`; **Civil rights** starts off.

### Procurement and budgets

Record types `procurement` (`PRC-`, `/api/procurements`), `procurement_offer` (`OFR-`,
`/api/procurement-offers`; before the award only `procurement.edit` holders and the evaluation committee
read offers), `purchase_order` (`PO-`, `/api/purchase-orders`; the status is set by the routes below),
`purchase_order_line` (`/api/purchase-order-lines`), `budget` (`BUD-`, `/api/budgets`) and `budget_line`
(`BL-`, `/api/budget-lines`); permission module `procurement`.

- `GET /api/procurements/:id/evaluation`, `PUT .../criteria`, `POST`/`PATCH`/`DELETE .../evaluators[/:eid]`,
  `GET .../offers-summary`, `POST .../award`, `POST .../contract` (make or link the resulting contract),
  `GET`/`POST .../addenda`, `DELETE .../addenda/:aid`, `GET`/`POST .../protests`, `PATCH .../protests/:pid`,
  `GET`/`PUT .../clauses`.
- Committee members, with no procurement role: `GET /api/procurement/my-evaluations[/:id]`,
  `POST .../:id/declaration`, `PUT .../:id/scores`.
- `POST /api/purchase-orders/:id/submit | decision | issue | receipts | close | cancel`,
  `GET .../lines | receipts | approval | budget-check`; `GET /api/budgets/:id/figures`,
  `GET /api/budget-lines/:id/figures`; `GET /api/procurement/summary`; `GET`/`PUT /api/procurement/settings`.

### Insurance

Record types at `/api/insurance/policies`, `/conditions`, `/requirements`, `/certificates` and `/claims`
(claims are restricted per claim); permission module `insurance`.

- `GET .../policies/:id/conditions`, `GET`/`POST .../policies/:id/covered`, `DELETE .../covered/:item`,
  `POST .../policies/:id/renew`, `GET /api/insurance/covering?type=&id=` (the policies covering a record),
  `GET /api/insurance/contracts/:id/check`, `GET /api/insurance/renewals`, `GET /api/insurance/summary`,
  `GET`/`PUT /api/insurance/settings`.

### Civil rights

Record types at `/api/civil-rights/templates`, `/programs`, `/reports`, `/complaints`, `/goals` and
`/awards` (a confidential complaint is readable only by its named handlers, investigator and creator);
permission module `civilrights`; area off by default.

- `GET /api/civil-rights/complaints/:id/clock`, `GET`/`PUT /api/civil-rights/complaint-handlers` (recent
  password), `GET .../reports/:id/submissions`, `POST .../reports/:id/submit`, `GET /api/civil-rights/attainment`,
  `GET .../goals/:id/attainment`, `GET .../goals/:id/export` (CSV), `GET /api/civil-rights/summary`,
  `GET`/`PUT /api/civil-rights/settings`, `POST /api/civil-rights/reminders/run`.

### Strategy and performance

Record types at `/api/strategy/plans`, `/goals`, `/objectives`, `/measures`, `/measure-values`,
`/initiatives`, `/updates`, `/stat-series`, `/stat-values` and `/submissions`; permission module `strategy`.

- `GET /api/strategy/plans/:id/scorecard`, `GET .../scorecard.pdf` (PDF/UA, audited), `GET .../matrix`,
  `GET /api/strategy/measure-sources`, `POST /api/strategy/measures/:id/pull`,
  `GET /api/strategy/stat-series/:id/values`, `GET /api/strategy/summary`, `GET`/`PUT /api/strategy/settings`.

### Operations

- Defects: record type `defect` (`DEF-`) at `/api/defects`; `POST /api/inspections/:id/defects`,
  `GET /api/inspection-history/:type/:id`.
- Missed inspections: `POST /api/inspections/:id/missed-reason | reschedule | follow-up`,
  `GET /api/inspections/attention` (figures).
- Vehicle retirement: `GET`/`POST /api/vehicles/:id/retirement-requests`,
  `POST .../:rid/decision`, `POST .../:rid/withdraw`. A person can no longer set a vehicle's status to
  Retired with `PATCH /api/vehicles/:id` without an approved request (409 `retirement_not_approved`).
- `GET`/`PUT /api/safety/plans`, `GET /api/safety/indicator-status`.

### Documents, committees, audits, risks and funding

- `GET`/`POST /api/policies/:id/copies`, `PATCH .../copies/:cid`, `POST .../copies/:cid/recall` (paper copies).
- `GET`/`POST /api/meetings/:id/declarations`, `DELETE .../declarations/:declarationId`,
  `POST /api/governance/my-meetings/:id/declarations` (a member declares an interest);
  `GET`/`POST /api/committees/:id/work-plan`, `PATCH`/`DELETE .../work-plan/:itemId`,
  `GET /api/meetings/:id/work-plan`, `POST /api/meetings/:id/agenda/from-work-plan`. Votes take `recused`.
- `GET`/`POST /api/audits/:id/time`, `DELETE .../time/:entryId`; `POST /api/audits/plans/:id/approve`
  takes `decision_id` (a carried committee decision).
- `GET /api/risks/categories`, `PUT /api/risks/categories/:category/restriction` (`risks.administer` and
  `security.view`); a new appetite version (`POST /api/risks/appetite/versions`) takes `decision_id`.
- `GET /api/compliance-reviews/:id/readiness`, `GET /api/compliance-reviews/:id/package` (a ZIP).
- `GET /api/changes/success-rate` counts "caused" links from a change to a ticket, security incident or
  safety event; change answers carry `caused_incident`.

### Home pages, My work and data loads

- `GET /api/work/home` (where the caller lands), `GET /api/work/waiting` (`{ count }` for the menu),
  `GET`/`PUT /api/work/role-homes` (`admin.administer`).
- `GET /api/work/report/options`, `POST /api/work/report/safety`, `POST /api/work/report/help`,
  `GET /api/work/report/mine`: Report a problem, for everyone signed in, each kind only while its area is on.
- `GET /api/admin/data-load/records` (rows a module lists one by one), `POST /api/admin/data-load/undo-one`.
  In a load, `POST /api/attachments/link` keeps `created_at` and the link is undone with the load;
  `PATCH /api/security-incidents/:id/checklist/:itemId` takes `done_at`.

## Routes added in wave 27

Every route below is also in the OpenAPI document (Help > API reference). A route of a switched-off
area answers 404 `switched_off`.

### Procurement: invoices and budget versions

Record types `purchase_invoice` (`INV-`, `/api/purchase-invoices`; the status is set by the routes
below), `purchase_invoice_line` (`/api/purchase-invoice-lines`) and `budget_version`
(`/api/budget-versions`: the adoption, version 0, and each amendment); permission module `procurement`.

- `GET`/`POST /api/purchase-orders/:id/invoices` (an order's invoices; enter one with its lines),
  `GET /api/purchase-invoices/:id/lines | approval`, `POST /api/purchase-invoices/:id/submit | decision |
  payment | void`. Approval is never by the person who entered the invoice, and an invoice that does not
  match the order and receipts needs a reason. `GET`/`PUT /api/procurement/settings` takes
  `invoice_tolerance_pct`.
- `GET /api/budgets/:id/versions`, `GET /api/budget-versions/:id/lines`. Only the latest version can be
  deleted (409 otherwise, outside a data load); deleting it puts the lines back.

### Insurance

Record types `insurance_claim_payment` (`/api/insurance/claim-payments`, restricted with its claim),
`insurance_premium_share` (`/api/insurance/premium-shares`), `insurance_schedule_item` (`SOV-`,
`/api/insurance/schedule`) and `insurance_certificate_request` (`CIR-`,
`/api/insurance/certificate-requests`). A claim's `paid_to_date` and `recovered` are worked out from its
payments (read-only).

- `GET /api/insurance/policies/:id/allocation`, `POST .../allocation/from-covered`,
  `GET /api/insurance/allocation` (`format=csv`), `GET /api/insurance/schedule/summary`,
  `POST /api/insurance/policies/:id/schedule/from-covered`.
- `POST /api/insurance/certificate-requests/:id/send | remind`,
  `GET`/`PUT /api/insurance/certificate-requests/settings` (switching requests on needs a recent password).
- The vendor's upload page (public; the link's secret is sent in the `X-Upload-Token` header, rate
  limited): `GET /api/insurance/certificate-upload`, `POST .../files`, `DELETE .../files/:fid`,
  `POST .../certificates`, `POST .../done`.
- `GET /api/insurance/contracts/:id/check` also returns the contract's `requests`.

### Civil rights

- `GET`/`PUT /api/civil-rights/settings` take and return `ackWorking`, `investigationWorking` and
  `appealWorking` (count that limit in working days) and return the `workingCalendar` and `holidays`
  they count on. A complaint has `bases` (several values of `civil_rights_basis`); `basis` stays as the
  first of them for older clients, and `f.bases=a,b` finds a complaint by any of them.

### Risks, strategy, fleet, training, documents and files

- Risk appetite changes: record type `risk_appetite_change` (`RAC-`, `/api/risks/appetite/changes`),
  approved through the "Risk appetite change" workflow; `POST /api/risks/appetite/changes/:id/withdraw`.
  `GET /api/risks/appetite` gives `workflow_available` and, per category, its waiting `request`.
- Strategy: `GET`/`PUT /api/strategy/settings` take `fiscal_year_start_month` and `fiscal_year_named_for`
  (refused while fiscal periods are in use); `GET .../matrix?year=`; a measure takes `series_id`,
  `series_breakdown` and `series_aggregation`; `GET /api/strategy/measure-sources` lists `series`.
- Fleet: record types `maintenance_interval` (`PMI-`, `/api/maintenance-intervals`), `vehicle_reading`
  (`RDG-`, `/api/vehicle-readings`; never backwards) and `maintenance_record` (`PMR-`,
  `/api/maintenance-records`); `GET /api/fleet/maintenance/due`, `GET /api/vehicles/:id/maintenance`.
- Training: `GET /api/training/mine/certifications` (the caller's own, no permission);
  `GET /api/training/certifications/expiring` takes `position` and `department`; a certification carries
  `position_id` and `department_id` from the roster (read-only).
- Documents: `GET /api/policies/:id/copies/:cid/pdf` (`policies.edit`, audited): an issued paper copy
  printed with its copy number and holder; 409 `recalled` or `recall_due`.
- Files: `GET`/`PUT /api/attachments/admin/ocr`: the languages scanned PDFs are read in.
- Administration: `POST /api/admin/users`, `PATCH /api/admin/users/:id`, the sign-in provider routes and
  `PUT /api/admin/scim/groups/:id/roles` answer `warnings` naming roles that give no access (switched off
  under Roles, or of a switched-off area).

## Data load mode

For loading historical records with their original dates (E18-70; see
[Data load mode](user/09-administration.md#data-load-mode) and [Security](security.md#data-load-mode)).
While an administrator has switched it on, a create or update by a person holding
`admin.administer`, or with their token (the owner's grants decide; an assistant token also needs
AI assistant write access), may also set:

- read-only fields (`opened_at`, `resolved_at`, `closed_at`, due times, breach flags and so on);
  a column the database works out is refused with a field error;
- any status, without lifecycle or module step rules;
- `created_at`, `updated_at` (ISO 8601) and `created_by` (a user id);
- the reference (`ref`): 400 on the field when it is taken; numbering continues after it.

Values given win over what the module would work out; what is missing is worked out from the dates
given. Nothing is sent (no notifications, email, webhooks or approvals). Outside the mode, or for
anyone else, read-only fields are ignored as before.

| Route | Purpose |
|---|---|
| `GET /api/admin/data-load` | The mode (`on`, `until`, who switched it on) and the loads by day and record type (`admin.administer`) |
| `POST /api/admin/data-load` | `{ on: true, days? \| until? }` (at most 30 days; session only, recent password confirmation) or `{ on: false }` |
| `POST /api/admin/data-load/undo` | `{ type, day }`: soft-deletes everything that load created; `{ deleted, held, missing }` (session only, recent password confirmation) |
| `DELETE /api/data-load/records/:type/:id` | Deletes one record created in data load mode while the mode is on (a token may call it when its owner is an administrator); 409 `data_load_off`, 404 when the record was not loaded, 409 `on_hold` |

**On behalf of someone (E18-71).** `on_behalf_of` (any JSON body of a change request) or the `X-On-Behalf-Of` header (requests without a JSON body, such as uploads; percent-encoded when needed) names the person the change is written for, in data load mode only: a user id, username or email (disabled accounts too), a roster person (`person:<id|reference|email|employee number>`), or `name:<display name>`; or an object with one of `user`, `person`, `name`. 400 `on_behalf_not_allowed` outside data load mode; 400 `validation` with a field error when nobody matches. Records (`created_by`, `updated_by`), comments (`author_id`, `author_name`; `created_at` may be given), links, files, document versions and approval decisions (the named approver, who needs an account) carry the person; audit events keep the real actor and add `on_behalf_id`, `on_behalf_name` and "on behalf of" in the summary (`GET /api/history` returns them; the audit CSV has `on_behalf_name`). `created_by`, `updated_by` and person fields also take a username or email in a load. `POST /api/data-load/person { person }` gives `{ kind, user_id, person_id, name }` to check a name first.

Every module column that records who did something (approvals, decisions, sign-offs, log
entries, figures entered, check-outs, verifications) carries the person named (E18-94), and a route
that stamps the time of the act takes the time the body gives in a load (for example
`decided_at`, `applied_at`, `checked_out_at`, `verified_on`). A file attached in a load (upload,
chunked upload, MCP `attach_file`) records the person named as "added by", may carry
`created_at` (a date or ISO time) as its added date, and is listed under the load (record type
`attachment`, shown as Files), so undoing the load removes it. A reader's past acknowledgment of a
document version is recorded with `POST /api/policies/:id/versions/:vid/acknowledgments`.

`GET /api/auth/state` carries `dataLoad: { on, until }` for administrators while the mode is on.

## Examples of common integrations

Each example is a few lines of PowerShell, which ships with Windows; the same requests work
from any language. `examples/` in the repository has complete scripts:
`api-token.ps1` (PowerShell), `api-client.mjs` (a dependency-free Node.js client with paging,
retries, rate limits and idempotency) and `webhook-receiver.mjs`.

```powershell
$base = 'https://grc.example.test/api/v1'
$headers = @{ Authorization = "Bearer $env:GRC_TOKEN" }   # set GRC_TOKEN first
```

### Pull open tickets

Statuses are a configurable list; `GET $base/lookups/ticket_status` gives the values, each
with a `meta.category` of `open`, `paused`, `resolved` or `closed`. The installed open ones are
`new`, `assigned` and `in_progress`.

```powershell
$url = "$base/tickets?f.status=new,assigned,in_progress&sort=opened_at&dir=asc&pageSize=500"
$all = @()
while ($url) {
  $res = Invoke-WebRequest -Uri $url -Headers $headers -UseBasicParsing
  $all += ($res.Content | ConvertFrom-Json).rows
  $next = [regex]::Match([string]$res.Headers['Link'], '<([^>]+)>;\s*rel="next"')
  $url = if ($next.Success) { "https://grc.example.test$($next.Groups[1].Value)" } else { $null }
}
$all | Select-Object ref, title, @{ n = 'status'; e = { $_._display.status } }, opened_at
```

### Create a ticket from monitoring

An alert from a network or SCADA monitor becomes an incident. The `Idempotency-Key` built from
the alert's own id means a retried webhook or a re-sent alert cannot raise it twice.

```powershell
$alert = @{ id = 'mon-4471'; host = 'depot-north-sw01'; text = 'Switch unreachable for 5 minutes' }
$body = @{
  type = 'incident'; title = "$($alert.host): $($alert.text)"
  description = "Raised by monitoring, alert $($alert.id)."
  urgency = 'high'; impact = 'department'
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/tickets" -Headers ($headers + @{ 'Idempotency-Key' = "monitoring-$($alert.id)" }) `
  -ContentType 'application/json' -Body $body
```

`urgency` and `impact` are list values (`GET $base/lookups/ticket_urgency`,
`ticket_impact`); the priority follows from them. To tell these tickets apart, an administrator
can add a "Monitoring" value to the `ticket_channel` list, and you send `channel` with it, or
tag them (`POST $base/tags`).

### Sync assets from an endpoint-management tool

`POST /api/v1/assets/ingest` takes a list of devices and creates or updates each one, matched
by serial number, then by asset tag; it answers with what it did:

```powershell
$devices = @(
  @{ serial = 'EX-SN-10021'; tag = 'A-10021'; name = 'Dispatch workstation 3'; asset_type = 'workstation'; make = 'Example'; model = 'Model 14' }
  @{ serial = 'EX-SN-10022'; name = 'Ticket machine controller'; asset_type = 'network_device' }
)
$result = Invoke-RestMethod -Method Post -Uri "$base/assets/ingest" -Headers $headers `
  -ContentType 'application/json' -Body (@{ assets = $devices } | ConvertTo-Json -Depth 5)
"$($result.created) created, $($result.updated) updated, $($result.unchanged) unchanged, $($result.errors.Count) refused"
```

`asset_type` takes a value (or label) of the asset type list (`GET $base/lookups/asset_type`);
a device with a value not in the list is refused and reported under `errors`. The token needs `assets.create` and `assets.edit`. Send
devices in batches of a few hundred.

### Push vulnerability findings

A scanner's CSV export goes to `POST /api/v1/vulnerabilities/import` with a mapping from your
columns to the finding fields. Check with `dryRun: true` (the default), then import:

```powershell
$body = @{
  csv = Get-Content -Raw .\scan-export.csv
  source = 'Weekly network scan'
  mapping = @{ host_name = 'Host'; port = 'Port'; plugin_id = 'Plugin ID'; title = 'Name'; severity = 'Risk'; cves = 'CVE' }
  closeMissing = $true   # findings this source no longer reports are marked fixed
  dryRun = $false
} | ConvertTo-Json -Depth 5
$r = Invoke-RestMethod -Method Post -Uri "$base/vulnerabilities/import" -Headers $headers -ContentType 'application/json' -Body $body
"$($r.created) new, $($r.updated) updated, $($r.reopened) reopened, $($r.closed) closed"
```

A finding is the same as a recorded one when host, port and finding identifier match. The token
needs `vulnerabilities.create`, `vulnerabilities.edit` and `security.view`.
`GET /api/v1/vulnerabilities/import/fields` lists the fields you can map.

### Read risk summaries

```powershell
$s = Invoke-RestMethod -Uri "$base/risks/summary" -Headers $headers
$s.levels | Select-Object label, count
"$($s.total) open risks; $($s.reviews_due) reviews due; $($s.acceptances_expiring) acceptances expiring"
$s.top | Select-Object ref, title, rating_label, score
```

`GET /api/v1/risks/heatmap` gives the matrix behind the heat map and `GET /api/v1/risks/report`
the board report (ratings, movement since the last review, acceptances falling due).
`GET /api/v1/risks/stats?group=status` counts risks by any field. The token needs `risks.view`;
restricted risks (cybersecurity by default) also need `security.view`, and figures show them as
"Restricted risk". `GET /api/v1/risks/heatmap?basis=target` places risks by their target rating;
`GET /api/v1/risks/appetite/versions` lists earlier versions of the risk appetite, and
`PUT /api/v1/risks/appetite` (`risks.administer`) needs, for each changed category, `approved_on`,
`approved_by_name` and `approval_body`, plus a `reason`.
