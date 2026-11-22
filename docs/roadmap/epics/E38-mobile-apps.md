# E38 Mobile apps for iPhone and Android

**Status:** in progress (4 of 15 issues done)

## Goal

Native apps for people who work away from a desk: see what is assigned to them, point the camera at an
asset tag (whatever it carries: printed digits or letters, a barcode, a QR or Data Matrix code) to act on
the thing it is stuck to, report
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
- Beta distribution only for now: TestFlight on iPhone and a signed APK installed directly on Android
  (§5.10); no store release. Decisions 1 (developer membership and signing key) and 4 (name and
  identifiers) in §9 are needed before the first beta; decision 2 (Android text recognition) before E38-05.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E38-01 | App foundations: project, API client, CI builds and tests | in progress | P1 |
| E38-02 | OAuth for mobile clients and device sessions | done | P1 |
| E38-03 | Connect to a server and sign in | in progress | P1 |
| E38-04 | My work | in progress | P1 |
| E38-05 | Read a tag with the camera and the tag card | in progress | P1 |
| E38-06 | Report a problem or a hazard with photos | in progress | P1 |
| E38-07 | Search and record views | done | P2 |
| E38-08 | Approvals and acknowledgments | done | P2 |
| E38-09 | Notifications list and app settings | done | P2 |
| E38-10 | Offline packages, outbox and idempotent sync | open | P1 |
| E38-11 | Inspections and condition assessments offline | open | P1 |
| E38-12 | Inventory counts and reports offline | open | P2 |
| E38-13 | Guide, build instructions and beta distribution | in progress | P1 |
| E38-14 | Push notifications | open | P3 |
| E38-15 | Accessibility and security review of the apps | open | P1 |

---

### E38-01 App foundations: project, API client, CI builds and tests

**Status:** in progress (wave 13; Maestro flows remain) · **Priority:** P1 · **Type:** feature

A developer wants one app project for both platforms that builds and tests in continuous integration
without paid services.

**Acceptance criteria**

