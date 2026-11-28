# E44 Navigation and usability

**Status:** done (10 of 10 issues done)

## Goal

The side menu had 154 entries in 13 groups, named after the code's modules: risks, policies, training
and the action tracker sat under Cybersecurity, Administration alone had 38 entries, and an employee had
to open Cybersecurity to find their own training. A wave 24 review walked the application as the staff
who use it (service desk, IT management, security, compliance, risk, audit, governance, safety, fleet,
continuity, executives and employees) and rebuilt the navigation around their work: one menu entry per
thing people work on, sibling pages as tabs, a personal **My work** page, and one **Administration**
page. Nothing became unreachable: every page keeps its address and stays in the search box.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E44-01 | Menu groups named after the work, sibling pages as tabs | done | P1 |
| E44-02 | The My work page and Calendar | done | P1 |
| E44-03 | The Administration page | done | P1 |
| E44-04 | Pinned pages and recently opened records | done | P2 |
| E44-05 | One approvals inbox and an honest "waiting for you" count | done | P1 |
| E44-06 | Permissions on Expiring evidence files and the API reference | done | P2 |
| E44-07 | Header buttons that repeat a tab | done | P3 |
| E44-08 | One page for expiring evidence | done | P3 |
| E44-09 | A start page per role and a count on My work | done | P2 |
| E44-10 | Administration cards still missing | done | P3 |

### E44-01 Menu groups named after the work, sibling pages as tabs

**Status:** done · **Priority:** P1 · **Implemented in:** `web/src/core/navGroups.ts`, `navModel.ts`, `module.ts` (`menu`, `parent`, `tab`, `tabs`), `Shell.tsx`, `ui.tsx` (`PageTabs`); every module's `nav` entries; `server/src/modules/registers/definitions.ts` (old group names).

Groups, in order: Home, IT services, Assets, Vendors, Projects and funding, Security, Risk and
compliance, Safety and emergency management, Governance and records, Documents, People and training,
Reports, Administration. An administrator with every area on sees 46 entries (plus registers); a person
with no role sees three (Overview, My work, Calendar). Pages that belong to another are tabs under its
heading, drawn by the shell. Help left the menu: the top bar's **?** opens the guide at the page on
screen. Groups start closed except the current one. Registers stored with an old group name are read
under the new one. A group named after two areas drops the name of one switched off (`groupLabel`:
"Risk and compliance" reads "Compliance" while risks are off). `navOrder.test.ts` keeps the menu at 60
entries or fewer.

### E44-02 The My work page and Calendar

**Status:** done · **Priority:** P1 · **Implemented in:** `web/src/modules/mywork/`.

`/my-work` gathers the person's tickets, actions, approvals, due work, training, acknowledgments, access
reviews, delivered reports and watched records, with tabs over the existing personal pages; switched-off
areas and missing permissions leave their cards and tabs out. **Compliance calendar** is now **Calendar**.

### E44-03 The Administration page

**Status:** done · **Priority:** P1 · **Implemented in:** `web/src/modules/admin/AdminHub.tsx` (`hub`, `hint` on nav entries).

`/admin` replaces 38 menu entries with six sections of cards (People and access, Organization, Records
setup, Area settings, Connections, Data and operations), a **Find a setting** box and a Features status
line. Each area's settings are also the last tab (**Settings**) of that area's page. Card pages show an
"Administration ›" breadcrumb.

### E44-04 Pinned pages and recently opened records

**Status:** done · **Priority:** P2 · **Implemented in:** `web/src/core/navMemory.ts`, `CommandPalette.tsx`, `ui.tsx`.

A star on each page heading pins the page (up to ten, kept per person on the server) to the top of the
menu and the search box; the search box lists the last eight records opened before anything is typed.

### E44-05 One approvals inbox and an honest "waiting for you" count

**Status:** done · **Priority:** P1 · **Implemented in:** `web/src/modules/workflows/inbox.ts`, `ApprovalsPage.tsx`, `web/src/modules/home/widgetsMyWork.tsx`.

The Overview's **My approvals**, My work and **Approvals > Waiting for me** show the same items and count
(workflow steps where the person is an approver, exception requests, documents in review). The headline
"N items are waiting" no longer counts unread notifications.

### E44-06 Permissions on Expiring evidence files and the API reference

**Status:** done · **Priority:** P2

**Expiring evidence files** needs the vendors view permission (it is a tab of Vendors > Evidence); the API
reference card needs administration; Service desk settings are offered only to service desk administrators.

### E44-07 Header buttons that repeat a tab

**Status:** done · **Priority:** P3 · **Implemented in:** `web/src/modules/changes/ChangeList.tsx`, `projects/PortfolioPage.tsx`, `training/ExercisePages.tsx`, `training/Overview.tsx`, `vendors/VendorPages.tsx`, `vendors/EvidencePages.tsx`, `admin/Settings.tsx`.

Some pages still have header buttons for what is now a tab (Tickets Dashboard, Changes Calendar, Vendors
question sets, Training Courses, Projects Settings and others), and **Administration > Settings** repeats
sections that have their own pages.

Done in wave 26: the Changes Calendar, Projects Settings, Training Courses and Reminder settings, Exercises Calendar and Vendors Security terms matrix buttons are gone (tabs only); the vendor question buttons stay only for readers without the tab; **Administration > Settings** has an **Elsewhere** group of links instead of repeating File settings and Departments.

### E44-08 One page for expiring evidence

**Status:** done · **Priority:** P3 · **Implemented in:** `web/src/modules/attachments/ExpiringEvidence.tsx`, `attachments/index.tsx`, `vendors/index.tsx`, `evidence/index.tsx`.

Expiring vendor evidence and expiring files on any record are two tabs; one page with a source filter
would be simpler.

Done in wave 26: `/attachments/expiring` lists vendor evidence, evidence library records and evidence files with a **Source** filter and a look-ahead of 30 to 365 days; it is the Expiring tab of Vendors > Evidence and of the Evidence library, and `/evidence/expiring` opens it on vendor evidence.

### E44-09 A start page per role and a count on My work

**Status:** done · **Priority:** P2 · **Implemented in:** `server/src/modules/work/home.ts` (test `work/home.test.ts`), `web/src/modules/home/HomeRoute.tsx`, `widgetsAreaLeads.tsx`, `admin/RoleHome.tsx`, `web/src/core/Shell.tsx` (`NavItem.count`).

A role chooses where its people land (Overview, the portal, a dashboard), and My work shows a count of
what waits.

Done in wave 26: each role, and people with no role, has a home page (Overview, My work, the portal or a dashboard; setting `home.role_homes`, `GET/PUT /api/work/role-homes`), applied on arrival at "/" only; people with no role land on My work. The My work menu entry shows what waits (`GET /api/work/waiting`). The Overview gains widgets for safety, inspections, vehicles, state of good repair and continuity, and an active-emergency banner.

### E44-10 Administration cards still missing

**Status:** done · **Priority:** P3 · **Implemented in:** `web/src/modules/secincidents/index.tsx`, `training/Settings.tsx`, `training/index.tsx`, `policies/index.tsx`.

Security incident rules and checklists (needs a separate administer permission so the card does not show
Administration to every security viewer), training reminders (a dialog today, with no address of its own),
and document settings.

Done in wave 26: Administration cards **Security incident rules** (`/security-incidents/settings`, `security.administer`), **Training settings** (`/training/settings`, also the Settings tab of Training) and **Document settings**.
