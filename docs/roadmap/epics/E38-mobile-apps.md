# E38 Mobile apps for iPhone and Android

**Status:** open (0 of 15 issues done)

## Goal

Native apps for people who work away from a desk: see what is assigned to them, scan tags, report
problems and hazards with photos, run inspections and condition assessments, count inventory, decide
approvals, and keep working where there is no signal. The design is in
[the asset tags and mobile apps specification](../specs/asset-tags-and-mobile-apps.md) (§5, §7, §9, §10);
section numbers below refer to it.

## Scope notes

- React Native with Expo, TypeScript, in `mobile/`; API client generated from the OpenAPI description
  in `packages/api-client`. No paid build or analytics services.
- The apps do a focused set of field tasks; administration, report building and framework work stay
  on the web.
- Feature area **Mobile app** (off by default). Switched off, the OAuth client, device pages and mobile
  endpoints are gone and every device is signed out.
- Decisions 1 (publishing), 2 (push) and 4 (name and identifiers) in §9 are needed before E38-13 and
  E38-14; the rest can start now.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E38-01 | App foundations: project, API client, CI builds and tests | open | P1 |
| E38-02 | OAuth for mobile clients and device sessions | open | P1 |
| E38-03 | Connect to a server and sign in | open | P1 |
| E38-04 | My work | open | P1 |
| E38-05 | Scan and the scan card in the app | open | P1 |
| E38-06 | Report a problem or a hazard with photos | open | P1 |
| E38-07 | Search and record views | open | P2 |
| E38-08 | Approvals and acknowledgments | open | P2 |
| E38-09 | Notifications list and app settings | open | P2 |
| E38-10 | Offline packages, outbox and idempotent sync | open | P1 |
| E38-11 | Inspections and condition assessments offline | open | P1 |
| E38-12 | Inventory counts and reports offline | open | P2 |
| E38-13 | Guide, build instructions and store release | open | P1 |
| E38-14 | Push notifications (decision 2) | open | P3 |
| E38-15 | Accessibility and security review of the apps | open | P1 |

---

### E38-01 App foundations: project, API client, CI builds and tests

**Status:** open · **Priority:** P1 · **Type:** feature

A developer wants one app project for both platforms that builds and tests in continuous integration
without paid services.

**Acceptance criteria**

- [ ] `mobile/` Expo project in TypeScript with navigation, theming from the web design tokens (light and dark), and the screens' text in one file per screen
- [ ] `packages/api-client` generated from `GET /api/openapi.json`; a check in CI that it is up to date
- [ ] CI: typecheck, Jest and React Native Testing Library; Android build on Linux and iPhone build on macOS runners (unsigned); Maestro flows on emulators against a scratch server
- [ ] `docs/development.md` covers running the app against a local server; no dependency sends data anywhere

### E38-02 OAuth for mobile clients and device sessions

**Status:** open · **Priority:** P1 · **Type:** feature

A person wants to sign in to the app the same way as on the web, and to sign out a lost phone.

**Acceptance criteria**

- [ ] The AI-assistant OAuth server (E21) generalized to client kinds `assistant` and `mobile`; the built-in mobile client needs no administrator step and is off with the Mobile app area
- [ ] Short access tokens (15 minutes) and rotating refresh tokens bound to the installation; reuse of an old refresh token revokes the device; lifetimes are settings
- [ ] Account > Devices and the administrator's user page list devices and sign them out; deactivation and SCIM deprovisioning sign out every device
- [ ] Sensitive actions ask again through the browser (`prompt=login`, a recent sign-in claim)
- [ ] Apple and Android app-link files served from `/.well-known/` when the area is on
- [ ] Tests: token rotation and reuse detection, revocation paths, switched-off, the sensitive-action claim

### E38-03 Connect to a server and sign in

**Status:** open · **Priority:** P1 · **Type:** feature

A new user wants to point the app at their organization's server and sign in, in under a minute.

**Acceptance criteria**

- [ ] Server address typed or scanned from Account > Mobile app's connect code; version compatibility checked (§5.9); HTTPS only
- [ ] Sign-in in the system browser with PKCE; tokens only in the Keychain or Keystore
- [ ] Optional or required biometric or device-credential unlock after idle time
- [ ] Sign-out (and a failed refresh) wipes local data after warning about unsent work
- [ ] Maestro flow: connect, sign in with a password and second factor, sign out

### E38-04 My work

**Status:** open · **Priority:** P1 · **Type:** feature

A field employee wants one screen with everything waiting for them.

**Acceptance criteria**

- [ ] `GET /api/mobile/home`: tickets assigned, my actions, approvals waiting, inspections and condition assessments due, acknowledgments and training due, each with a count and the first few items, only for switched-on areas
- [ ] Pull to refresh; refresh on opening; badge from the last refresh
- [ ] Tests: the same figures as the web for the same person; switched-off areas absent

### E38-05 Scan and the scan card in the app

**Status:** open · **Priority:** P1 · **Type:** feature

A technician wants to scan a tag with the app and act on it.

**Acceptance criteria**

- [ ] Native camera scanning of QR and Code 128 on the device, torch, manual entry; tag addresses from the system camera open the app
- [ ] The scan card from `GET /api/tags/resolve` with the server's actions (E37-04, E37-06)
- [ ] Maestro flow with a test image: scan, see the card, add a photo

### E38-06 Report a problem or a hazard with photos