- [x] `mobile/` Expo project in TypeScript with navigation, theming from the web design tokens (light and dark), and the screens' text in one file per screen (`mobile/src/text/`)
- [x] `packages/api-client` generated from `GET /api/openapi.json`; a check in CI that it is up to date
- [x] CI: typecheck, Jest and React Native Testing Library; Android build on Linux and iPhone build on macOS runners (unsigned)
- [ ] Maestro flows on emulators against a scratch server (not started; the flows were checked by hand on the Android emulator in wave 13)
- [x] `docs/development.md` (and `docs/mobile.md`) cover running the app against a local server; no dependency sends data anywhere (Expo telemetry off, Android `--no-metrics`, ML Kit's data transport removed on Android; iPhone not yet measured, see `docs/mobile.md`)

**Implemented in:** `mobile/` (Expo SDK 58: `app.json`, config plugins `mobile/plugins/withUnsignedRelease.js`, `withNativeBuildDir.js`, `withoutDataTransport.js`; `src/theme`, `src/ui`, `src/text`; `scripts/licenses.js`), `packages/api-client/` (`generate.ts`, `include.json`, generated `src/schema.ts`, `src/index.ts`), the `mobile` job in `.github/workflows/ci.yml` (API client check, typecheck, Jest, unsigned Android release APK artifact on Linux, unsigned iPhone simulator and device builds on macOS), `tools/install-android-tools.ps1` and `.sh` (portable JDK 17 and Android SDK, checksums checked, `--no-metrics`), `docs/mobile.md`. Verified: Android debug build with Gradle on Windows, run on the `sandpiper-test` emulator against a scratch server.

### E38-02 OAuth for mobile clients and device sessions

**Status:** done (wave 13) · **Priority:** P1 · **Type:** feature

A person wants to sign in to the app the same way as on the web, and to sign out a lost phone.

**Acceptance criteria**

- [x] The AI-assistant OAuth server (E21) generalized to client kinds `assistant` and `mobile`; the built-in mobile client needs no administrator step and is off with the Mobile app area
- [x] Short access tokens (15 minutes) and rotating refresh tokens bound to the installation; reuse of an old refresh token revokes the device; lifetimes are settings
- [x] Account > Devices and the administrator's user page list devices and sign them out; deactivation and SCIM deprovisioning sign out every device
- [x] Sensitive actions ask again through the browser (`prompt=login`, a recent sign-in claim)
- [x] The app's own redirect scheme registered for the mobile client; no other redirect accepted
- [x] Tests: token rotation and reuse detection, revocation paths, switched-off, the sensitive-action claim

**Implemented in:** `server/src/modules/mcp/oauth.ts` (client kinds: `defineOAuthClientKind`, `clientKindOf`; `/oauth/token` and
`/oauth/revoke` hand the app's client over before any assistant rule), `server/src/modules/mobile/` (`signin.ts`: the `mobile`
kind, the sign-in page's API `/api/mobile/oauth/authorize` and `/decision`, the `grc_mat_` bearer resolver; `devices.ts`;
`state.ts`; migration `001_mobile.sql`: `mobile_devices`, `mobile_codes`, `mobile_tokens`), core `tokens.ts`
(`BearerResolution.confirmedAt`, `tokenConfirmedAt`; `revokeProgramAccess` also signs out mobile devices) and `auth.ts`
(`requireRecentAuth` honors the claim for `auth.reauth_minutes`), `ops/export.ts` (codes and tokens left out of exports without
secrets), web `modules/mobile/SignIn.tsx` (the sign-in page at `/oauth/authorize`, opened from `mcp/ConsentPage.tsx` for the
app's client), `Devices.tsx` (Account > Devices), `UserCard.tsx` (the administrator's card). Tests:
`server/src/modules/mobile/mobile.test.ts`. Notes: a device is one installation per person (signing in again, also with
`prompt=login`, keeps its id and ends its earlier tokens); switching the area off, an administrator's "Disable" and deactivation
all keep the device signed out when switched or enabled again; codes and tokens are SHA-256 only.

### E38-03 Connect to a server and sign in

**Status:** in progress (wave 13; the Maestro flow remains) · **Priority:** P1 · **Type:** feature

A new user wants to point the app at their organization's server and sign in, in under a minute.

**Acceptance criteria**

- [x] Server address typed and remembered; version compatibility checked (§5.9); HTTPS only (plain HTTP in development builds only)
- [x] Sign-in in the system browser with PKCE; tokens only in the Keychain or Keystore
- [x] Optional or required biometric or device-credential unlock after idle time
- [x] Sign-out (and a failed refresh) wipes local data after warning about unsent work (the warning counts what the outbox registers; the outbox arrives with E38-10)
- [ ] Maestro flow: connect, sign in with a password and second factor, sign out (done by hand on the Android emulator: connect, password and second factor, consent, My work, revocation from the web wiping the app, sign out, device-PIN unlock)

**Implemented in:** `mobile/src/auth/` (`server.ts` address and `GET /api/mobile/hello` check, `oauth.ts` PKCE S256, authorization address, redirect, code exchange, refresh, revocation; `session.ts` the session store: one refresh in flight, a newer pair kept when an older refresh is refused, one prompt retry after a network loss, wipe on a refused refresh, `confirmIdentity` with `prompt=login`, `onWipe` and `registerUnsentWork` hooks; `storage.ts` expo-secure-store only; `unlock.ts` and `LockScreen.tsx` with expo-local-authentication), `mobile/src/api/client.ts` (`apiFetch`, `apiUpload`, `useSession`, `confirmIdentity`), `mobile/app/(auth)/connect.tsx`, `mobile/app/_layout.tsx` (routing by session, lock), `mobile/app/+native-intent.tsx` (the sign-in redirect is not a screen). Tests: `mobile/src/auth/*.test.ts`, `mobile/src/api/client.test.ts`.

### E38-04 My work

**Status:** in progress · **Priority:** P1 · **Type:** feature

A field employee wants one screen with everything waiting for them.

**Acceptance criteria**

- [x] `GET /api/mobile/home`: tickets assigned, my actions, approvals waiting, inspections and condition assessments due, acknowledgments and training due, each with a count and the first few items, only for switched-on areas
- [x] Pull to refresh (and a Refresh button, so no gesture is needed); refresh on opening the tab and on returning to the app; badge from the last refresh
- [x] Tests: the same figures as the web for the same person; switched-off areas absent (`server/src/modules/mobile/mobile.test.ts`: tickets, actions, approvals, training and unread counts against the web's own routes, the same answer for the app's token and a browser session, the service desk and asset tags switched off)
- [x] App tests: sections, counts and items as the server gives them; switched-off areas absent; where each item opens (record view, approval, policy, or the web); refresh and badge; light and dark

**Implemented in (app):** `mobile/src/records/screens/WorkScreen.tsx` (route `mobile/app/(tabs)/work/index.tsx`), `mobile/src/records/navigate.ts`, `hooks.ts`; tests `mobile/src/records/tests/WorkScreen.test.tsx`. The server side (`GET /api/mobile/home`) is MOBILE-SERVER's part of this issue.

**Implemented in (server):** `server/src/modules/mobile/home.ts`: each section asks the application's own list routes in-process
with the caller's credential (the Overview's My tickets and My actions filters, the Approvals page, the inspection list filtered to
the inspector, the condition calendar source `condition.assessments_due` up to 30 days ahead, `/api/policies/acknowledgments/mine`,
`/api/training/mine`), so counts, permissions and restrictions are the web's; a section whose routes are switched off or refused is
left out. Approval items are `workflow_step` (the step id) and acknowledgment items `policy_acknowledgment` (the request id).

