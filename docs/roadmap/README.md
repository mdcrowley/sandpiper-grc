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

## How it is organised

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
| **Status** | `done`, `in progress`, `open` | `done`: every acceptance criterion that matters is met and tested. `in progress`: someone is working on it now. `open`: not started |
| **Priority** | `P1`, `P2`, `P3` | `P1`: must have before a pilot. `P2`: should have. `P3`: later |
| **Type** | `feature`, `improvement`, `bug`, `debt`, `docs` | `feature`: something new. `improvement`: makes an existing feature better. `bug`: something is wrong. `debt`: internal work users do not see. `docs`: documentation only |
| Description | one paragraph | Written from the user's point of view |
| **Acceptance criteria** | checklist | `- [x]` met, `- [ ]` not met |
| **Implemented in** | files and endpoints | Required once an issue is `done` |

A `done` issue may still show an unticked criterion when a later improvement is tracked
by another issue; the unticked line names that issue.

An epic's status is `done` when all its issues are done, `open` when none are started,
and `in progress` otherwise.

## Rules

1. **Every code change updates the tracker in the same change.** If a commit adds,
   changes or removes behaviour, the same commit edits the affected issue (status,
   ticked criteria, "Implemented in") and its epic (the issues table, and the epic's
   status if it changed), and the counts in the table below. A change with no issue
   gets one first.
2. **`docs/known-gaps.md` is updated in the same change too.** Closing an issue that
   came from a known gap removes or rewords that gap. Finding a new gap adds a line
   there and an issue here.
3. **Status must be true.** Do not mark an issue `done` unless it is built, has a test,
   and you have confirmed it. If you cannot confirm it, it is `open`.
4. **Keep issues small.** If an issue cannot be finished in one sitting, split it into
   new issues with new IDs and say so in the original.
5. **Nothing organisation-specific.** No real organisation, person, place, law,
   regulator or vendor names in any issue, as in the rest of the repository.
6. Plain English and British spelling.

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

1. Tick the acceptance criteria that are met. Anything deliberately left out becomes a
   new issue, and the unticked line names it.
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
  renders `- [ ]` as tick boxes) and, for done issues, the "Implemented in" line.
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

Counts as at the creation of this tracker. "Done / total" counts issues with status
`done`; issues in progress are counted in the total only.

| ID | Epic | Status | Done / total |
|---|---|---|---|
| [E01](epics/E01-platform-foundations.md) | Platform foundations | in progress | 26 / 31 |
| [E02](epics/E02-account-security.md) | Account security | in progress | 7 / 17 |
| [E03](epics/E03-service-desk.md) | Service desk | in progress | 10 / 17 |
| [E04](epics/E04-inventory-and-relationship-map.md) | Inventory and relationship map | in progress | 11 / 13 |
| [E05](epics/E05-change-enablement.md) | Change enablement | in progress | 7 / 11 |
| [E06](epics/E06-vendors-and-contracts.md) | Vendors and contracts | in progress | 11 / 17 |
| [E07](epics/E07-framework-outcomes-and-assessments.md) | Framework outcomes and assessments | in progress | 11 / 14 |
| [E08](epics/E08-risks-actions-and-obligations.md) | Risks, actions and obligations | in progress | 13 / 17 |
| [E09](epics/E09-security-incidents-and-notification-clocks.md) | Security incidents and notification clocks | in progress | 15 / 17 |
| [E10](epics/E10-policies-training-exceptions-exercises-vulnerabilities.md) | Policies, training, exceptions, exercises and vulnerabilities | in progress | 6 / 15 |
| [E11](epics/E11-projects-and-portfolio.md) | Projects and portfolio | in progress | 13 / 17 |
| [E12](epics/E12-dashboards-and-reporting.md) | Dashboards and reporting | in progress | 2 / 8 |
| [E13](epics/E13-imports-api-integrations.md) | Imports, API and integrations | in progress | 3 / 7 |
| [E14](epics/E14-platform-services.md) | Platform services | in progress | 2 / 18 |
| [E15](epics/E15-self-service-portal.md) | Self-service portal | in progress | 1 / 8 |
| [E16](epics/E16-hosting-operations-and-hardening.md) | Hosting, operations and hardening | in progress | 10 / 25 |
| [E17](epics/E17-documentation.md) | Documentation | in progress | 6 / 13 |
| [E18](epics/E18-quality-and-known-defects.md) | Quality and known defects | in progress | 14 / 33 |
| | **Total** | | **168 / 298** |

