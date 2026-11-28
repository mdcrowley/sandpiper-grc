# Feature tracker

This folder is the project's feature tracker. It lists everything the application does
and everything it does not do yet, as **epics** (areas of work) made up of **issues**
(pieces small enough to finish in one sitting).

It lives in the repository as Markdown because there is no hosted issue tracker yet.
The format is chosen so that each entry can be copied into GitHub Issues later without
rewriting (see [Moving to GitHub Issues](#moving-to-github-issues)).

- Built features are recorded as `done` issues, so that there is one list of what
  exists, with the files and endpoints that implement each item.
- Missing features and known defects are `open` issues.
- `docs/known-gaps.md` stays the short, honest summary for evaluators. This tracker is
  the detailed, actionable version of the same facts. The two must agree.

## How it is organized

```
docs/roadmap/README.md          this file: rules, summary of epics, what to do next
docs/roadmap/epics/E01-….md     one file per epic
```

Each epic file has a title, a goal, scope notes, a table of its issues, and then one
section per issue.

### IDs

- Epics are `E01`, `E02`, … in a fixed order.
- Issues are `<epic>-<two digits>`: `E01-01`, `E01-02`, …
- **IDs are never reused and never renumbered.** A new issue takes the next free number
  in its epic. An issue that is dropped stays in the file, marked as described under
  [Closing an issue](#closing-an-issue).

### Fields on every issue

| Field | Values | Meaning |
|---|---|---|
| **Status** | `done`, `in progress`, `open`, `blocked` | `done`: every acceptance criterion that matters is met and tested. `in progress`: someone is working on it now. `open`: not started. `blocked`: cannot start until something outside the issue changes (the description says what) |
| **Priority** | `P1`, `P2`, `P3` | `P1`: must have before a pilot. `P2`: should have. `P3`: later |
| **Type** | `feature`, `improvement`, `bug`, `debt`, `docs` | `feature`: something new. `improvement`: makes an existing feature better. `bug`: something is wrong. `debt`: internal work users do not see. `docs`: documentation only |
| Description | one paragraph | Written from the user's point of view |
| **Acceptance criteria** | checklist | `- [x]` met, `- [ ]` not met |
| **Implemented in** | files and endpoints | Required once an issue is `done` |

A `done` issue may still show an unchecked criterion when a later improvement is tracked
by another issue; the unchecked line names that issue.

An epic's status is `done` when all its issues are done, `open` when none are started,
and `in progress` otherwise.

## Rules

1. **Every code change updates the tracker in the same change.** If a commit adds,
   changes or removes behavior, the same commit edits the affected issue (status,
   checked criteria, "Implemented in") and its epic (the issues table, and the epic's
   status if it changed), and the counts in the table below. A change with no issue
   gets one first.
2. **`docs/known-gaps.md` is updated in the same change too.** Closing an issue that
   came from a known gap removes or rewords that gap. Finding a new gap adds a line
   there and an issue here.
3. **Status must be true.** Do not mark an issue `done` unless it is built, has a test,
   and you have confirmed it. If you cannot confirm it, it is `open`.
4. **Keep issues small.** If an issue cannot be finished in one sitting, split it into
   new issues with new IDs and say so in the original.
5. **Nothing organization-specific.** No real organization, person, place, law,
   regulator or vendor names in any issue, as in the rest of the repository.
6. Plain English and American English spelling.

### Adding an issue

1. Pick the epic it belongs to. If it is a defect, it goes in
   [E18](epics/E18-quality-and-known-defects.md) with a link from the feature's issue.
2. Take the next free ID in that epic.
3. Add a row to the epic's issues table and a section at the end of the file, using
   this template:

   ```markdown
   ### E03-18 Short title in sentence case

   **Status:** open · **Priority:** P2 · **Type:** feature

   One paragraph from the user's point of view: who wants what, and why. Say what
   happens today if that helps.

   **Acceptance criteria**

   - [ ] A result that can be checked
   - [ ] Another
   ```

4. Update the epic's row in the summary table below (the total goes up by one).
5. If it should be done soon, add it to [Next up](#next-up) with one line of reasoning.

### Closing an issue

1. Check the acceptance criteria that are met. Anything deliberately left out becomes a
   new issue, and the unchecked line names it.
2. Set **Status** to `done` in both the issue section and the epic's table.
3. Add an **Implemented in** line naming the main files and endpoints.
4. Update the counts in the summary table below, remove the issue from "Next up" if it
   was there, and update `docs/known-gaps.md`.

To drop an issue without doing it, keep the section, set the status to `done`, and
make the first line of the description "Not planned:" followed by the reason. Do not
delete it and do not reuse its ID.

## Moving to GitHub Issues

When the repository has a remote, the tracker can move across mechanically.

- **One GitHub issue per entry.** The title is the ID and title together, for example
  `E03-11 Screen for the priority matrix`, so existing cross-references still read
  correctly. The body is the description, the acceptance criteria checklist (GitHub
  renders `- [ ]` as checkboxes) and, for done issues, the "Implemented in" line.
- **Epic as a label or a milestone.** Use a label per epic (`epic:E03-service-desk`)
  when epics run in parallel and never "finish"; use a milestone per epic when you want
  GitHub's progress bar. Do not use both for the same thing. Optionally also create one
  tracking issue per epic holding its goal, scope notes and a task list of its issues.
- **Labels for the other fields.** `priority:P1` to `priority:P3`, and `type:feature`,
  `type:improvement`, `type:bug`, `type:debt`, `type:docs`.
- **Status.** `open` becomes an open issue; `in progress` an open issue with an
  assignee (or a project board column); `done` a closed issue. Create done issues too,
  and close them immediately, so the history of what is built is searchable.
- **Cross-references.** After import, replace IDs in issue bodies with `#number` links.
- **Afterwards.** Replace the epic files with a short page per epic that links to its
  label or milestone, keep this README as the description of the scheme, and change
  rule 1 to "every pull request references its issue". Until then, the files here are
  the only tracker.

## Epics

Counts are taken from the issues table of each epic file. "Done / total" counts issues with
status `done`; issues in progress, open or blocked are counted in the total only.

| ID | Epic | Status | Done / total |
|---|---|---|---|
| [E01](epics/E01-platform-foundations.md) | Platform foundations | done | 34 / 34 |
| [E02](epics/E02-account-security.md) | Account security | in progress | 29 / 30 |
| [E03](epics/E03-service-desk.md) | Service desk | done | 22 / 22 |
| [E04](epics/E04-inventory-and-relationship-map.md) | Inventory and relationship map | done | 24 / 24 |
| [E05](epics/E05-change-enablement.md) | Change enablement | done | 13 / 13 |
| [E06](epics/E06-vendors-and-contracts.md) | Vendors and contracts | done | 25 / 25 |
| [E07](epics/E07-framework-outcomes-and-assessments.md) | Framework outcomes and assessments | done | 25 / 25 |
| [E08](epics/E08-risks-actions-and-obligations.md) | Risks, actions and obligations | done | 23 / 23 |
| [E09](epics/E09-security-incidents-and-notification-clocks.md) | Security incidents and notification clocks | done | 25 / 25 |
| [E10](epics/E10-policies-training-exceptions-exercises-vulnerabilities.md) | Policies, training, exceptions, exercises and vulnerabilities | done | 18 / 18 |
| [E11](epics/E11-projects-and-portfolio.md) | Projects and portfolio | done | 25 / 25 |
| [E12](epics/E12-dashboards-and-reporting.md) | Dashboards and reporting | done | 16 / 16 |
| [E13](epics/E13-imports-api-integrations.md) | Imports, API and integrations | done | 23 / 23 |
| [E14](epics/E14-platform-services.md) | Platform services | done | 39 / 39 |
| [E15](epics/E15-self-service-portal.md) | Self-service portal | done | 14 / 14 |
| [E16](epics/E16-hosting-operations-and-hardening.md) | Hosting, operations and hardening | in progress | 35 / 39 |
| [E17](epics/E17-documentation.md) | Documentation | done | 14 / 14 |
| [E18](epics/E18-quality-and-known-defects.md) | Quality and known defects | done | 95 / 95 |
| [E19](epics/E19-fleet-and-services.md) | Fleet and services | done | 14 / 14 |
| [E20](epics/E20-safety-management.md) | Safety management | done | 15 / 15 |
| [E21](epics/E21-mcp-server.md) | MCP server (AI assistant access) | done | 25 / 25 |
| [E22](epics/E22-review-fixes.md) | Review fixes (wave 9) | done | 48 / 48 |
| [E23](epics/E23-corrective-action-plans.md) | Corrective action plans and verification | done | 12 / 12 |
| [E24](epics/E24-audits-and-inspections.md) | Audits and inspections | done | 13 / 13 |
| [E25](epics/E25-safety-reporting-investigation-and-targets.md) | Safety reporting, investigation and performance targets | done | 15 / 15 |
| [E26](epics/E26-control-library-and-testing.md) | Control library and control testing | done | 11 / 11 |
| [E27](epics/E27-funding-and-grant-compliance.md) | Funding and grant compliance | done | 11 / 11 |
| [E28](epics/E28-committees-meetings-and-safety-plan.md) | Committees, meetings and the safety plan | done | 12 / 12 |
| [E29](epics/E29-staff-roster-qualifications-and-acknowledgments.md) | Staff roster, qualifications and frontline acknowledgments | done | 12 / 12 |
| [E30](epics/E30-obligations-regulatory-change-and-enterprise-risk.md) | Obligations, regulatory change and enterprise risk | done | 9 / 9 |
| [E31](epics/E31-business-continuity.md) | Business continuity and emergency management | done | 10 / 10 |
| [E32](epics/E32-asset-condition-and-state-of-good-repair.md) | Asset condition and state of good repair | done | 9 / 9 |
| [E33](epics/E33-ot-and-rail-systems-cybersecurity.md) | OT and rail-systems cybersecurity | done | 6 / 6 |
| [E34](epics/E34-legal-hold-records-requests-and-privacy.md) | Legal hold, records requests and privacy | done | 9 / 9 |
| [E35](epics/E35-vendor-risk-lifecycle.md) | Vendor risk lifecycle | done | 7 / 7 |
| [E36](epics/E36-integrations.md) | Integrations | done | 8 / 8 |
| [E37](epics/E37-asset-tags.md) | Asset tags: values, printing and lookup | in progress | 9 / 10 |
| [E38](epics/E38-mobile-apps.md) | Mobile apps for iPhone and Android | in progress | 11 / 15 |
| [E39](epics/E39-vehicle-and-asset-models.md) | Vehicle and asset models | done | 7 / 7 |
| [E40](epics/E40-production-hardening.md) | Production hardening | done | 15 / 15 |
| [E41](epics/E41-product-gaps-wave-19.md) | Product gaps found in the wave 19 review | done | 17 / 17 |
| [E42](epics/E42-windows-installer.md) | Windows installer, in-place updates and the update check | in progress | 7 / 8 |
| [E43](epics/E43-document-control.md) | Document control: policies, standards, procedures, SOPs and plans | done | 19 / 19 |
| [E44](epics/E44-navigation-and-usability.md) | Navigation and usability | done | 10 / 10 |
| [E45](epics/E45-product-gaps-wave-24-review.md) | Product gaps found in the wave 24 review | done | 67 / 67 |
| [E46](epics/E46-wave-26-new-areas-and-remaining-gaps.md) | Wave 26: new areas and the remaining gaps | done | 74 / 74 |
| | **Total** | | **981 / 992** |

Wave 27 finished every open issue that could be built in code (E46-53 to E46-74, E45-61, E40-15).
After it, a data load can create disabled accounts used only to name employees and vendor contacts in
loaded history, with nothing ever sent to them (E18-95, MCP `create_account`).
Enterprise risk: an appetite change can go through an approval workflow. Dashboards: the change
success gauge reads the changes module's rate, the Board summary shows the safety indicators, and a
widget shows one strategic measure. Funder review readiness counts the previous review's open
deficiencies and overdue award obligations. Documents: OCR languages are chosen in Administration
(Spanish data bundled), an issued paper copy prints its copy number, and the board book merges the
structure of tagged PDF papers. Strategy follows the organization's fiscal year and takes measures
from statistics series. Civil rights limits count calendar or working days and a complaint has several
bases. Insurance records claim payments one by one, allocates premiums, keeps a schedule of values,
asks vendors for certificates by email and shows on the contract. Procurement records invoices with a
three-way match, approval and payment, and keeps budget versions. Fleet has planned maintenance
intervals and mileage history; every employee sees their own certifications, and certifications filter
by position and department. A switched-off role gives a warning wherever it is assigned, reminder
settings of a switched-off area are hidden, and sample defects are marked as sample data. Continuous
integration now checks what changed (E40-15): `grc ci` and GitHub run only the tests, builds and
browser suites a change needs (everything nightly and on tags, one required check), and test databases
start from a migrated template. The 11 issues not done need a person, hardware or outside accounts
(see [Next up](#next-up)).
The first GitHub run after the change-based CI turned up three fixes: mobile tests resolve the
shared code's Babel helpers from the app's own packages (the job no longer installs the root), the
route tour waits briefly for the heading after a redirect, and warning notices use the amber colors
so their titles and secondary text meet 4.5:1 in both themes.

Wave 26 added four areas (E46): **Procurement and budgets** (solicitations with evaluation committees
and awards, purchase orders with approval and receiving, budgets against committed and spent),
**Insurance** (policies, conditions tracked by controls, covered records, renewals, certificates of
insurance checked against contract requirements, restricted claims), **Civil rights** (programs with
required elements and evidence, monitoring reports, complaints with time limits and confidential by
default, business participation goals; off as installed) and **Strategy and performance** (the strategic
plan, measures with targets, quarterly updates, a board scorecard, operating statistics and statistical
submissions). Operations got defects raised from inspections, missed-inspection follow-up, governed
vehicle retirement, a safety plan tab, indicator status and continuity plan templates. Default roles
were given what their work needs, the Executive viewer became a leadership view with an
organization-wide Board summary, each role has a home page, My work shows what waits and anyone can
report a problem. It finished document control (E43: paper copies, OCR of scanned PDFs with
tesseract.js and bundled language data, diagonal status marks, loaded versions undone one by one),
navigation (E44-07 to E44-10) and the wave 24 review (E45-53 to E45-67 except E45-61, done in wave 27), and fixed feature switches so a change applies at once to work outside a request
(E46-52). The 21 issues it left open in E45 and E46 were done in wave 27.

Wave 25 built the product gaps of the wave 24 review (E45): enterprise risk stands on its own beside
cybersecurity (risks need only `risks.view`, restriction per risk, target risk, a versioned appetite, a
Risk manager role); an evidence library filed once and linked to many records, with expiry reminders
and an Evidence tab on every evidence-bearing record; funders as records and funder reviews connected
to awards, controls and evidence, carried forward to the next review; internal audit with a risk-ranked
and approved audit plan, workpapers with preparer and reviewer sign-off, and findings (and their
corrective action plans) closed only after an auditor's verification; a board book PDF, closed sessions,
structured minutes, motions with votes and resolution numbers, and a member reading view; the IT
workflow gaps (escalating tickets, a next-stage button for incidents, vulnerabilities grouped and ranked
by urgency, system lifecycle and vendor spend, change success and IT leadership widgets); and an AI
assistant that builds complete records with files. Every module's who-did-it columns now follow the
person a data load names (E18-94). The 15 E45 issues not done are listed in the epic.

Wave 24 reviewed the application as its staff use it and rebuilt the navigation (E44: 13 groups
named after the work, 46 menu entries for an administrator instead of 154, a My work page, one
Administration page, pinned pages and recent records), added document control (E43: policies,
standards, procedures, SOPs, work instructions and plans with types, hierarchy, controlled numbers,
distribution limited to departments, roles or groups, versions with their real dates, reviews, Word
conversion, PDF originals, printing as controlled copies, package import and MCP loading tools), let a
data load name the real author of what it loads (E18-71), and fixed 22 problems the review found
(E18-72 to E18-93). The 20 issues not done are listed in their epics.

Before wave 24, of the 11 issues not done, E42-07 (the Windows installer on a real Windows Server, by hand) needs a
person. Every product gap of the wave 19 review (E41) is built. Wave 20 built E41-01
(departments are records (parent, manager, merge); role grants can be limited per area to the members'
departments or sites and those below them; out-of-scope records are hidden like restricted ones;
figures unchanged), E41-02 (the account register per system with roster matching and leaver and
on-leave flags, imports per system, review campaigns decided by each system's owner with reminders,
removals tracked to done through actions or the next import, a CSV decision file, and recording a
finished campaign as a control test), E41-03 (one registration, the calendar source registry, feeds
My work on the web, in the app and in the assistant, calendar feeds and the new Compliance calendar
(`/calendar`: month, list and my due work, filters by area, kind and person); new kinds: evidence
requests, corrective actions to verify, obligation periods to attest, certification renewals and
funding certifications), E41-04 (figures over time (counts with a breakdown, or metrics) recorded at
each month end and on demand, the same for everyone, charted on Reports > Figures over time, in
dashboards (Figure over time widget) and board packs), E41-13 (every server PDF is tagged for PDF/UA
(structure, language, title, embedded fonts, artifacts, chart alternatives), checked in unit tests
with pdf.js; a veraPDF run by a person is still to do) and E41-17 (data wiping proof at disposal,
meeting invitations as .ics, a heat map of every scale at the common level, and portal reports from
scratch in the mobile app); E40-14 (rotation procedures for every secret, most carried out once and the rest proven by unit tests, and the
audit archive as an owner command) closed E40; and E42 (a Windows installer with in-place updates
and the update check) was built in wave 20 too.

Wave 21 built E41-05 (confidential safety reporting: the reporter's identity is kept off the safety
event and shown only to named people, each look audited, and the reporter is told what changed),
E41-06 (registers an administrator defines, such as lost property, keys issued or visitors, with
their own fields, numbering, permissions and switch), E41-07 (the portal, the policy kiosk and the
app's employee-facing screens in English and Spanish, the person's choice saved on the account;
policy versions carry translations; acknowledgments record the language read) and E41-08 (safety
and security certification of capital projects: certifiable items and requirements derived from
hazards and threats, verified with evidence; a certificate of readiness that cannot be issued while
a required item is open and lists the open items it accepts; gate templates can require it).

Wave 22 built E41-09 (outside reviewers, an external auditor or a funder's reviewer, invited by
email to one audit engagement or compliance review until an end date and confined by the server to
it; the person asked for evidence attaches files without `audits.edit`), E41-10 and E41-11 (vendor
intake questionnaires that set a risk tier and the checks needed before a contract becomes active;
contractor performance measures with targets, periodic scores and trends), E41-12 (written test steps
on a control with per-step results in each test; control coverage imported from a spreadsheet,
checked, then added), E41-14 (an activation sends a plan's call tree a message by email and text
message; each person acknowledges through their own link without signing in; the activation lists
who has not acknowledged, with phone acknowledgments and reminders), E41-15 (a retention schedule
and destruction log for the organization's own records) and E41-16 (search inside attached files,
with previews of images and PDFs).

Data load mode (E18-70) lets an administrator load historical records, such as past service desk
tickets, with their original dates through the API or an AI assistant, sends nothing for them, and
undoes a load from Administration > Data loads.

Wave 23 was an internal security review of waves 20 to 22 (E18-68): file text is read in a separate
process with memory and time limits, so a hostile PDF cannot exhaust the server; the Windows installer
refuses pre-created folders, reads only `GRC_*` settings, checks ownership before elevated steps and
locks down the program folder (E42-08); figures are checked as the person who saves them; scoped
people cannot widen their own scope and detail groupings are masked by scope; outside reviewer
accounts hold no roles, must use a second factor and are not offered in pickers; published policy
translations need approval and acknowledgments record the text's SHA-256; call-out links and meeting
invitations are rate limited more precisely.

Of the other 10, 5 are in the epics E37 (asset tags) and E38 (mobile apps), specified in
[the asset tags and mobile apps specification](specs/asset-tags-and-mobile-apps.md): the online app
was built in wave 13, offline reports, push notifications and the Maestro flows in wave 14, and
offline inspections, condition assessments and counts (E38-11, E38-12) and the Android UnifiedPush
connector in wave 15, and the apps' internal accessibility and security review (E38-15) in wave 16; checks on real phones and signed
releases need a person. The other 5 need a person or a real machine (E02-08, E16-15, E16-40, E16-41,
E16-42); E18-65, the interface items left from the wave 17 review, was built in wave 18. E39
(vehicle and asset models, members inheriting a shared specification) was built in wave 18 too. E23 to E30 were built in wave 10 and E31 to E36 in wave 11 (the product gaps of the
November 2026 review); E31-10, the last of them, was built in wave 12. Some of their done issues are
"Not planned" entries (E25-13, E29-11, E32-06, E34-09): features recorded so that nobody builds them.

## Next up

The highest-priority open issues, in the order suggested: first those needed before a pilot
with real data, then those that close the main known gaps.

| # | Issue | Why now |
|---|---|---|
| 1 | [E38-15](epics/E38-mobile-apps.md) VoiceOver and TalkBack users on the apps; iPhone checks of the security fixes | The internal accessibility and security reviews are done (wave 16); a person with an iPhone and a screen reader user remain |
| 2 | [E16-40](epics/E16-hosting-operations-and-hardening.md) Independent security review or penetration test | Before the application holds sensitive records; an internal review does not replace it |
| 3 | [E02-08](epics/E02-account-security.md) Passkeys and security keys | Checked with a virtual authenticator only; test hardware keys over real HTTPS before relying on them |
| 4 | [E37-08](epics/E37-asset-tags.md), [E38-05](epics/E38-mobile-apps.md) Reading tags on real phones | The camera reading is proven on an emulator; check a printed sheet on real iPhones and Android phones |
| 5 | [E38-13](epics/E38-mobile-apps.md), [E38-14](epics/E38-mobile-apps.md) Signed releases and push with real credentials | Needs the maintainer's Apple and Google accounts |
| 6 | [E16-15](epics/E16-hosting-operations-and-hardening.md) A walkthrough by a screen reader user | NVDA has been run through the main journeys by a script; no screen reader user has used the application |
| 7 | [E16-41](epics/E16-hosting-operations-and-hardening.md) Load test with the database on its own machine | Measured with the database in a limited container on the same laptop; search and the full-text list tuned for it (wave 15) |
| 8 | [E16-42](epics/E16-hosting-operations-and-hardening.md) Services across a restart of a real machine, and macOS | Proven across a restart of a systemd container |
| 9 | [E42-07](epics/E42-windows-installer.md) The Windows installer on a real Windows Server | Tested silently on a Windows 11 workstation; a restart and the install pages by hand remain |

## Known gaps coverage

Every line of `docs/known-gaps.md` maps to an issue: open, or done with the limit recorded there.
Keep this table in step with that file.

### Not built

| Gap | Issues |
|---|---|
| Not planned: drug and alcohol test results, hours of service and fatigue, maintenance work orders and inspection schedules, redaction of document content | E25-13, E29-11, E32-06, E34-09 (done as "Not planned") |

### Built but incomplete

| Gap | Issues |
|---|---|
| Passkeys not yet checked with hardware keys over HTTPS | E02-08 |
| Approval workflows and lifecycles: gates and disposal without a workflow; held status changes checked at approval | E14-32, E14-37 (done; the limits are recorded there) |
| Feature switches: the organization's own text stays; search matches hidden fields | E14-34 (done; the limits are recorded there) |
| Organization branding: imported WebP logos need a printable copy; one email logo for both themes | E14-36 (done; the limits are recorded there) |
| Retention: decisions do not run after-save hooks; broad personal fields | E14-33 (done; the limits are recorded there) |
| Backups cover the embedded database only; scheduled backups not proven on a real installation | E16-08 |
| The embedded database pauses briefly while a server backup takes its snapshot | E22-28 (done; the limit is recorded there) |
| Directory sign-in tried against a stand-in directory, not a real Active Directory | E02-26 (done; recorded there) |
| An existing installation keeps its second-factor setting | E02-05, E02-17 (done) |
| Default role changes reach an existing database only when applied | E18-21 (done) |
| PDF fonts and bidirectional embedding characters; exports stop at 50,000 rows; PDF column limit; CSV code pages | E12-16, E22-22, E22-24 (done; the limits are recorded there) |
| PDF/UA checked with pdf.js, not veraPDF; one document language | E41-13 (done; a veraPDF run by a person is recorded there) |
| The portal does not ask ticket custom fields | E15-14 (done) |
| JSON API responses are not compressed by the application | E22-32 (done; the limit is recorded there) |
| Contract import dates; a higher vendor risk tier or an expired check does not deactivate active contracts | E06-15, E41-10 (done; the limits are recorded there) |
| Wave 10 parts: inspection photos need `audits.edit`, finance left to the finance system, meeting decisions and kind-less workflows, meeting invitation replies not collected, ticket and training departments kept as text, monthly-only KRIs | E23, E24, E26, E27, E28, E29, E30, E41-01, E41-17 (done; the limits are recorded there) |
| Scoped roles not run on a PostgreSQL server or in the browser suite | E41-01 (done; the limit is recorded there) |
| Wave 11 parts: call-tree texts reach accounts only, links visible in the text delivery log, not tried with real gateways (E41-14); one useful-life benchmark per class; no OT network scanning, starter mappings not loaded, no history for zones below target, no OT badge in a saved map picture; working days skip weekends only; exclusion checks and offboarding by hand; no SCIM bulk or sorting, one collector per forwarder, read-only feeds, no product-specific work-tracker connections | E31, E32, E33, E34, E35, E36, E41-14 (done; the limits are recorded there) |
| The Overview cache is per process; module routes outside the generic save are not one transaction | E16-38, E40-03 (done; the limits are recorded there) |
| Help page tables always take a Tab stop and have a generic name | E22-48 (done; the limit is recorded there) |
| Least-privilege account queues custom fields for the owner; user services not proven across a restart or for the system examples | E16-37 (done; recorded there), E16-42 |
| Mobile app sign-in: a refresh repeated once within 30 seconds; a `prompt=login` sign-in covers sensitive actions for `auth.reauth_minutes` | E38-02 (done) |
| Asset tags: an inventory count's area restricts it to records with a location | E37-09 (done) |
| Mobile app testing: Maestro flows not in CI, iPhone builds not run on a device, iPhone ML Kit usage not measured, licenses list includes build-only packages | E38-01, E38-05, E38-15 |
| Push notifications not tried with real Apple, Google or UnifiedPush services | E38-14 |
| Mobile app offline: photos resent whole, offline lookups only within the package, proven on the emulator only, unsent work lost when signed out from the web | E38-10, E38-11, E38-12 (done) |
| Mobile app accessibility not tried by people (VoiceOver, a TalkBack user) | E38-15 |
| Mobile app security limits: expiry by the phone's clock, iPhone protection class and backup exclusion unchecked on a device, Android recents thumbnail, proprietary ML Kit and Firebase, build-tool audit advisories | E38-15 |
| Printed tags not yet read by real phones; signed releases | E37-08, E38-05, E38-13 |
| Load test with the database on its own machine and people in different roles | E16-41 |
| Operations: the audit archive as the owner from a scheduled task; secret rotation proven by unit tests only | E40-14 (done; the limits are recorded there) |
| Windows installer unsigned, not yet proven on a real Windows Server; only Windows has an installer | E42-07 |
| Installations made outside Program Files before wave 23 should be reinstalled, not upgraded | E42-08 (done; the limit is recorded there) |
| User access reviews: no connection to systems; account lists imported, removals done by people | E41-02 (done; the limit is recorded there) |
| Compliance calendar: records requests, plan reviews and condition assessments show only the viewer's own items | E41-03 (done; the limit is recorded there) |
| Confidential safety reporting cannot protect the report's own text or the identity from people who run the server | E41-05 (done; the limit is recorded there) |
| Certification: one certificate of readiness per project, no second-person verification, CSV source type kept, no mobile My work entry | E41-08 (done; the limits are recorded there) |
| Registers: workflows on a new register start after a restart; no calendar, My work or app entries; least-privilege accounts wait for `migrate` | E41-06 (done; the limits are recorded there) |
| Languages: English and Spanish only; staff screens and organization content in English; Spanish not reviewed by a native speaker | E41-07 (done; the limits are recorded there) |
| Outside reviewers read and download only; a few hand-written recipient lists read roles directly | E41-09, E18-68 (done; the limits are recorded there) |
| Hand-written module figure masks ignore department and site scope | E18-68 (done; the limit is recorded there) |
| Figures saved before wave 23 not re-checked; acknowledgments stamp the current translation; older acknowledgments record only the language | E41-04, E41-07, E18-68 (done; the limits are recorded there) |
| Search inside files: PDF, .docx and plain text only; previews of images and PDFs; retention items under Records requests in the calendar filter; the reader's memory cap is checked every 20 ms, fixed and not pooled | E41-15, E41-16, E18-68 (done; the limits are recorded there) |

### Verification status

| Gap | Issues |
|---|---|
| No walkthrough by a screen reader user | E16-15 |
| Email providers, SAML, directory sign-in, MCP OAuth and HTTPS webhooks tested against stand-ins only | E14-25, E02-10, E21-16, E13-08 (done; recorded there) |
| No independent security review or penetration test | E16-40 |
