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
| [E18](epics/E18-quality-and-known-defects.md) | Quality and known defects | in progress | 64 / 65 |
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
| | **Total** | | **734 / 745** |

Of the 11 issues not done, 5 are in the epics E37 (asset tags) and E38 (mobile apps), specified in
[the asset tags and mobile apps specification](specs/asset-tags-and-mobile-apps.md): the online app
was built in wave 13, offline reports, push notifications and the Maestro flows in wave 14, and
offline inspections, condition assessments and counts (E38-11, E38-12) and the Android UnifiedPush
connector in wave 15, and the apps' internal accessibility and security review (E38-15) in wave 16; checks on real phones and signed
releases need a person. Of the other 6, E18-65 (interface items left from the wave 17 review) can
be built here; the rest need a person or a real machine (E02-08, E16-15, E16-40, E16-41, E16-42). E23 to E30 were built in wave 10 and E31 to E36 in wave 11 (the product gaps of the
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
| 9 | [E18-65](epics/E18-quality-and-known-defects.md) Hand-written tables, the Create menu filter and the remaining interface items | Left from the wave 17 interface review; nothing is broken |

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
| The portal does not ask ticket custom fields | E15-14 (done) |
| JSON API responses are not compressed by the application | E22-32 (done; the limit is recorded there) |
| Contract import dates | E06-15 (done) |
| Wave 10 parts: evidence answers in text, no coverage import or per-control test steps, finance left to the finance system, meeting decisions and kind-less workflows, no emailed calendar invitations, departments not a record type, monthly-only KRIs | E23, E24, E26, E27, E28, E29, E30 (done; the limits are recorded there), E36-03 |
| Wave 11 parts: printed call trees; one useful-life benchmark per class; no OT network scanning, starter mappings not loaded, no history for zones below target, no OT badge in a saved map picture; working days skip weekends only; exclusion checks and offboarding by hand; no SCIM bulk or sorting, one collector per forwarder, read-only feeds, no product-specific work-tracker connections | E31, E32, E33, E34, E35, E36 (done; the limits are recorded there) |
| The If-Match lock and the Overview cache are per process | E13-12, E16-38 (done; the limits are recorded there) |
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
| Sample data marked two ways; relationship map lines over group headings | E18-65 |
| Load test with the database on its own machine and people in different roles | E16-41 |

### Verification status

| Gap | Issues |
|---|---|
| No walkthrough by a screen reader user | E16-15 |
| Email providers, SAML, directory sign-in, MCP OAuth and HTTPS webhooks tested against stand-ins only | E14-25, E02-10, E21-16, E13-08 (done; recorded there) |
| No independent security review or penetration test | E16-40 |