Of the 130 issues not done, 13 are in progress and 117 are open.

## Next up

The highest-priority open issues, in the order suggested. The first two should be done
before the repository is published; the rest before a pilot with real data.

| # | Issue | Why now |
|---|---|---|
| 1 | [E18-13](epics/E18-quality-and-known-defects.md) Remove sector-specific wording left in built-in text | The hard rule is "nothing organisation-specific in the repository", and publication makes any leftover permanent |
| 2 | [E17-13](epics/E17-documentation.md) Licence, contributing guide and security policy | A public repository with no licence cannot legally be used, and there is nowhere to report a vulnerability |
| 3 | [E08-16](epics/E08-risks-actions-and-obligations.md) Hide actions that come from a restricted risk | A confidentiality leak: restricted risk detail is visible to anyone who can see actions |
| 4 | [E02-05](epics/E02-account-security.md) Enforce the second factor | Administrators and security leads are "required" to use one, but nothing stops them not doing so |
| 5 | [E02-06](epics/E02-account-security.md) Replay protection for authenticator codes | Small change that closes a real weakness in the second factor; do it together with E02-05 |
| 6 | [E18-07](epics/E18-quality-and-known-defects.md) Check non-administrator roles in the browser | Pilot users will not be administrators, and no screen has been tried as anyone else |
| 7 | [E18-08](epics/E18-quality-and-known-defects.md) Check that every form can be submitted in the browser | Screens were loaded but nothing was saved through them; a pilot is mostly saving |
| 8 | [E03-12](epics/E03-service-desk.md) Screen for targets, calendars and holidays (with [E03-11](epics/E03-service-desk.md)) | Service-level clocks are meaningless until each organisation sets its own hours and targets, and that needs the API today |
| 9 | [E18-03](epics/E18-quality-and-known-defects.md) Proofread NIST CSF 2.0 outcome text | Assessments quote this text; it was written from memory and is known to be suspect in places |
| 10 | [E16-12](epics/E16-hosting-operations-and-hardening.md) Continuous integration | 205 tests exist but nothing runs them automatically; needed as soon as there is a remote |
| 11 | [E16-09](epics/E16-hosting-operations-and-hardening.md) Restore command (with [E16-08](epics/E16-hosting-operations-and-hardening.md) scheduled backups) | A backup that has never been restored is not a backup; real data must not go in before this |
| 12 | [E14-01](epics/E14-platform-services.md) Attachments on any record | Evidence, contracts and gate documents are text-only until this exists; five other issues wait on it |

After these: HTTPS and the secure cookie ([E16-07](epics/E16-hosting-operations-and-hardening.md),
[E02-14](epics/E02-account-security.md)) and a PostgreSQL server
([E16-05](epics/E16-hosting-operations-and-hardening.md)) before anyone uses the
application from another machine, then in-app notifications
([E14-03](epics/E14-platform-services.md)), which unblock reminders and alerts across
five epics.

## Known gaps coverage

Every line of `docs/known-gaps.md` maps to at least one open issue. Keep this table in
step with that file.

### Not built

