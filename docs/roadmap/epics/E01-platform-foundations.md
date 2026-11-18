# E01 Platform foundations

**Status:** in progress

## Goal

Give every module the same dependable base: sign-in, sessions, roles and permissions, an
audit trail, configurable lists, settings, search, comments, links, and generic lists and
record pages. A module author should get all of this by declaring a record type, and a
user should find every list and record behaving the same way.

## Scope notes

- Covers `server/src/core/`, `server/src/modules/admin/`, `web/src/core/` and
  `web/src/modules/admin/`.
- Second factor, single sign-on and API tokens are in [E02](E02-account-security.md).
- Attachments, notifications, custom fields, tags and other shared services that do not
  exist yet are in [E14](E14-platform-services.md).

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E01-01 | First-run setup wizard | done | P1 |
| E01-02 | Local sign-in with lockout and rate limiting | done | P1 |
| E01-03 | Password policy and password change | done | P1 |
| E01-04 | Sessions: idle time-out, list and end your own | done | P1 |
| E01-05 | Roles and permissions | done | P1 |
| E01-06 | Restricted records | done | P1 |
| E01-07 | User administration and one-time links | done | P1 |
| E01-08 | Departments | done | P2 |
| E01-09 | Audit log and audit viewer | done | P1 |
| E01-10 | Configurable lists | done | P1 |
| E01-11 | Settings screen | done | P1 |
| E01-12 | Generic record lists with saved views and CSV export | done | P1 |
| E01-13 | Generic record page with edit and history | done | P1 |
| E01-14 | Comments on any record | done | P2 |
| E01-15 | Links between records | done | P2 |
| E01-16 | Global search | done | P2 |
| E01-17 | Organisation profile and seed command | done | P1 |
| E01-18 | Organisation time zone and currency | done | P2 |
| E01-19 | Application shell, navigation and themes | done | P1 |
| E01-20 | Request protection: security header check and response headers | done | P1 |
| E01-21 | Re-authentication before administrative actions | open | P2 |
| E01-22 | Rate limiters that survive a restart | open | P3 |
| E01-23 | Limit list metadata to what the user may see | open | P2 |
| E01-24 | Saved views stored on the server | open | P3 |
| E01-25 | Spreadsheet (XLSX) export | open | P3 |

---

### E01-01 First-run setup wizard

**Status:** done · **Priority:** P1 · **Type:** feature

As the person installing the application, I am asked to create the first administrator
on my first visit, so there is never a default account or password.

**Acceptance criteria**

- [x] The first visit shows a setup form while no users exist
- [x] Username, email, name and password are validated with field-level messages
- [x] The new account holds the Administrator role and is signed in straight away
- [x] A second setup attempt is refused
- [x] The event is written to the audit log

**Implemented in:** `POST /api/setup`, `GET /api/auth/state` (`server/src/core/auth.ts`); `web/src/core/AuthPages.tsx`

### E01-02 Local sign-in with lockout and rate limiting

**Status:** done · **Priority:** P1 · **Type:** feature

As a user, I sign in with a username or email address and a password. Repeated failures
slow an attacker down without telling them whether the account exists.

**Acceptance criteria**

- [x] Sign-in by username or email, case-insensitive
- [x] The same generic error for unknown accounts and wrong passwords
- [x] Progressive lockout from the fifth failure (1 minute doubling to 15)
- [x] Failures limited per source address (20 in 5 minutes)
- [x] Successes, failures and lockouts are audited
- [x] Passwords stored as salted Argon2id hashes

**Implemented in:** `POST /api/auth/login`, `POST /api/auth/logout` (`server/src/core/auth.ts`); `web/src/core/AuthPages.tsx`

### E01-03 Password policy and password change

**Status:** done · **Priority:** P1 · **Type:** feature

As a user, I can change my password, and the application refuses weak, common or
recently used passwords and explains why in plain English.

**Acceptance criteria**

- [x] Minimum length is a setting (default 14, never below 12)
- [x] Passwords on an offline common-password list are refused
- [x] The password may not contain the username
- [x] The last N passwords (setting, default 5) may not be reused
- [x] Changing the password ends all other sessions
- [x] The change is audited

**Implemented in:** `checkPasswordPolicy`, `POST /api/auth/change-password` (`server/src/core/auth.ts`); `server/src/core/common-passwords.txt`

### E01-04 Sessions: idle time-out, list and end your own

**Status:** done · **Priority:** P1 · **Type:** feature

As a user, I am signed out after a period of inactivity, and I can see where I am
signed in and end any of those sessions.

**Acceptance criteria**

