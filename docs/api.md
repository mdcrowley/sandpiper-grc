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
- [Restricted records](#restricted-records)
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
| Read risk summaries | `risks.view` (and `security.view`, as risks are restricted records) |

**Scope families.** Most scopes are permissions, and you may only give a token permissions you
hold. A few scopes are *capabilities* rather than permissions; no role grants them, and each
says who may add one to a token. They give no access to records by themselves: what the token
can read or change is still decided by its permission scopes and your own roles.

| Scope | What it allows | Who may add it |
|---|---|---|
| `mcp.use` (or `mcp.*`) | The token may be used at the MCP endpoint (`/mcp`), once an administrator has switched that endpoint on | Anyone who holds at least one permission |

`GET /api/v1/me/tokens` (from a signed-in session) lists the capability scopes you may add, in
`scopeFamilies`. A `*` scope does not include them: they are always chosen deliberately.

**What a token cannot do.** It cannot call the sign-in, account-security, password,
second-factor or token routes (`403 token_not_allowed`), and it cannot pass a password
confirmation, so administrative actions that need one answer `403 reauth_required`. A token
request needs no `X-GRC-CSRF` header and never falls back to a browser session. Every change
made with a token is audited with the token's name. You or an administrator can revoke a token
at any time; see [Security](security.md#personal-access-tokens).

`GET /api/v1/auth/state` tells a client who it is acting as and which permissions it has.

## Base URL and versioning

Integrations use the **versioned base path**:

```
https://grc.example.test/api/v1/...
```

Every route of the API is served there. The same routes are also served under `/api/...`
without a version; the web application uses those, and they may change with it. Answers to a
versioned request carry `API-Version: 1`.

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

Filters combine with "and". The API reference lists every filter of every record type.

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

Any list exports its filtered, sorted rows (up to 50,000) instead of a page:

| `format=` | Gives |
|---|---|
| `csv` | CSV, UTF-8 with a byte-order mark, a header row of field labels, display labels for list, user and record fields |
| `xlsx` | A spreadsheet with typed cells and the filters above the table |
| `pdf` | A printable table with the filters and the time it was produced |

`columns=ref,title,status` chooses the columns and their order. Exporting needs the type's
`.export` permission (for example `tickets.export`) and is audited; restricted content is
watermarked. `GET /api/v1/records/{type}/{id}/pdf` gives one record as a PDF fact sheet.

## Imports

- **Any record type from CSV or XLSX**: `GET /api/v1/import/{type}/fields` (what can be
  imported and matched), `GET /api/v1/import/{type}/template` (a CSV template),
  `POST /api/v1/import/{type}/read` (headers, sample rows, a suggested mapping), and
  `POST /api/v1/import/{type}` with `dryRun: true` (the default) to check, then
  `dryRun: false` to import. `mode` is `create`, `update` or `upsert`, with a `matchKey`.
  Every record goes through the same validation, rules and audit as one made by hand.
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
`/api/v1/admin/webhooks` (administrators, with a recent password confirmation, so not with a
token).

## Errors

Every error answer has the same shape, with a matching HTTP status:

```json
{ "error": { "code": "validation", "message": "Check the highlighted fields.", "fields": { "title": "Required." } } }
```

`code` is stable and meant for programs; `message` is plain English, safe to show to a person;
`fields` names the fields at fault on a validation error.

| Status | Common codes | Meaning |
|---|---|---|
| 400 | `validation`, `bad_json`, `bad_group`, `bad_idempotency_key` | The request is not valid; fix it before sending it again |
| 401 | `unauthenticated`, `invalid_token` | No token, or the token is wrong, expired or revoked |
| 403 | `forbidden`, `token_not_allowed`, `reauth_required`, `csrf` | Not permitted |
| 404 | `not_found` | Not there, or not visible to you (restricted records answer 404) |
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

## Rate limits

Each token may make `tokens.rate_per_minute` requests a minute (600 by default; an
administrator can change it). Answers to token requests say where you stand:

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
web application does not send it.

## Restricted records

Security incidents, risks, vulnerabilities, and records an editor marks restricted (and actions
raised on them) are visible only to people who hold `security.view`, and so only to tokens of
such people that include that scope. Without it, they are absent from lists, counts, stats,
search, links and exports, and answer `404` by id. An integration that must see them needs a
token with `security.view` from someone who holds it; keep such tokens especially well.

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
  @{ serial = 'EX-SN-10021'; tag = 'A-10021'; name = 'Dispatch workstation 3'; asset_type = 'laptop'; make = 'Example'; model = 'Model 14' }
  @{ serial = 'EX-SN-10022'; name = 'Ticket machine controller'; asset_type = 'network_device' }
)
$result = Invoke-RestMethod -Method Post -Uri "$base/assets/ingest" -Headers $headers `
  -ContentType 'application/json' -Body (@{ assets = $devices } | ConvertTo-Json -Depth 5)
"$($result.created) created, $($result.updated) updated, $($result.unchanged) unchanged, $($result.errors.Count) refused"
```

The token needs `assets.create` and `assets.edit`. Send devices in batches of a few hundred.

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
`GET /api/v1/risks/stats?group=status` counts risks by any field. Risks are restricted records:
the token needs `risks.view` and `security.view`.