| Gap | Issues |
|---|---|
| Change enablement | E05-01 to E05-07 |
| Policies and acknowledgements | E10-01, E10-02 |
| Training | E10-03 |
| Exceptions | E10-04 |
| Exercises | E10-05 |
| Vulnerabilities and scanner findings import | E10-06, E10-07, E10-08 |
| User-built dashboards | E12-03 |
| Report builder | E12-04 |
| Scheduled delivery | E12-05 |
| Report packs | E12-06 |
| No XLSX import | E13-04 |
| No personal access tokens | E02-12 |
| No OpenAPI document | E13-05 |
| No webhooks | E13-06 |
| No OpenID Connect or SAML single sign-on | E02-09, E02-10 |
| No account linking | E02-11 |
| No WebAuthn or passkeys | E02-08 |
| No break-glass account | E02-13 |
| No attachments | E14-01 (and E06-17, E07-12, E11-17) |
| No custom fields | E14-02 |
| No notifications, in-app or email | E14-03, E14-04 |
| No tags | E14-08 |
| No watchers | E14-09 |
| No bulk edit | E14-10 |
| No XLSX export | E01-25 |
| No general workflow engine | E14-06 |
| Search is substring matching, not full-text | E14-07 |
| Self-service portal | E15-02 to E15-05, E15-07 |
| Email-to-ticket | E15-06 |
| Not a PostgreSQL server | E16-05 |
| Not in containers | E16-06 |
| No HTTPS | E16-07, E02-14 |
| No scheduled backup | E16-08 |
| No `restore` command | E16-09 |
| No `upgrade` command | E16-10 |
| No `export-all` or `import-all` commands | E16-11 |
| No continuous integration | E16-12 |
| No administrator guide, user guide or operations runbook | E17-08, E17-10, E17-11 (in progress) |

### Built but incomplete

| Gap | Issues |
|---|---|
| Second factor is a notice only, not enforced | E02-05 |
| No replay protection | E02-06 |
| Secrets are not field-encrypted | E02-07 |
| No re-authentication before administrative actions | E01-21 |
| Rate limiters are in memory | E01-22 |
| Setup and reset links are shown to the administrator (no email) | E14-05 |
| Priority matrix editable by API only | E03-11 |
| SLA targets, calendars and holidays editable by API only | E03-12, E03-17 |
| No warning or breach notifications | E03-13 |
| No escalation rules | E03-14 |
| Catalogue items only pre-fill a ticket | E03-15 |
| "Agents only" article audience is not enforced | E03-16 |
| Disposal approval is a recorded name and date, not a routed approval | E04-12 |
| Contract import fills dates only where unambiguous | E06-15 |
| Reminders are audit events and calendar state only | E06-12 |
| No vendor assessment questionnaire | E06-13 |
| Value by year is raw JSON | E06-14 |
| NIST CSF 2.0 outcome text must be proofread | E18-03 |
| Framework evidence is text only | E07-12 |
| No screen for editing risk scales | E08-13 |
| Acceptances cannot be revoked | E08-14 |
| Acceptance expiry does not change status | E08-15 |
| Action titles linked to a restricted risk are visible | E08-16 |
| Offline kit prints from the browser (no scheduled PDF) | E09-16 |
| Lookup list names and labels visible to all through `/api/meta` | E01-23 |
| Required documents do not block a gate | E11-14 |
| No stage rollback | E11-15 |
| Intake needs `projects.create` | E11-16 |
| No retention settings or review flags | E14-11 |

### Verification status

| Gap | Issues |
|---|---|
| Dark theme not exercised | E18-04 |
| Tablet width not exercised | E18-05 |
| Keyboard-only use not exercised | E18-06 |
| Forms being submitted not exercised | E18-08 |
| Non-administrator roles not exercised | E18-07 |
| No accessibility audit | E16-15 |
| Two pages scroll horizontally at 1440px | E18-01, E18-02 |
| No load testing | E16-14 |

### Found while reading the code (not yet in `docs/known-gaps.md`)

| Finding | Issues |
|---|---|
| Sector-specific wording remains in a few built-in texts | E18-13 |
| No licence, contributing guide or security policy | E17-13 |
| Session cookie is not marked secure | E02-14 |
| Saved views are kept in the browser only | E01-24 |
| Calendars can be edited but not added or removed | E03-17 |
| An asset's department is free text, not the department list | E04-13 |
| No screen for contract reminder thresholds | E06-16 |
| Framework structure is editable by API only | E07-13 |
| Expiring-acceptances endpoint has no screen | E08-15 |
| `dashboards`, `reports` and `portal` permissions are granted to roles but checked nowhere | E12-07, E15-02 |
| `portal` is missing from the documented permission keys | E15-08 |
| Background work runs on in-process timers | E14-12 |
| Request logging is off and the log file never rotates | E16-16 |
| The "also satisfies" parser splits names containing numbers | E18-09 |
| No tests for the web code | E18-14 |
