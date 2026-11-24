# E41 Product gaps found in the wave 19 review

**Status:** done (17 of 17 issues done)

## Goal

Close the product gaps a transit organization's IT, security, safety, risk, compliance, asset and
audit teams would expect a GRC application to cover, found by the wave 19 gap analysis. Each was
checked against the code; most extend or join up parts that exist.

## Scope notes

- Nothing names a real organization, place, vendor or person; no single jurisdiction's law is a
  built-in default.
- Left out on purpose: regulatory-change feeds and automatic exclusion-list checks (each needs an
  outside service per jurisdiction), claims payments, grant budgets and money-based risk modeling.
- Restriction hides details, never counts: figures stay the same for everyone (also for E41-01).

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E41-01 | Departments and sites as access scope | done | P1 |
| E41-02 | User access reviews and the register of accounts on each system | done | P1 |
| E41-03 | One "My work" list and a compliance calendar across every area | done | P1 |
| E41-04 | Figures over time for board reporting | done | P2 |
| E41-05 | Confidential safety reporting, and telling the reporter what changed | done | P2 |
| E41-06 | Registers an administrator defines | done | P2 |
| E41-07 | More than one language for the portal, kiosk, policies and the app | done | P2 |
| E41-08 | Safety and security certification of capital projects | done | P2 |
| E41-09 | A workspace for outside auditors and funder reviewers | done | P2 |
| E41-10 | Vendor intake with risk tiers and required checks | done | P2 |
| E41-11 | Contractor performance reviews | done | P3 |
| E41-12 | Written test steps per control, and importing coverage | done | P3 |
| E41-13 | Accessible (tagged) PDFs | done | P2 |
| E41-14 | Call-tree messages with acknowledgment | done | P3 |
| E41-15 | Retention schedule and destruction log for the organization's own records | done | P3 |
| E41-16 | Searching inside attached files, and file preview | done | P3 |
| E41-17 | Small items: data wiping proof at disposal, holiday-aware request deadlines, meeting invitations, a combined heat map, reports from scratch in the app | done | P3 |

### E41-01 Departments and sites as access scope