**Status:** open · **Priority:** P1 · **Type:** feature

An operator wants to report a defect or a close call quickly, from a scan or from scratch.

**Acceptance criteria**

- [ ] Report a problem (ticket) and report a hazard or close call (safety), with the record linked when started from a scan, location picked from sites, and several photos
- [ ] Photos resized on the device to the server's limits; uploads resume
- [ ] Works offline through the outbox once E38-10 is built
- [ ] Maestro flow: report with two photos; the ticket appears on the web

### E38-07 Search and record views

**Status:** open · **Priority:** P2 · **Type:** feature

A supervisor wants to look up a record and update it from the phone.

**Acceptance criteria**

- [ ] Search across what the person may see; recent items
- [ ] Phone layouts for assets, vehicles, sites, systems, tickets, actions, safety reports and inspections: summary, key fields, activity, comments, attachments
- [ ] Editing of `mobileEditable` fields with `If-Match` and a conflict screen; "Open on the web" when a form needs more (§5.4)
- [ ] Restricted records: screenshots blocked on Android, blank app-switcher image on iOS

### E38-08 Approvals and acknowledgments

**Status:** open · **Priority:** P2 · **Type:** feature

A manager wants to decide approvals and acknowledge policies away from the desk.

**Acceptance criteria**

- [ ] Waiting approvals with what is being approved; approve or reject with a reason; password confirmation when the step requires it
- [ ] Policy acknowledgments due, with the document readable in the app
- [ ] Tests: the engine's rules apply unchanged (distinct approvers, lost permission)

### E38-09 Notifications list and app settings

**Status:** open · **Priority:** P2 · **Type:** feature

A person wants to see their notifications in the app and manage the app's settings.

**Acceptance criteria**

- [ ] The in-app notification list, read state shared with the web
- [ ] Account screen: who and which server, devices, unlock settings, sign out, about and open-source licenses
- [ ] Administration settings for the Mobile app area (token lifetimes, required unlock, offline expiry) documented

### E38-10 Offline packages, outbox and idempotent sync

**Status:** open · **Priority:** P1 · **Type:** feature

An inspector wants to work all day without signal and have everything arrive once when back online.

**Acceptance criteria**

- [ ] `GET /api/mobile/package` with the person's upcoming work and the lookup table for it; expiry (default 7 days)
- [ ] On-device SQLite in protected storage; photos as files; nothing outside the package available offline
- [ ] Outbox sent in order with client UUIDs and `Idempotency-Key`; `idempotency_keys` kept 7 days on the server; `POST /api/mobile/sync` answers each item separately
- [ ] Rejected items kept in "Needs attention" with the server's reason; nothing dropped silently
- [ ] Tests: the same batch sent twice creates nothing twice; a revoked device's sync is refused; Maestro flow in airplane mode

### E38-11 Inspections and condition assessments offline

**Status:** open · **Priority:** P1 · **Type:** feature

An inspector wants to run checklists and record condition on site with no signal.

**Acceptance criteria**

- [ ] Inspection runner in the app: pass, fail or not applicable per item, notes, photos, findings, signature of completion; the same rules as the web runner (E24-06)
- [ ] Condition assessments for vehicles, assets and sites (E32-02)
- [ ] Completed offline and synced; a cancelled inspection or a removed permission goes to "Needs attention"
- [ ] Maestro flow: complete an inspection offline, sync, see it on the web

### E38-12 Inventory counts and reports offline

**Status:** open · **Priority:** P2 · **Type:** feature

An asset manager wants to count a depot with no signal.

**Acceptance criteria**

- [ ] Join an open count; continuous scanning offline against the package; found and unexpected shown as they happen
- [ ] Problem and hazard reports offline through the outbox
- [ ] Synced scans merge with other counters' scans; tests

### E38-13 Guide, build instructions and store release

**Status:** open · **Priority:** P1 · **Type:** docs

Organizations want to install the app, or build their own, and their people want to know how to use it.

**Acceptance criteria**

- [ ] User guide page "The mobile app": connecting, signing in, each screen, offline work, lost phones
- [ ] `docs/mobile.md`: building and signing for both platforms, own name and icon, device-management distribution, app-link files, push credentials (once E38-14)
- [ ] Release as decided (§9, decision 1): store listings with privacy details (no data collected by the publisher), or source-only release notes
- [ ] The app's version range in `GET /api/version`; release checklist in `docs/operations.md`

### E38-14 Push notifications (decision 2)

**Status:** open · **Priority:** P3 · **Type:** feature

A person wants to be told on the phone when something needs them.

**Acceptance criteria**

- [ ] As decided in §9 (per-organization credentials, a relay, or UnifiedPush); content never includes record details, only "you have N new notifications"
- [ ] Per-person notification choices apply to push as to email
- [ ] Tests with fake push services; delivery claimed so overlapping runs send once

### E38-15 Accessibility and security review of the apps

**Status:** open · **Priority:** P1 · **Type:** debt

Everyone wants the apps to be usable with assistive technology and safe to put on work phones.

**Acceptance criteria**

- [ ] VoiceOver and TalkBack walkthrough of every screen; Dynamic Type and font scaling to 200%; no gesture-only action
- [ ] Security checks of §5.7 tested (no outside data, no user certificate authorities on Android, local data wiped on revocation, offline expiry)
- [ ] The apps and their endpoints included in the independent review (E16-40); threat model in `docs/security.md`
