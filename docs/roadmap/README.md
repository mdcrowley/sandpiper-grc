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
| [E16](epics/E16-hosting-operations-and-hardening.md) | Hosting, operations and hardening | in progress | 33 / 38 |
| [E17](epics/E17-documentation.md) | Documentation | in progress | 11 / 14 |
| [E18](epics/E18-quality-and-known-defects.md) | Quality and known defects | done | 59 / 59 |
| [E19](epics/E19-fleet-and-services.md) | Fleet and services | done | 14 / 14 |
| [E20](epics/E20-safety-management.md) | Safety management | done | 15 / 15 |
| [E21](epics/E21-mcp-server.md) | MCP server (AI assistant access) | done | 23 / 23 |
| [E22](epics/E22-review-fixes.md) | Review fixes (wave 9) | in progress | 40 / 45 |
| [E23](epics/E23-corrective-action-plans.md) | Corrective action plans and verification | open | 0 / 11 |
| [E24](epics/E24-audits-and-inspections.md) | Audits and inspections | open | 0 / 13 |
| [E25](epics/E25-safety-reporting-investigation-and-targets.md) | Safety reporting, investigation and performance targets | open | 1 / 14 |
| [E26](epics/E26-control-library-and-testing.md) | Control library and control testing | open | 0 / 10 |
| [E27](epics/E27-funding-and-grant-compliance.md) | Funding and grant compliance | open | 0 / 11 |
| [E28](epics/E28-committees-meetings-and-safety-plan.md) | Committees, meetings and the safety plan | open | 0 / 11 |
| [E29](epics/E29-staff-roster-qualifications-and-acknowledgments.md) | Staff roster, qualifications and frontline acknowledgments | open | 1 / 12 |
| [E30](epics/E30-obligations-regulatory-change-and-enterprise-risk.md) | Obligations, regulatory change and enterprise risk | open | 0 / 9 |
| [E31](epics/E31-business-continuity.md) | Business continuity and emergency management | open | 0 / 6 |
| [E32](epics/E32-asset-condition-and-state-of-good-repair.md) | Asset condition and state of good repair | open | 1 / 6 |
| [E33](epics/E33-ot-and-rail-systems-cybersecurity.md) | OT and rail-systems cybersecurity | open | 0 / 4 |
| [E34](epics/E34-legal-hold-records-requests-and-privacy.md) | Legal hold, records requests and privacy | open | 0 / 5 |
| [E35](epics/E35-vendor-risk-lifecycle.md) | Vendor risk lifecycle | open | 0 / 5 |
| [E36](epics/E36-integrations.md) | Integrations | open | 0 / 6 |
| | **Total** | | **553 / 687** |

Of the 134 issues not done, 6 are in progress and 128 are open or blocked. E23 to E30 are wave 10 and
E31 to E36 are planned for wave 11 (the product gaps of the November 2026 review). Their done issues
are "Not planned" entries (E25-13, E29-11, E32-06): features recorded so that nobody builds them.

## Next up

The highest-priority open issues, in the order suggested: first those needed before a pilot
with real data, then those that close the main known gaps.

| # | Issue | Why now |
|---|---|---|
| 1 | [E02-08](epics/E02-account-security.md) Passkeys and security keys | Checked with a virtual authenticator only; test hardware keys over real HTTPS before relying on them |
| 2 | [E16-08](epics/E16-hosting-operations-and-hardening.md) Scheduled backups | Backups are built; a scheduled, off-machine run needs proving on a real installation |
| 3 | [E16-40](epics/E16-hosting-operations-and-hardening.md) Independent security review or penetration test | Before the application holds sensitive records |
| 4 | [E16-15](epics/E16-hosting-operations-and-hardening.md) A screen-reader walkthrough | The automated audit is clean; no one has used the application with a screen reader |
| 5 | [E16-41](epics/E16-hosting-operations-and-hardening.md) Load test with the database on its own machine | The PostgreSQL figures so far come from a server on the same laptop |
| 6 | [E17-08](epics/E17-documentation.md) User guide | The approval workflow, lifecycle and Organization pages changed in wave 8 and need a review against the application |
| 7 | [E17-11](epics/E17-documentation.md) Operations runbook | Restore has been tried by the tests only; try it by hand once |
| 8 | [E16-42](epics/E16-hosting-operations-and-hardening.md) User services across a restart, and the system examples | Proven on GitHub's runners; a restart and the deploy/ examples need a real machine |

## Known gaps coverage

Every line of `docs/known-gaps.md` maps to an issue: open, or done with the limit recorded there.
Keep this table in step with that file.

### Not built

| Gap | Issues |
|---|---|
| Wave 10 parts: corrective action plans, audits and inspections, safety event depth and targets, controls, funding, committees, staff roster, recurring obligations and enterprise risk | E23 to E30 |
| Wave 11 parts: continuity, asset condition, OT security, legal hold and privacy, vendor lifecycle, integrations | E31 to E36 |
| Not planned: drug and alcohol test results, hours of service and fatigue, maintenance work orders | E25-13, E29-11, E32-06 (done as "Not planned") |

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
| Single sign-on per-address limit checked before and recorded after an attempt | E22-43 |
| An existing installation keeps its second-factor setting | E02-05, E02-17 (done) |
| Default role changes reach an existing database only when applied | E18-21 (done) |
| PDF fonts and bidirectional embedding characters; exports stop at 50,000 rows; PDF column limit; CSV code pages | E12-16, E22-22, E22-24 (done; the limits are recorded there) |
| The portal does not ask ticket custom fields | E15-14 (done) |
| JSON API responses are not compressed by the application | E22-32 (done; the limit is recorded there) |
| Webhook addresses stored in clear | E22-45 |
| Hand-written dialogs without the unsaved-changes guard | E22-14 |
| Contract import dates | E06-15 (done) |
| The If-Match lock and the Overview cache are per process | E13-12, E16-38 (done; the limits are recorded there) |
| Least-privilege account queues custom fields for the owner; user services not proven across a restart or for the system examples | E16-37 (done; recorded there), E16-42 |
| Load test with the database on its own machine and people in different roles | E16-41 |

### Verification status

| Gap | Issues |
|---|---|
| No screen-reader walkthrough | E16-15 |
| Email providers, SAML, directory sign-in, MCP OAuth and HTTPS webhooks tested against stand-ins only | E14-25, E02-10, E21-16, E13-08 (done; recorded there) |
| No independent security review or penetration test | E16-40 |