- [x] Sessions last at most 8 hours and end after the idle time-out (setting, default 30 minutes)
- [x] Only a hash of the session token is stored
- [x] The session cookie is HTTP-only and same-site strict
- [x] I can list my sessions, end one, or end all others
- [x] Ending a session is audited

**Implemented in:** `server/src/core/auth.ts`; `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/auth/sessions/end-others` (`server/src/modules/admin/account.ts`); `web/src/modules/admin/Sessions.tsx`

### E01-05 Roles and permissions

**Status:** done · **Priority:** P1 · **Type:** feature

As an administrator, I control what each person can do by giving them roles. Each role
is a set of grants such as "view tickets" or "everything in vendors", and I can create
my own roles, edit grants, and switch a role off.

**Acceptance criteria**

- [x] Permissions have the form `<module>.<action>`; grants may use `module.*` or `*`
- [x] Eight default roles are created on first start; four ship switched off
- [x] Custom roles can be created and their grants edited, with validation
- [x] Switching a role off removes its permissions at once
- [x] The Administrator role is protected and the last administrator cannot be locked out
- [x] Every change is audited
- [x] Navigation, routes and buttons in the web app respect permissions

**Implemented in:** `server/src/core/services.ts` (`can`, `requirePerm`, `DEFAULT_ROLES`); `/api/admin/roles...` (`server/src/modules/admin/roles.ts`); `web/src/modules/admin/Roles.tsx`, `RoleDetail.tsx`

### E01-06 Restricted records

**Status:** done · **Priority:** P1 · **Type:** feature

As a security lead, I know that sensitive records (risks, security incidents, anything
flagged) are invisible to people without the security permission, everywhere: lists,
counts, search, links, exports and the audit log.

**Acceptance criteria**

- [x] A record type can be restricted as a whole or row by row
- [x] Restricted records are excluded from lists, statistics, exports, search, pickers and links
- [x] A request for a hidden record returns "not found" rather than "forbidden"
- [x] Audit events about restricted types are hidden without the security permission
- [x] Covered by automated tests for an ordinary agent

**Implemented in:** `server/src/core/resource.ts` (`visibilitySql`, `mayAccess`); `server/src/core/routes.ts`

### E01-07 User administration and one-time links

**Status:** done · **Priority:** P1 · **Type:** feature

As an administrator, I create users, give them roles and a department, and hand each
person a one-time link to set their own password. I can also disable, enable and unlock
accounts, end a person's sessions and issue a password-reset link.

**Acceptance criteria**

- [x] A new user starts as "pending" with no roles unless I pick some
- [x] Setup and reset links work once, expire after 24 hours and are stored only as hashes
- [x] Used, expired and unknown links give the same generic error
- [x] Disabling a user ends their sessions and cancels unused links
- [x] Users can be searched and filtered by status and role
- [x] Every action is audited

**Implemented in:** `/api/admin/users...` (`server/src/modules/admin/users.ts`); `GET/POST /api/auth/redeem` (`server/src/modules/admin/account.ts`); `web/src/modules/admin/Users.tsx`, `UserDetail.tsx`, `Redeem.tsx`

### E01-08 Departments

**Status:** done · **Priority:** P2 · **Type:** feature

As an administrator, I keep a list of departments and assign each user to one.

**Acceptance criteria**

- [x] Add, rename and remove departments
- [x] Names are unique; a removed department can be added again
- [x] Removing a department leaves its members without a department
- [x] Changes are audited

**Implemented in:** `/api/admin/departments...` (`server/src/modules/admin/settings.ts`); `web/src/modules/admin/Departments.tsx`

### E01-09 Audit log and audit viewer

**Status:** done · **Priority:** P1 · **Type:** feature

As an auditor, I can see who changed what and when, with the values before and after,
and export the result. Nobody can edit or delete audit events.

**Acceptance criteria**

- [x] Every data change writes an event with actor, address, action, record, summary, before and after
- [x] The log is append-only
- [x] Search by text, action, record type, record, actor and date range
- [x] CSV export, itself audited
- [x] Each record shows its own history
- [x] Viewing the full log needs the `audit.view` permission

**Implemented in:** `makeAudit` (`server/src/core/services.ts`); `GET /api/audit`, `GET /api/history` (`server/src/core/routes.ts`); `web/src/modules/admin/AuditLog.tsx`

### E01-10 Configurable lists

**Status:** done · **Priority:** P1 · **Type:** feature

As an administrator, I can add, rename, recolour, reorder and retire the values of any
list (statuses, priorities, categories and so on) without a code change.