**Status:** done · **Priority:** P1 · **Type:** feature · **Implemented in:** `server/src/core/scope.ts` (the scope rule as SQL: a role's grants for a permission module may be scoped, `roles.scopes` `{ <module>: 'department' | 'site' }`; a person's departments are their account's, their roster entry's and those they manage, their sites their roster work site and those they manage, each with everything below it through `parent_id`; one unscoped role granting the module's view lifts it, a person always sees what they created; `departmentPrepare` accepts a department's name), `core/resource.ts` (the scope is part of `visibilitySql` and of labels, so lists, record pages, search, pickers, labels, links, tags, exports, imports and the assistant follow it; figures and `figureWhere` do not; `ResourceDef.directory` lets everyone signed in pick and read departments), `core/module.ts` (`ResourceDef.scope`, `directory`, `SessionUser.scoped`), `core/auth.ts` (the scoped modules are loaded with the session, so people with no scoped role run exactly the queries they ran before), core migration `031_access_scope.sql` (`roles.scopes`; department `parent_id`, `manager_id`, `description`; the `grc_department_name` trigger keeps the old `department` text column as the department's name, and a renamed department renames it on every record), `modules/people/departments.ts` (record type `department` on the core table, People > Departments, `POST /api/departments/:id/merge`), the people, inventory (sites get `parent_id` and `manager_id`; assets), risks (actions get `site_id`, taken from a hazard, safety event or inspection source), projects and continuity modules (`department_id` with migrations that convert the text, adding names not yet in the list), and `scope` on persons, positions, sites, assets, actions, hazards, safety events, inspections, inspection schedules, condition assessments, vehicles, services, security zones, inventory counts, projects and business processes; `modules/admin/roles.ts` and the role page's **Which records** card; inventory asset reports, the project portfolio's register and the qualification matrix list only what the caller may see (their figures still count everything). Test `core/scope.test.ts` (every scoped type, both kinds of place: lists, record pages, pickers, labels, exports, search, the same figures; combining roles, managers, places below, the creator; the role editor; departments, merging; the text conversion) on the embedded database, plus the module tests above. Not run on a PostgreSQL server (the SQL is plain PostgreSQL: recursive CTEs, `jsonb ->>`, a PL/pgSQL trigger with dynamic SQL); not checked in the browser suite. Ticket requester departments and training-record departments stay as recorded text (what the requester or file gave at the time).

A depot manager should see the inspections, hazards and corrective actions of their own depot, not
every depot's.

**Acceptance criteria**

- [x] Departments are a record type (name, parent, manager); people, positions and records that carry a department point at it, and existing text values are converted
- [x] A role grant can be scoped to the person's departments or sites (and those below them) for record types that carry one
- [x] Out-of-scope records are hidden from lists, search, pickers, exports and the assistant like restricted ones; figures are unchanged for everyone
- [x] Tests for every scoped type; the guide explains scoping

### E41-02 User access reviews and the register of accounts on each system

**Status:** done (wave 20) · **Priority:** P1 · **Type:** feature

**Acceptance criteria**

- [x] Accounts on a system (imported from a file per system, or entered) are kept with their holder, role on that system and last-seen date; holders are matched to the staff roster
- [x] An access review campaign asks each system owner or manager to keep or remove each account, with due dates, reminders and evidence
- [x] Leavers and people on leave with active accounts are flagged; removals are tracked to done
- [x] A finished campaign can be recorded as a control test

Proven by unit tests (`accessreviews.test.ts`, on the embedded database and with the clock on UTC) and checked
on screen in light and dark at 1440 and 820 pixels; the browser suite `24-access-reviews` is written but not yet
run. A reviewer's systems reach My work, the compliance calendar and the calendar feed through a `named`
calendar source (no permission needed, only the reviewer's own items). Not covered: the application does not
connect to systems, so removals are carried out and recorded by people.

**Implemented in:** module `accessreviews` (`server/src/modules/accessreviews/`: `accounts.ts` record type
`system_account`, roster matching, flags and `POST /api/system-accounts/import`; `campaigns.ts` record type
`access_review`, systems and reviewers, decisions, sign-off, removals with actions, completion,
`POST /api/access-reviews/:id/control-test`, the CSV decision file; `overview.ts` figures, calendar source
`accessreviews.decisions`, daily job `accessreviews.reminders`); feature area `accessreviews`
(`core/features.ts`); `web/src/modules/accessreviews/` (campaigns, the reviewer's page, the account register,
the Accounts tab on systems); user guide chapter 40.

### E41-03 One "My work" list and a compliance calendar across every area

**Status:** done · **Priority:** P1 · **Type:** feature

**Acceptance criteria**

- [x] "My work" and the personal calendar feed include evidence requests, control tests, corrective-action verifications, inspections, obligation attestations, vendor reassessments and certifications, through one registration each part uses
- [x] An in-app compliance calendar (month and list views, filter by area and person) shows everything due; switched-off areas are left out
- [x] The mobile app's My work shows the new kinds

**Implemented in:** the calendar source registry (`server/src/core/calendar.ts`) is the one registration: a source may now say it is `work` (listed in My work, overdue items kept), `anyone` (answers for another person or everyone, through a `scope`) and its `kind`; an event carries its `personId` and `ref`; `checkedEvents` checks every record again with `visibleWhere` (moved from the feeds module, which now uses it) and `areaOf` names the feature area. New sources: `audits/due.ts` (evidence requests), `risks/due.ts` (corrective actions to verify, obligation periods to attest), `training/due.ts` (certifications due for renewal, for their holder), `funding/due.ts` (funding certifications to sign, and their items to confirm); the existing inspection, control test, obligation, risk and policy review, action and exercise sources (`feeds/sources.ts`) and vendor reassessments (`vendors/lifecycle.ts`) take a scope; records requests, continuity reviews and condition assessments are marked as work (own items only). New module `server/src/modules/work/` (`GET /api/work/mine`, `GET /api/work/calendar`; shapes in `shared/work-api.ts`) and `web/src/modules/work/` (the **Compliance calendar** page at `/calendar`: month, list and "My due work" views, filters by area, kind and person); the Overview's **My due work** widget (`home/widgetsMyWork.tsx`); the mobile app's My work (`mobile/home.ts` adds a section per kind; `MobileWorkKey` takes a source key); the assistant's `my_work` tool. Tests `work/work.test.ts` (every kind, own work only, person and area filters, visibility by permission, switched-off areas left out of My work, the calendar and the app), `web/src/modules/work/dates.test.ts`, mobile `WorkScreen.test.tsx` and `rules.test.ts`. Proven on the embedded database (also with the clock on UTC); not run on a PostgreSQL server (none was available to this agent).

### E41-04 Figures over time for board reporting

**Status:** done · **Priority:** P2 · **Type:** feature · **Implemented in:** reports migration `003_figures.sql` (`tracked_figures`: a count of one record type with filters and an optional breakdown by a list field, or a metric from `core/metrics.ts`; `figure_values`: one month-end and one on-demand value per figure and month, with the breakdown as list values and counts only), `server/src/modules/reports/figures.ts` (worked out as the system, so every record counts and the value is the same for everyone; who may see a figure follows the metrics rule, view on its record type's module; figures of switched-off or unloaded types and metrics are hidden; the history as a report result, months as rows and the breakdown as a pivot without column totals), `figure-routes.ts` (`GET/POST /api/figures`, `GET/PATCH/DELETE /api/figures/:id`, `POST /api/figures/record`, `GET /api/figures/:id/export`, all audited; the hourly job `reports.figures_month_end` records the month that has just ended once, for figures that existed then), the `figure` dashboard widget (`widgets.ts`) and pack section (`resources.ts`, `documents.ts`, the pack preview), multi-line trend charts in the PDF (`files.ts`, `PdfBuilder.trend`), six standard figures and the risk figure in the standard pack (`standard.ts`, `seed.ts`; an invented eleven-month history in the `dev` profile only), and the web pages **Reports > Figures over time** (`web/src/modules/reports/FiguresPages.tsx`), the widget editor, the pack editor and `offTypes.ts`. Test `reports/figures.test.ts` (validation, recording now, restricted records counted and the same result for an agent, month end once and only for figures that existed, the job, a metric figure, visibility by module, widget, pack preview and PDF/UA-checked pack and figure exports, CSV, seeding). Checked in the browser with `tools/browse.mjs` (light and dark, 1440 and 820); no browser-suite test added. Proven on the embedded database (also with the clock on UTC); not run on a PostgreSQL server.

**Acceptance criteria**

- [x] Chosen figures (open risks by level, overdue actions, open findings and others) are recorded at each month end (and on demand), the same for everyone
- [x] Reports and dashboards chart a figure over time; board packs can include it

### E41-05 Confidential safety reporting, and telling the reporter what changed

**Status:** done (wave 21) · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [x] A reporter can ask for their identity to be kept confidential: only named people may see it, and every view is audited
- [x] The reporter is told, in plain words, what was done about their report when it closes

Proven by unit tests (`safety/confidential.test.ts`, with the other safety and portal tests, on the embedded
database and with the clock on UTC) and checked on screen in light and dark at 1440 and 820 pixels; the browser
test (a confidential portal report, a named person's look, telling the reporter) is added to suite `23-portal`
but not yet run. The identity is kept off the event row altogether, so lists, filters, exports, fact sheets,
search, reports, imports, webhooks and the assistant cannot show it; a portal report is created as the
application's own work, so **Created by** and the history do not name the reporter. Not covered: the words of the
report itself, and people with access to the server (database, backups, request log). The mobile app's portal
report form does not yet offer the confidential choice (the server takes `confidential: true` on
`/api/portal/safety-reports` from the app as from the portal).

**Implemented in:** safety module migration `004_confidential_reporting.sql` (`confidential_reporter`,
`reporter_outcome`, `reporter_told_at` on `safety_events`; tables `safety_confidential_reporters` and
`safety_confidential_viewers`); `safety/confidential.ts` (`GET/PUT /api/safety/confidential-viewers`, adding
someone needs a recent password confirmation; `GET /api/safety-events/:id/reporter`, named people holding
`safety.view` only, audited as `safety_event.reporter_view`; the reporter is removed when the event is anonymized);
`safety/events.ts` (the reporter is moved apart on create, refused for one's own report, fixed after creation;
closing an event with a reporter needs `reporter_outcome`, records `reporter_told_at` and notifies the reporter,
audited as `safety_event.reporter_told`); `safety/portal-intake.ts` (`confidential` on the portal report; "My
safety reports" lists confidential reports and shows what was done); `core/lifecycle.ts` (the application rule
line for safety events); web `safety/ConfidentialViewers.tsx` (Administration > Confidential safety reports),
`safety/Events.tsx` (the confidential notice with **Show who reported it**, the close dialog, the **Telling the
reporter** card), `portal/SafetyReport.tsx` (**Keep my name confidential**, **What was done**); user guide
chapters 20 and 18.

### E41-06 Registers an administrator defines

**Status:** done (wave 21) · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [x] An administrator defines a new kind of record (name, fields, lists, numbering, permissions, area) that gets lists, record pages, search, history, attachments, imports, exports, lifecycles and reports like built-in types
- [x] Defined registers can be switched off like other areas

Proven by unit tests (`registers.test.ts`, on the embedded database and with the clock on UTC: defining, custom
fields, numbering, lists, filters, figures, If-Match, history, comments, attachments, the fact sheet, search, CSV
export, import, lifecycle rules, the report builder, records kept to their own register, role grants, switching off
and on, removing) and checked on screen in light and dark at 1440 and 820 pixels; the browser suite `25-registers`
is written but not yet run, and nothing was run on a PostgreSQL server (the views, the view column default and the
search trigger's `when` condition are plain PostgreSQL). Not covered: a register defined while the server runs gets
approval workflows only after the next restart (the workflows module wraps record types once, at start-up); a
register has no calendar or My work entries and no mobile app screens; with a least-privilege database account a
new register waits for `migrate` as the owner, and removing one is refused there.

**Implemented in:** module `registers` (`server/src/modules/registers/`: migration `001_registers.sql` with
`register_definitions` and the shared table `register_records`; `definitions.ts` (the record type `reg_<key>` read
through the view `reg_<key>`, status list `register_<key>_status`, permission module `<key>`, run-time area
`reg_<key>`, start-up load and a five-second sync for other server processes); `routes.ts` (`/api/registers`,
`/api/registers/:register[/stats|/:id]` handing each request to the resource engine's own handlers);
`admin.ts` (`/api/admin/registers[/:key]`); dev sample "Lost property"); core additions for record types and areas
made while the application runs: `app.runtimeResources` and `defineResource(def, { routes: false })`
(`core/resource.ts`, `core/module.ts`), `ResourceDef.partition` with a search trigger limited to the type's rows
(`core/search.ts`), `resolveRecordRoutes` (`core/api/conventions.ts`), `defineRuntimeArea`/`removeRuntimeArea`
(`core/features.ts`); `web/src/modules/registers/` (Administration > Registers, the Registers page, each register's
list and record pages, `NavExtras.ts` read by the shell for each register's menu and Create entries); user guide
chapter 41.

### E41-07 More than one language for the portal, kiosk, policies and the app

**Status:** done (wave 21) · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [x] The portal, the policy kiosk and the mobile app's employee-facing screens can be shown in a second language chosen by the person; texts are kept in translation files
- [x] A policy can carry a translation, and an acknowledgment records which language was read

English plus a complete Spanish sample. The person's choice is the `language` preference on their account
(`/api/me/preferences/language`), used by the portal (globe menu; until chosen, the browser's language when
supported) and the app (Account > Language, also kept on the phone); the kiosk chooses per person and
returns to the device's language for the next. Translated: every portal page (the server's own status
hints, "who is affected" and "how urgent" answers and the default title and welcome too, but not wording an
administrator wrote), the kiosk, and in the app the tabs, My work, the policy to acknowledge, the Tag tab
and tag card, the Report tab and its forms, and the Account tab. Not translated: the staff application,
organization-written content (catalog, articles, lookup lists such as safety event types), server
validation messages, notifications and emails, and the app's Search, records, approvals and field work.
A policy version carries one translation per language (title, summary, change summary, text), added or
corrected after publication, frozen once superseded, audited with the text replaced; portal, kiosk and app
acknowledgments (and sign-in sheets, optionally) record the language read, shown in tracking and the CSV.
The mobile portal hazard form also gained **Keep my name confidential** (E41-05).

Proven by unit tests: `policies/translations.test.ts` (embedded database, and with the clock on UTC),
`web/src/core/i18n/i18n.test.ts` (Spanish complete, every key used by the portal and kiosk present, plural
forms, dates), and in the app `src/i18n/i18n.test.ts` (every translated screen complete in Spanish) and
`camera/report/report.test.tsx` (the confidential switch, the form in Spanish). `npx tsx
tools/i18n-missing.ts` lists missing web keys for translators. Screens checked with `tools/browse.mjs` in
light and dark at 1440 and 820 pixels; the browser test `languageTest` in suite `23-portal` is written but
not yet run. Not run on a PostgreSQL server (plain SQL: one new table, two new columns). The Spanish was
written without a native speaker's review; a person should read it, and try the app on a real phone.

**Implemented in:** `shared/i18n.ts` (languages, `translate`, plural forms, `catalogProblems`);
`web/src/core/i18n/` (`I18nProvider`, `useI18n`, `useLanguageChoice`, `LanguageMenu`, `LanguageButtons`,
`locales/en.json`, `locales/es.json`); `web/src/modules/portal/*` and `policies/Kiosk.tsx`;
`policies/TranslationsPanel.tsx` (the **Translations** tab) and the language in acknowledgment tracking;
`server/src/modules/policies/translations.ts`, migration `005_translations.sql`
(`policy_version_translations`, `language` on both acknowledgment tables), `ackRoutes.ts` and
`personAcks.ts` (`lang`, `language`, `languages`); `mobile/src/i18n/` (`localized`, `es.ts`, the
preference) and the screens' `TEXT`; `tools/i18n-missing.ts`; user guide chapters 11, 18 and 39.

### E41-08 Safety and security certification of capital projects

**Status:** done (wave 21) · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [x] A project can carry certifiable items with requirements derived from hazards and threats, each with its verification evidence and status
- [x] A certificate of readiness lists open items and cannot be issued while required items are open; project gates can require it

Proven by unit tests (`projects/certification.test.ts`: items open until every requirement is verified or not applicable; verified needs a method and evidence, not applicable a reason, closing records who and when; hazards and threats as sources, a threat making the requirement restricted, the same figures for a reader without security access and no detail for them; refusing a certificate while a required item is open, accepted open items, one in force, automatic withdrawal when a required item opens again, withdrawal by hand; a gate template requiring the certificate blocks approval and the portfolio's "ready" for projects with certifiable items only; the verifier's My work; the project's department carried for access scope), `core/scope.test.ts` (both new types scoped), the projects, work, permission, route-description, route-sweep, features and spelling tests, on the embedded database and with the clock on UTC. Checked on screen in light and dark at 1440 and 820 pixels. Not run on a PostgreSQL server (plain SQL: `for update`, a partial unique index). No browser suite test was added.

**Implemented in:** module `projects`: `certification.ts` (record types `cert_item` CI- and `cert_requirement` CR-, `restrictedFrom` the hazard or risk, `evidence: true`, scoped by the project's department; `GET /api/projects/:id/certification`, `POST /api/projects/:id/certificates`, `POST .../certificates/:certId/withdraw`, `GET .../certificates/:certId/pdf`; calendar source `projects.certification`), migration `005_certification.sql` (`project_cert_items`, `project_cert_requirements`, `project_certificates`, `requires_certificate` on gate templates and gates), `service.ts` and `rules.ts` (blocker kind `certificate`, gate decisions, gate readiness, portfolio, template setting applied to open gates), `resource.ts` (department carried to items and requirements), `defaults.ts` (lists `cert_item_category`, `cert_item_status`, `cert_requirement_status`, `cert_verification_method`), `seed.ts` (sample certification; the sample projects are now found by name, as the asset condition samples are also named "[Sample]"); `core/api/docs/projects.ts` (blocker kind and template field); web `CertificationTab.tsx`, `CertDialogs.tsx`, `CertPages.tsx` (Projects > Safety and security certification), the gate template switch; user guide chapter 8.

### E41-09 A workspace for outside auditors and funder reviewers

**Status:** done (wave 22) · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [x] An outside reviewer gets access limited to one audit engagement or review: its requests, evidence and findings, for a set period
- [x] People asked for evidence can attach files without `audits.edit`

Proven by unit tests on the embedded database, also with the clock on UTC: `outsidereviews/outsidereviews.test.ts`
(inviting needs email, `audits.edit`/`funding.edit` and a recent password confirmation; staff addresses refused; a new
account has no roles and its set-up link is emailed sealed, never stored readable; the reviewer sees one engagement's
requests, files and findings, or one review's document requests, evidence files and deficiencies, and downloads only
those files; a sweep over every registered route, plus search, pickers, record pages, exports, attachments, history,
the assistant's and the mobile app's routes, My work and tokens, finds nothing else reachable, even with the
administrator role given to the account; end dates, version-checked changes, expiry, revoking, the account disabled and
signed out when nothing is open, re-invitation, an account an administrator disabled kept off; audit invitations hidden
and closed while Audits is off) and `audits/request-files.test.ts` (the person asked attaches, lists, downloads and
removes files on their own requests only, with the usual upload checks; not on restricted requests they may not see;
nothing after the evidence is accepted). The route sweep, permission-use, API coverage and feature tests pass. Checked
on screen in light and dark at 1440 and 820 pixels (the reviewer's pages, the staff tab, the administrators' page, My
evidence requests). Not run on a PostgreSQL server (none was available; the SQL is plain). The browser suite
`11-audits` has a new test (the tab and the administrators' page) that parses but was not run. Not covered: the
reviewer cannot ask questions or comment in the application (read and download only); the user pickers of staff pages
still offer reviewer accounts (the sweep takes off any role they are given, and the server never lets them use one).

**Implemented in:** module `outsidereviews` (`server/src/modules/outsidereviews/`, not a feature area: each kind follows
its record type's area): `gate.ts` (an `onRequest` hook after the session is read: an account in `outside_reviewers`
holds no roles or permissions and reaches only its account security, preferences and `/api/outside-review...`;
everything else answers 404, whatever the roles or the way of signing in), `subjects.ts` (what a reviewer sees of an
`audit_engagement` and a `compliance_review`, and which files), `access.ts` (invitations, accounts, the sealed set-up
email through `mail.queueOne`, ending access, the sweep `outsidereviews.expire` every 6 hours), `routes.ts`
(`/api/audits/:id/outside-reviewers` and `/api/compliance-reviews/:id/outside-reviewers` with `:grantId`, `/revoke`,
`/resend`; `/api/admin/outside-reviewers`; `/api/outside-review`, `/:grantId`, `/:grantId/files/:fileId`), migration
`001_outside_reviews.sql`; the state grant `outsidereviews.reviewer`; `audits/requests.ts`
(`PUT /api/audit-requests/:id/files`, `GET` and `DELETE /api/audit-requests/:id/files/:fid`, files in
`/api/audit-requests/mine`); web `web/src/modules/outsidereviews/` (`ReviewerApp.tsx`, the reviewer's own layout
chosen in `App.tsx`; `ReviewersPanel.tsx`, the **Outside reviewers** tab on audits and compliance reviews;
`AdminReviewers.tsx`, Administration > Outside reviewers), `audits/Requests.tsx` (**Attach files**),
`admin/AccountSecurity.tsx` (`limited`); user guide chapters 25, 27 and 9.

### E41-10 Vendor intake with risk tiers and required checks

**Status:** done · **Priority:** P2 · **Type:** feature · **Implemented in:** `server/src/modules/vendors/intake.ts` (the organization's questionnaire, tier rules and checks per tier in the setting `vendors.intake`, with a neutral starter; lists `vendor_risk_tier` (ranked by order) and `vendor_check`; `tierFor`: the highest tier of any matching rule, never below the default; `GET/PUT /api/vendors/intake-settings` (`vendors.administer` to change), `POST /api/vendors/intake/preview`, `GET/POST /api/vendors/:id/intake` (the questions are copied into each intake, the vendor's read-only `risk_tier` and `risk_tier_on` are set as system work and audited, the owner is told what is outstanding), `GET/POST /api/vendors/:id/checks` and `DELETE /api/vendors/:id/checks/:checkId` (done or waived; waiving and removing a waiver need `vendors.approve` and a reason; an optional expiry after which the check is needed again; removal refused under a legal hold); `checksBlock`, called beside the exclusion-check rule in the contract hooks, so a person cannot create or move a contract to Active while a required check is missing or expired, and with `vendors.intake_before_contract` on, while the vendor has no intake; the `checks_outstanding` figure in `/api/vendors/lifecycle-summary`), migration `006_intake_and_performance.sql`, retention (`onAnonymize('vendor')` clears check notes, intake notes and who recorded them), dev samples `seed-intake.ts`; web `web/src/modules/vendors/Intake.tsx` (the vendor's **Intake and checks** tab with a live tier preview, the **Intake questions** page at `/vendors/intake`, the risk tier chip and list column, the notice on a draft contract). Tests `intake.test.ts` (tier rules, validation, the block on create and activation, waiving needs approve and a reason, expiry, the setting, questionnaire changes keep completed intakes, legal hold, permissions and the switched-off area) and the browser suite `17-vendor-lifecycle.mjs` (written and parsed, not run here). Not run on PostgreSQL here (no server available); the SQL is plain PostgreSQL (`distinct on`, a partial unique index).

**Acceptance criteria**

- [x] An intake questionnaire sets a vendor's risk tier by rules the organization defines
- [x] Each tier has required checks; a contract cannot become active until they are done or waived with a reason

### E41-11 Contractor performance reviews

**Status:** done · **Priority:** P3 · **Type:** feature · **Implemented in:** `server/src/modules/vendors/performance.ts` (contract measures with a target, which way is better, a unit and a monthly, quarterly or yearly frequency; one score per measure and period (`2026-10`, `2026-Q3`, `2026`) with a comment, met or below, a trend from the least-squares line of the last six scores, and the score due for the last ended period on open contracts; `GET /api/contracts/:id/performance`, `GET /api/contracts/performance` (every contract with measures, `visibleWhere`), `POST/PATCH/DELETE /api/contracts/:id/measures[/:measureId]`, `POST /api/contracts/:id/measures/:measureId/scores`, `PATCH/DELETE /api/contracts/:id/scores/:scoreId` (a stale `updated_at` answers 409 `version_conflict`; removals refused under a legal hold); all audited on the contract; `onAnonymize('contract')` clears comments and who recorded them), migration `006_intake_and_performance.sql`, dev samples `seed-intake.ts`; web `web/src/modules/vendors/Performance.tsx` (the contract's **Performance** tab with tiles, sparklines, trend, a chart against the target and the score history; **Contractor performance** at `/contracts/performance`). Tests `performance.test.ts` (periods, trends, met and below, one score per period, future periods refused, the version check, the score due, the review across contracts, legal hold, anonymizing, permissions and the switched-off area).

**Acceptance criteria**

- [x] A contract can carry measures with targets; periodic scores are recorded with comments and a trend

### E41-12 Written test steps per control, and importing coverage

**Status:** done (wave 22) · **Priority:** P3 · **Type:** feature · **Implemented in:** `server/src/modules/controls/steps.ts` (a control's written steps, `GET/POST /api/controls/:id/steps`, `PATCH/DELETE /api/controls/:id/steps/:stepId`, `PUT /api/controls/:id/steps/order`; a new test copies them (`afterCreate` in `tests.ts`), `POST /api/control-tests/:id/steps/copy` brings in steps added later, `GET /api/control-tests/:id/steps` and `PATCH /api/control-tests/:id/steps/:rowId` record each step's result and note with who and when; the testing cannot be marked finished while a step has no result; a reviewed test's steps are locked), list `control_step_result` (`lists.ts`: passed, failed (`meta.failed`), not applicable), `coverage-import.ts` (`POST /api/controls/coverage/import`, a check by default then `dryRun: false`, read through the generic import's `readUpload` (CSV or Excel, same limits); columns Control, Kind of record (optional with a reference) and Record by reference or exact title; only records the caller may see are matched, a hidden one reads as not found; links are only added; per-link audit as on the Coverage tab, restricted records in their own history; `GET /api/controls/coverage/import-template`), migration `controls/002_test_steps.sql` (`control_steps`, `control_test_steps`), sample steps for two controls (`seed.ts`); web `web/src/modules/controls/Steps.tsx` (the **Test steps** tab on a control and on a test), `CoverageImport.tsx` (**Import coverage** on the coverage view), `controls.css`. Test `controls/steps.test.ts` (steps and their order and history, the copy into a test, results and notes, the finish rule, the lock after review, the import's check and run, repeated and existing rows, restricted records hidden, a file without the columns, the template) on the embedded database and with the clock on UTC; browser test `testStepsTest` in `tools/e2e/suites/20-followups.mjs` written (parses) but not run. Screens checked with `tools/browse.mjs` in light and dark at 1440 and 820. Not run on a PostgreSQL server (plain SQL, no locking).

**Acceptance criteria**

- [x] A control can carry written test steps; a control test records the result of each step
- [x] Control coverage can be imported from a spreadsheet

### E41-13 Accessible (tagged) PDFs

**Status:** done · **Priority:** P2 · **Type:** feature · **Implemented in:** `server/src/core/export/pdf.ts` (`taggedDocument`: PDF 1.7, MarkInfo, structure tree, `/Lang` (`en-US`, `PdfOptions.lang`), DisplayDocTitle, PDF/UA identifier and an escaped title in the XMP metadata; `PdfBuilder` tags titles and headings H1 to H3 that never skip a level, paragraphs, notes, lists (L, LI, Lbl, LBody), key-value lists and tables (THead/TBody, TH with Scope, row headers, the header repeated on later pages as an artifact), charts as figures whose alternative text lists the values; logos as figures; headers, footers, page numbers, watermark, rules and shading as artifacts), `core/export/fonts.ts` and `core/export/fonts/` (Arimo regular and bold, SIL Open Font License, embedded as subsets in place of the non-embedded Helvetica, with Helvetica's widths so layouts are unchanged), `modules/tags/print-pdf.ts` (tagged labels, codes as figures named by their value), and the automated check `core/export/pdfua.ts` (pdf.js, `pdfjs-dist` Apache-2.0, development dependency only: tagged, metadata, title, language, every drawing tagged or an artifact and never both, every MCID in the tree, fonts embedded, standard roles, figure alternatives, heading order, table and list structure). Tests `core/export/pdfua.test.ts` (an untagged PDF fails; every builder part passes), and PDF/UA checks in the list export and fact sheet (`export.test.ts`), report, dashboard and pack PDFs (`reports/files.test.ts`, `figures.test.ts`), the security incident kit, the audit report and printed tags; `testing.ts` reads embedded-font text back through ToUnicode maps. Every server PDF goes through these builders; the continuity call tree uses `PdfBuilder` but its test reads only text. Not checked with veraPDF (no Java or Docker engine was running here): a person should run veraPDF's PDF/UA-1 profile on a sample of each kind once, and judge the alternative texts and reading order.

**Acceptance criteria**

- [x] PDFs made by the server are tagged (headings, tables, reading order, document language and title) and pass an automated PDF/UA check

### E41-14 Call-tree messages with acknowledgment

**Status:** done (wave 22) · **Priority:** P3 · **Type:** feature · **Implemented in:** `server/src/modules/continuity/callouts.ts` (`POST /api/emergency-activations/:id/call-outs`: while the activation is active, one activated plan's call tree is sent a message through core mail (`queueOne` with the link sealed as for set-up links) and `app.sendText` (email-to-text address or the text-message webhook), each person once, each with their own link valid 1 to 168 hours (72 by default); an account gets email and texts, a roster person without an account email at the roster address, a typed name is listed to call; refused with `no_channels` when neither way is set up; at most 20 sends an hour per activation; `GET .../call-outs` lists each message with who has acknowledged, how each was reached and the delivery state; `POST .../call-outs/:cid/recipients/:rid/acknowledge` records an acknowledgment taken by phone; `POST .../call-outs/:cid/remind` resends to those still waiting with new links; public `GET/POST /api/call-out/:token` (no sign-in: a random 32-byte secret, only its SHA-256 hash stored, single-purpose, expiring, refused once the activation is closed or the area is off, rate limited per address with the same "not valid" answer; opening never acknowledges); everything is written to the activation's log and audited), migration `continuity/004_call_outs.sql` (`activation_callouts`, `activation_callout_recipients`), anonymizing an activation clears the names and notes (`index.ts`); web `web/src/modules/continuity/CallOuts.tsx` (the **Call tree messages** tab on an activation, and the public page `/call-out/:token`), `continuity/index.tsx` (public route), `Activations.tsx`, `continuity.css`; the alert-contact card on Account security shows while business continuity is on, not only security incidents (`web/src/modules/admin/AlertContact.tsx`). Test `continuity/callouts.test.ts` (refused with no channels, validation and permissions; email and email-to-text read back from a stand-in mail server, one link per person, the same link by email and text, no secret stored or in the email log; the public page, acknowledging once, the list and its counts; wrong links; a staff acknowledgment; reminders replace the link; expiry, a closed activation and the area switched off; anonymizing) on the embedded database and with the clock on UTC; browser test `callOutTest` in `tools/e2e/suites/13-continuity.mjs` written (parses) but not run. Screens checked with `tools/browse.mjs` in light and dark at 1440 and 820, including the public page. Not proven: delivery through a real mail server, a real carrier's email-to-text gateway or a real text-message webhook, and the message on a real phone. Text messages reach only people with an account (`sendText` takes accounts), and a text carries its link in its text, so the link is in the text delivery log administrators read. Not run on a PostgreSQL server (plain SQL).

**Acceptance criteria**

- [x] A continuity call tree can be sent by email and text message through the existing alert channels; each person can acknowledge, and the activation shows who has not

### E41-15 Retention schedule and destruction log for the organization's own records

**Status:** done (wave 22) · **Priority:** P3 · **Type:** feature · **Implemented in:** module `recordsretention`
(`server/src/modules/recordsretention/`: `index.ts` record types `record_series` (table `record_series`: schedule number,
category, paper or electronic, owner, department, where kept, system, period in days, months or years or kept
permanently, trigger event, disposition, authority as the organization cites it, vital and personal-data flags, next
review) and `records_destruction` (table `records_destructions`: series, the records' dates, trigger date, the
date they may go worked out from the series, quantity, method; status proposed, waiting for approval, approved,
rejected, carried out, canceled), routes `GET /api/records-destructions/:id/state` and `POST .../submit`,
`.../carried-out`, `.../cancel`, approval kind `records_destruction` (default workflow: one step, `records.approve`;
with no workflow someone holding `records.approve` approves on submission), legal holds on the series or the entry
refuse submission and carrying out and send an approval that finishes under a hold back to proposed, submitted
and carried-out entries are kept (no delete, details fixed), a series with destructions is retired not deleted,
calendar sources `recordsretention.reviews` and `recordsretention.destructions` (My work, compliance calendar,
feeds); `periods.ts`; `seed.ts` invented samples; migration `001_records_retention.sql`), feature area
`recordsretention` (`core/features.ts`, shares the `records` permissions), `web/src/modules/recordsretention/`
(Governance > **Retention schedule** and **Destruction log**, the destruction's **Progress** card), user guide
chapter 42. Proven by unit tests (`recordsretention.test.ts`: periods, the schedule, early and permanent refusals,
approval and rejection through the engine, carried out, kept entries, legal holds before and after approval, no
workflow, the area switched off, permissions) on the embedded database, through the PostgreSQL wire protocol and
with the clock on UTC; screens checked in light and dark at 1440 and 820 pixels. The browser suite
`26-retention-and-files` is written (parses) but not yet run. No periods are built in: each organization enters
its own schedule and authority.

**Acceptance criteria**

- [x] A retention schedule of the organization's record series (paper and electronic), with periods and triggers, and a destruction log with approvals

### E41-16 Searching inside attached files, and file preview

**Status:** done (wave 22) · **Priority:** P3 · **Type:** feature · **Implemented in:** `server/src/modules/attachments/text.ts`
(job `attachments.text_index`: hourly and after every upload, newest files first, a batch at a time; files over
25 MB are skipped; each file is read in a worker thread with its own memory limit, ended after 30 seconds; at most
300,000 characters and 2,000 PDF pages kept; a reader library missing from an installation leaves its files waiting
instead of failing them), `text-worker.mjs` (PDF through pdf.js text extraction, no scripts, fonts or forms; .docx
through fflate with an unpack limit, field codes left out, macros never looked at; .txt, .md, .log, .csv as UTF-8 or
UTF-16; no outside program), migration `attachments/005_file_text.sql` (table `attachment_texts` with a search
vector; a trigger forgets a file's text the moment it is removed, whatever removes it), `core/search-global.ts` (the
global search, and so the assistant's search, finds a record by its files' text under the record's visibility, with
the matching passage after the file name), `GET /api/attachments/:id/preview` (`index.ts`, `intake.ts`,
`filetypes.ts` `previewKind`: PNG, JPEG, GIF, WebP, BMP and PDF only, under their fixed type, `Content-Disposition:
inline` only for those, `default-src 'none'; sandbox` kept, previews from restricted records audited), the list's
`preview` and `text_status`, `web/src/modules/attachments/PreviewDialog.tsx` (images from a blob address; PDFs drawn
on canvases by pdf.js, loaded only when needed, first 30 pages, no change to the application's content security
policy), **Text searchable** on the file list, "In a file" in the search palette. Proven by unit tests
(`attachments/text.test.ts`: PDF, Word and UTF-16 text; damaged files and the time limit; search by each kind under
the record's visibility for an administrator, an agent and a requester; removal and restore; previews' headers,
refusals and visibility) on the embedded database, through the PostgreSQL wire protocol and with the clock on UTC;
search and both previews checked in a real browser in light and dark at 1440 and 820 pixels. The browser suite
`26-retention-and-files` is written (parses) but not yet run. Not covered: scanned PDFs (no text recognition),
older .doc files, spreadsheets and presentations (found by file name only).

**Acceptance criteria**

- [x] Text in attached PDF, Word and plain-text files is found by search (with the attachment's record's visibility)
- [x] Images and PDFs can be previewed in the browser without downloading

### E41-17 Small items

**Status:** done · **Priority:** P3 · **Type:** feature · **Implemented in:** data wiping: `server/src/modules/inventory/fields-wiping.ts` (asset fields **Holds data**, method, date, who and certificate reference, list `data_wipe_method`: cleared, purged, destroyed; `GET /api/assets/:id/data-wiping-certificate.pdf`), `lifecycle.ts` (`disposalProblem` refuses to dispose of an asset that holds data without its wiping record, however the status changes), migration `inventory/010_data_wiping.sql`, `web/src/modules/inventory/AssetDialogs.tsx` and `AssetLifecycle.tsx`, test `inventory/data-wiping.test.ts`; meeting invitations: `server/src/modules/governance/invitations.ts` (`GET/POST /api/meetings/:id/invitations`, `GET /api/meetings/:id/invitation.ics`; an iCalendar REQUEST to members in office with an account or roster email, an update with a higher SEQUENCE after a change, a CANCEL once canceled), migration `governance/002_meeting_invitations.sql` (length, when sent, sequence), the **Invitations** tab in `web/src/modules/governance/Meetings.tsx`, test `governance/invitations.test.ts` (through the test mail server); the combined heat map: `server/src/modules/risks/common-heatmap.ts` (`GET /api/risks/heatmap/common`: every offered scale on a five-step grid at the common levels), **All scales** on the register's heat map (`web/src/modules/risks/RiskRegister.tsx`), test `risks/common-heatmap.test.ts`; portal reports from scratch in the mobile app: `mobile/src/camera/report/` (`ReportHomeScreen`, `ReportFormScreen`, `build.ts`: `?via=portal` posts to `/api/portal/requests` or `/api/portal/safety-reports`; a hazard only while the portal takes safety reports), Jest tests in `report.test.tsx`. Proven by unit tests (embedded database) and Jest; the invitation was read back from the test mail server, not opened in a real calendar program, and the app screens were not run on a real phone.

**Acceptance criteria**

- [x] Disposal of a data-bearing asset records how its data was wiped, by whom, with a certificate
- [x] Records-request deadlines use the holiday calendar (with E40-10: the service desk's **Business hours** calendar is the one working-day calendar, `server/src/core/working-days.ts`)
- [x] Meeting invitations by email (an `.ics` attachment)
- [x] A heat map that combines every risk scale at the common level
- [x] Portal users can report a problem from scratch in the mobile app, not only from a tag card