### E38-05 Read a tag with the camera and the tag card

**Status:** in progress (built; the test set passes 57 of 58 through the real readers on the Android emulator; the live camera on real phones and the Maestro flow are left) · **Priority:** P1 · **Type:** feature

A technician wants to point the phone at any asset tag, whatever it carries, and act on the thing it is
stuck to, without choosing between "scan a barcode" and "read a number".

**Acceptance criteria**

- [x] One camera screen reads every code type in §5.1 (QR, Data Matrix, PDF417, Aztec, Code 128, 39 and 93, EAN, UPC, ITF, Codabar) and printed text at the same time, on the phone; torch; shutter for a still picture; keyboard entry (also a picture from the library, read the same way)
- [x] Works out the value as in §5.5: codes exact (with the format's extraction pattern), text checked against the formats and their check characters, two-frame agreement for text, code wins when code and text disagree, text without a format only offered for confirmation (also: text matching a format without a check character is confirmed by the person before it is looked up; look-alike variants of letters-and-digits text go to the server, which never picks between two records)
- [x] Several tags in view are listed; candidates outlined on screen with how they were read
- [x] The tag card from `POST /api/asset-tags/lookup` with the server's actions (E37-04, E37-06); a value in stock offers Attach (also Replace tag, read with the camera or typed; quick updates with `If-Match`; notes; photos; count; reports; actions the app does not do yet open on the web)
- [x] Pictures processed on the phone and discarded unless attached to a record
- [ ] Unit tests for candidate extraction and normalization; the tag photo test set (§5.5) at 98% or better with no wrong record; Maestro flow reading a test image — unit tests done; the test set (58 synthetic photos, every code type, digits, letters and digits, both, shelves, rotation, blur, glare, low contrast) scores 58 of 58 with no wrong record on modeled recognizer output, and **57 of 58 (98.3%) with no wrong record through the real on-device readers** (Android emulator, API 36, each photo read once as a still picture; `mobile/test/tag-photos/real-reads.json`); still to do: the live camera on a real phone (outline placement, daylight, indoors and low light, iPhone), and the Maestro flow (written, `mobile/test/tag-photos/maestro/`) once Maestro runs in CI

**Implemented in:** `mobile/src/tags/` (`read.ts` value rules, `reader.ts` two-frame agreement and what is in view, `lookup.ts`, `decide.ts`, `formats.ts`, `calls.ts`, `handoff.ts`; screens `screens/TagScreen.tsx`, `TagCardScreen.tsx`, `AttachScreen.tsx`, `ReplaceScreen.tsx`, `QuickUpdateScreen.tsx`); `mobile/src/camera/` (`TagCamera.tsx` with react-native-vision-camera 5, its ML Kit barcode scanner and react-native-vision-camera-ocr-plus for ML Kit on-device text recognition, model bundled, on both platforms; `still.ts`, `geometry.ts`, `photos.ts`); routes `mobile/app/(tabs)/tag/`; tests `mobile/src/tags/read.test.ts`, `lookup.test.ts`, `tests/*.test.tsx`, `mobile/src/camera/camera.test.ts`; the tag photo test set `mobile/test/tag-photos/` (`generate.mjs`, `images/`, `set.json`, `harness.test.ts`)

### E38-06 Report a problem or a hazard with photos

**Status:** in progress (built and unit-tested; offline through the outbox and the Maestro flow are left) · **Priority:** P1 · **Type:** feature

An operator wants to report a defect or a close call quickly, from a tag or from scratch.

**Acceptance criteria**

- [x] Report a problem (ticket) and report a hazard or close call (safety), with the record linked when started from a tag, location picked from sites, and several photos (up to 10; tickets have no site field, so the place is written into the ticket's text)
- [x] Photos resized on the device to the server's limits; uploads resume (a queue kept on the phone: the record is created once and its id kept, each photo is re-sent whole after a failure or a restart; the server has no partial uploads)
- [ ] Works offline through the outbox once E38-10 is built (until then a report written without signal waits on the phone and is sent on its own; a connection lost during the create waits for the person to check and choose Send again or Discard, because the server does not yet honor `Idempotency-Key`)
- [ ] Maestro flow: report with two photos; the ticket appears on the web

**Implemented in:** `mobile/src/camera/report/` (`ReportHomeScreen.tsx`, `ReportFormScreen.tsx`, `build.ts`), `mobile/src/camera/reports.ts` (the queue), `reportQueue.ts` (its files and sign-out wipe), `photos.ts`; routes `mobile/app/(tabs)/report/`; tests `mobile/src/camera/report/report.test.tsx`, `mobile/src/camera/camera.test.ts`

### E38-07 Search and record views

**Status:** done · **Priority:** P2 · **Type:** feature

A supervisor wants to look up a record and update it from the phone.

**Acceptance criteria**

- [x] Search across what the person may see (`GET /api/search`); recent items (kept in the Keychain or Keystore, never restricted records, wiped on sign-out)
- [x] Phone layouts for assets, vehicles, sites, systems, tickets, actions, safety reports (safety events and hazards) and inspections: summary, key fields, activity, comments, attachments; a general layout for any other type the person may view
- [x] Editing of `mobileEditable` fields (and each type's phone set: status, people, location, condition, notes, tag number) with `If-Match` and a conflict screen showing both values to choose; "Open on the web" when a form needs more (§5.4): a status that needs fields the phone does not show, or a server message about such a field
- [x] Restricted records: screenshots blocked on Android, blank app-switcher image on iOS (`expo-screen-capture`)

**Implemented in:** `mobile/src/records/` (`screens/SearchScreen.tsx`, `screens/RecordScreen.tsx`, `RecordEditor.tsx`, `RecordPanels.tsx`, `fields.tsx`, `edit.ts`, `layouts.ts`, `format.ts`, `api.ts`, `recent.ts`, `secure.ts`, `web.ts`, `ui.tsx`); routes `mobile/app/(tabs)/search/index.tsx`, `mobile/app/record/[type]/[id].tsx`; `FieldDef.mobileEditable` in `server/src/core/module.ts`; tests `mobile/src/records/tests/RecordScreen.test.tsx`, `SearchScreen.test.tsx`, `rules.test.ts`

### E38-08 Approvals and acknowledgments

**Status:** done · **Priority:** P2 · **Type:** feature

A manager wants to decide approvals and acknowledge policies away from the desk.

**Acceptance criteria**

- [x] Waiting approvals with what is being approved; approve or reject with a reason (needed to reject); password confirmation when the step requires it (a 403 `reauth_required` answer runs the browser sign-in with `prompt=login`, then sends the decision once more)
- [x] Policy acknowledgments due, with the document readable in the app (the exact version asked about, as native text that follows the phone's text size)
- [x] Tests: the engine's rules apply unchanged (distinct approvers, lost permission): the app sends the decision to the same route as the web and shows the server's refusal as it comes

**Implemented in:** `mobile/src/records/screens/ApprovalsScreen.tsx`, `ApprovalScreen.tsx`, `AcknowledgmentScreen.tsx`, `reauth.ts`, `html.ts`; routes `mobile/app/approvals/index.tsx`, `approvals/step/[id].tsx`, `approvals/acknowledgment/[id].tsx`; tests `mobile/src/records/tests/Approvals.test.tsx`, `rules.test.ts`

### E38-09 Notifications list and app settings

**Status:** done (wave 13) · **Priority:** P2 · **Type:** feature

A person wants to see their notifications in the app and manage the app's settings.

**Acceptance criteria**

- [x] The in-app notification list, read state shared with the web
- [x] Account screen: who and which server, devices, unlock settings, sign out, about and open-source licenses
- [x] Administration settings for the Mobile app area (token lifetimes, required unlock, offline expiry) documented (server and web done: Administration > Mobile app, `GET/PUT /api/mobile/admin/settings` in `server/src/modules/mobile/settings.ts`, `web/src/modules/mobile/AdminSettings.tsx`; `GET /api/mobile/settings` gives the app the unlock rules, tag formats, areas and permissions; guide text sent to the coordinator for "The mobile app")

**Implemented in:** `mobile/app/notifications.tsx` and `mobile/src/api/notifications.ts` (the web's `/api/notifications` routes: unread filter, mark one or all read, paging, pull to refresh, opening the record), `mobile/app/(tabs)/account/` (`index.tsx` Account, `devices.tsx`, `licenses.tsx` from `src/about/licenses.json`), the user guide page [The mobile app](../../user/39-mobile-app.md) (administrators' settings table). Checked on the Android emulator: opening a notification in the app set it read on the web.

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

- [ ] Join an open count; camera in counting mode offline against the package (every tag read in view is added); found and unexpected shown as they happen
- [ ] Problem and hazard reports offline through the outbox
- [ ] Synced finds merge with other counters' finds; tests

### E38-13 Guide, build instructions and beta distribution

**Status:** in progress (wave 13: the guide page, `docs/mobile.md` and the version range; signed releases wait for the maintainer's accounts, offline work for E38-10 to E38-12) · **Priority:** P1 · **Type:** docs

Testers want to install the app, organizations want to build their own copy if they prefer, and
everyone wants to know how to use it.

**Acceptance criteria**

- [ ] User guide page "The mobile app": installing the beta, connecting, signing in, reading tags, each screen, offline work, lost phones — done except offline work (written with E38-10 to E38-12)
- [x] `docs/mobile.md`: building and signing for both platforms, own name and icon, TestFlight uploads (builds expire after 90 days), the Android signing key kept outside the repository, device-management distribution, push credentials (once E38-14) — push credentials follow with E38-14
- [ ] CI produces a signed Android APK attached to each release and an iPhone build uploaded to TestFlight by the maintainer; the beta's privacy notes say the publisher collects no data
- [x] The app's version range in `GET /api/mobile/hello` and `GET /api/version`; release checklist (in `docs/mobile.md`, linked from `docs/operations.md`)

### E38-14 Push notifications

**Status:** open · **Priority:** P3 · **Type:** feature

A person wants to be told on the phone when something needs them.

**Acceptance criteria**

- [ ] Push through Apple's and Google's push services with the project's credentials configured on the server (§5.7), or UnifiedPush on Android; content never includes record details, only "you have N new notifications"
- [ ] Per-person notification choices apply to push as to email
- [ ] Tests with fake push services; delivery claimed so overlapping runs send once

### E38-15 Accessibility and security review of the apps

**Status:** open · **Priority:** P1 · **Type:** debt

Everyone wants the apps to be usable with assistive technology and safe to put on work phones.

**Acceptance criteria**

- [ ] VoiceOver and TalkBack walkthrough of every screen; Dynamic Type and font scaling to 200%; no gesture-only action
- [ ] Security checks of §5.7 tested (no outside data, no user certificate authorities on Android, local data wiped on revocation, offline expiry)
- [ ] The apps and their endpoints included in the independent review (E16-40); threat model in `docs/security.md`
