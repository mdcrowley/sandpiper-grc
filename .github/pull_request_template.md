## What this changes

<!-- One or two sentences. Name the roadmap issue(s), for example E16-09. -->

## How it was checked

<!-- Tests added or changed; what you looked at in the browser (light and dark, wide and narrow). -->

## Checklist

A change is not finished until every place that describes it is updated in the same
piece of work (see the hard rules in `docs/development.md`).

**Code**

- [ ] Every data change writes an audit event
- [ ] Every new feature has a test; `.\grc.ps1 ci` (typecheck, tests and web build) passes
- [ ] Nothing organization-specific: no real organization, person, place, vendor or product names, no law or regulator of one jurisdiction as a built-in default, invented data only in samples and tests
- [ ] Nothing from `seed/` is committed, logged or pasted anywhere
- [ ] No calls to outside services from application code; no telemetry, no externally hosted fonts or scripts
- [ ] Statuses, priorities, categories and scales are configuration (rows in lookups or settings), not constants
- [ ] Plain English and British spelling in the interface

**Documentation and roadmap updated**

- [ ] `docs/user/*.md` (the user guide, also shown in the application under Help)
- [ ] `docs/installation.md`, `docs/operations.md`, `docs/architecture.md`, `docs/security.md` and the index `docs/README.md`, where they describe what changed
- [ ] `docs/known-gaps.md`: gaps closed are removed or reworded, new gaps are added
- [ ] `docs/roadmap/`: the issue is marked done with its acceptance criteria ticked and an "Implemented in" line; new issues are added for anything left out or newly found; the epic table and the summary in `docs/roadmap/README.md` agree
- [ ] `README.md`, if what the product does or how to run it changed
- [ ] `docs/development.md`, if structure, commands or conventions changed
- [ ] Not applicable: this change alters no behavior, structure or command (say why above)