**Acceptance criteria**

- [x] Every list is stored as data, not as constants
- [x] Values can be added and edited from the Lists screen
- [x] Values are retired rather than deleted, so old records keep their meaning
- [x] Modules add their starting values at start-up without overwriting edits
- [x] Changes are audited

**Implemented in:** `makeLookups` (`server/src/core/services.ts`); `/api/lookups...` (`server/src/core/routes.ts`); `web/src/modules/admin/Lists.tsx`

### E01-11 Settings screen

**Status:** done · **Priority:** P1 · **Type:** feature

As an administrator, I can change the application name, the pilot-mode notice, feature
switches and the sign-in rules from one screen.

**Acceptance criteria**

- [x] Application name, pilot mode, feature switches
- [x] Minimum password length, password history, idle time-out, "second factor expected of everyone"
- [x] Each value is validated and unknown settings are refused
- [x] Each change is audited with before and after

**Implemented in:** `GET/PATCH /api/admin/settings` (`server/src/modules/admin/settings.ts`); `web/src/modules/admin/Settings.tsx`

### E01-12 Generic record lists with saved views and CSV export

**Status:** done · **Priority:** P1 · **Type:** feature

As a user, every list works the same way: I can search, filter, sort, page, save the
combination as a named view, and export what I see to CSV.

**Acceptance criteria**

- [x] Server-side search, filters (any-of, greater/less than, empty/not empty), sort and paging
- [x] Counts grouped by a field for summary tiles and charts
- [x] CSV export that respects the current filters and permissions
- [x] Saved views (kept in the browser)
- [x] Empty, loading and error states
- [x] A "New" dialog generated from the record type's fields

**Implemented in:** `defineResource` (`server/src/core/resource.ts`); `web/src/core/ResourceList.tsx`, `ResourceForm.tsx`

### E01-13 Generic record page with edit and history

**Status:** done · **Priority:** P1 · **Type:** feature

As a user, every record opens on a page with its details, an edit form with validation,
tabs for related information, and its change history.

**Acceptance criteria**

- [x] Read, create, partial update and soft delete for every record type
- [x] Automatic reference numbers (for example a prefix and five digits)
- [x] Field-level validation messages
- [x] Display labels for user, record and list fields
- [x] History tab showing who changed what

**Implemented in:** `server/src/core/resource.ts`; `web/src/core/RecordPage.tsx`, `fields.tsx`, `FieldValue.tsx`

### E01-14 Comments on any record

**Status:** done · **Priority:** P2 · **Type:** feature

As a user, I can add comments to any record I can see, marked internal or public.

**Acceptance criteria**

- [x] Comments are listed in order with author and time
- [x] Comments are internal unless marked otherwise
- [x] A comment can only be added to a record the user may view
- [x] Adding a comment is audited

**Implemented in:** `GET/POST /api/comments` (`server/src/core/routes.ts`); `web/src/core/RecordPage.tsx`

### E01-15 Links between records

**Status:** done · **Priority:** P2 · **Type:** feature

As a user, I can link any record to any other (for example a ticket to a system) and
see the link from both ends.

**Acceptance criteria**

- [x] Links carry a relation name and show in both directions
- [x] Linking needs edit permission on the record linked from and view on the other
- [x] Links to records the user may not see are hidden
- [x] Adding and removing a link is audited

**Implemented in:** `GET/POST /api/links`, `DELETE /api/links/:id` (`server/src/core/routes.ts`); `web/src/core/RecordPage.tsx`

### E01-16 Global search

**Status:** done · **Priority:** P2 · **Type:** feature

As a user, I can type in the search box at the top of any page and jump to matching
records of any type I am allowed to see.

**Acceptance criteria**

- [x] Searches the searchable fields and reference of every record type
- [x] Results are filtered by permission and by restricted-record rules
- [x] Keyboard: `/` or Ctrl+K focuses the box, arrows and Enter choose a result
- [x] Loading and error states

**Implemented in:** `GET /api/search`, `GET /api/records/lookup` (`server/src/core/routes.ts`); `GlobalSearch` in `web/src/core/Shell.tsx`

### E01-17 Organisation profile and seed command

**Status:** done · **Priority:** P1 · **Type:** feature

As the person setting up an installation, I describe my organisation in one private
file (name, extra list values, obligations, notification rules) and load it with one
command, so nothing about my organisation lives in the code.

**Acceptance criteria**

- [x] `seed` reads a private, git-ignored folder; every file in it is optional
- [x] The profile sets the application name and adds list values
- [x] Modules read their own sections of the profile
- [x] A `dev` profile generates invented sample data and needs no files
- [x] Seeding can be run repeatedly without duplicating or overwriting edits
- [x] An invented example profile ships in `examples/`

**Implemented in:** `server/src/cli.ts`; each module's `seed.ts`; `examples/organisation.example.json`

### E01-18 Organisation time zone and currency

**Status:** done · **Priority:** P2 · **Type:** feature

As an administrator, I set the organisation's time zone and currency once and dates and
amounts are shown accordingly.

**Acceptance criteria**

- [x] `GRC_TIMEZONE` sets the time zone (default: the machine's zone)
- [x] `GRC_CURRENCY` sets the currency code (default `USD`)
- [x] Both are reported to the web app and used when formatting

**Implemented in:** `server/src/core/config.ts`, `server/src/core/timezone.ts`; `web/src/core/format.ts`

### E01-19 Application shell, navigation and themes

**Status:** done · **Priority:** P1 · **Type:** feature

As a user, I see a grouped navigation menu showing only what I may use, a "Create"
menu, my account menu, and a light or dark theme of my choice.

**Acceptance criteria**

- [x] Modules are discovered automatically on the server and the web
- [x] Navigation groups in a fixed order, filtered by permission
- [x] "Create" menu built from the modules' declarations
- [x] Light and dark themes; the stored choice wins, otherwise the system preference
- [x] "Skip to content" link
- [x] Pilot-mode and second-factor notices

**Implemented in:** `server/src/app.ts`; `web/src/core/Shell.tsx`, `theme.ts`, `tokens.css`, `module.ts`

### E01-20 Request protection: security header check and response headers

**Status:** done · **Priority:** P1 · **Type:** feature

As an administrator, I can rely on the application refusing forged requests and telling
the browser not to load outside content.

**Acceptance criteria**

- [x] Every `/api` route needs a session unless explicitly public
- [x] Changing requests must carry the `X-GRC-CSRF: 1` header
- [x] Responses carry a content security policy, no-sniff, frame and referrer headers
- [x] Errors have a consistent shape and never leak internals

**Implemented in:** `server/src/core/auth.ts` (request hook); `server/src/app.ts` (headers and error handler); `web/src/core/api.ts`

### E01-21 Re-authentication before administrative actions

**Status:** open · **Priority:** P2 · **Type:** improvement

As an administrator, I am asked for my password (or second factor) again before a
sensitive action such as changing a role, resetting someone's second factor or changing
sign-in settings, so an unattended signed-in browser cannot be misused.

**Acceptance criteria**

- [ ] A recent re-authentication is required for a defined list of sensitive actions
- [ ] The prompt appears in place and the action continues afterwards
- [ ] Refused attempts are audited
- [ ] Tests cover the refused and allowed paths

### E01-22 Rate limiters that survive a restart

**Status:** open · **Priority:** P3 · **Type:** debt

As an administrator, I want sign-in and link rate limits to hold across a restart and
across more than one server process. Today they are counters in memory.

**Acceptance criteria**

- [ ] Limiter state is kept in the database or another shared store
- [ ] Limits apply across processes
- [ ] Old entries are cleaned up

### E01-23 Limit list metadata to what the user may see

**Status:** open · **Priority:** P2 · **Type:** bug

As a security lead, I do not want the names and labels of lists that belong to modules a
person cannot use (for example security incident scenarios) to be visible to every
signed-in user. Today `GET /api/meta` and `GET /api/lookups/:list` return all lists.

**Acceptance criteria**

- [ ] Each list is tied to the module that owns it
- [ ] `GET /api/meta` returns only lists the caller may use
- [ ] `GET /api/lookups/:list` refuses lists the caller may not use
- [ ] A test proves an ordinary agent cannot read a restricted module's lists

### E01-24 Saved views stored on the server

**Status:** open · **Priority:** P3 · **Type:** improvement

As a user, my saved views follow me to another browser or machine, and I can share a
view with colleagues. Today views are kept in the browser only.

**Acceptance criteria**

- [ ] Saved views are stored per user on the server
- [ ] A view can be marked as shared with everyone who can see that list
- [ ] Existing browser-only views are offered for migration

### E01-25 Spreadsheet (XLSX) export

**Status:** open · **Priority:** P3 · **Type:** feature

As a user, I can export any list as a spreadsheet file with proper column types, as well
as CSV.

**Acceptance criteria**

- [ ] Every list offers "Export XLSX" beside "Export CSV"
- [ ] Dates, numbers and currency are typed cells
- [ ] The export respects filters, permissions and restricted records
- [ ] The export is audited
