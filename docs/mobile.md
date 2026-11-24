# The mobile app: building, signing and distributing

Sandpiper GRC has an app for iPhone and Android (`mobile/`), for people who work away from a desk. This
page is for developers and for organizations that build their own copy. How to use the app is in the
user guide: [The mobile app](user/39-mobile-app.md). The design is in the
[asset tags and mobile apps specification](roadmap/specs/asset-tags-and-mobile-apps.md) (§5) and the
work in epic [E38](roadmap/epics/E38-mobile-apps.md).

The app is React Native with Expo (MIT), in TypeScript, with its own `package.json` and lockfile. The
repository's root install, typecheck, tests and container image never include it. It sends nothing to
anyone except the organization's own server: no analytics, crash reporting or advertising libraries,
Expo's command-line telemetry switched off (`EXPO_NO_TELEMETRY=1`), and the Android command-line tool
always run with `--no-metrics`. No paid build service is needed.

## Layout

| Path | What |
|---|---|
| `mobile/app/` | Screens (expo-router: every file is a screen). `(auth)/connect.tsx` connect and sign in; `(tabs)/` the five tabs (My work, Tag, Report, Search, Account); `notifications.tsx`; `record/` (vehicles and assets show their model among the key fields, read-only, E39-07), `approvals/` |
| `mobile/src/api/client.ts` | The only way screens reach the server: `apiFetch`, `apiUpload`, `useSession`, `confirmIdentity`, `ApiError` |
| `mobile/src/auth/` | Connecting (`server.ts`), OAuth with PKCE (`oauth.ts`), tokens and the session (`session.ts`), storage in the Keychain or Keystore (`storage.ts`), the unlock (`unlock.ts`, `LockScreen.tsx`) |
| `mobile/src/inspections/`, `mobile/src/counts/` | Field work offline (E38-11, E38-12): the inspection runner, signature, condition assessments, the Field work list; counting mode. Routes `app/fieldwork/` |
| `mobile/src/offline/` | Offline work (E38-10): the outbox (`outbox.ts`), kinds of work (`kinds.ts`), the offline package (`package.ts`), SQLite storage (`sqlite.ts`), the server routes (`transport.ts`), the Offline work screen; started by the session (`index.ts` `bootOffline`) |
| `mobile/src/text/` | The words of each screen, one file per screen |
| `mobile/src/theme/` | Colors copied from the web's `tokens.css` (light and dark), spacing, type sizes |
| `mobile/src/ui/` | Shared building blocks (Screen, Title, Button, Field, Banner, Section, Row, SwitchRow) and the screen reader helpers (`a11y.ts`: `useAnnounce`, `useFocusOn`); see "Accessibility" |
| `mobile/plugins/` | Expo config plugins of this project: unsigned Android release builds, the Windows native build folder, the Android network security config and backup rules (withPlatformSecurity.js) |
| `mobile/modules/sandpiper-storage` | iPhone only: marks the offline folders excluded from backups (called from src/offline/backup.ts) |
| `mobile/test/maestro/` | End-to-end flows on the Android emulator (Maestro), `run.sh` and the lost-connection proxy `dropproxy.mjs` (see "End-to-end flows") |
| `mobile/scripts/licenses.js` | Writes `src/about/licenses.json` (Account > Open-source licenses) from the lockfile: `npm run licenses` |
| `packages/api-client/` | TypeScript types of the API the app uses, generated from the server's OpenAPI description |
| `shared/` | Code the server, the web and the app share (tag values and formats, API shapes) |

## Commands

With the portable Node on the path (`$env:Path = "$PWD\.tools\node;$env:Path"`), in `mobile/`. **Always
switch Expo's telemetry off first** in the shell you build or start the app from (CI sets it in the
`mobile` job): `$env:EXPO_NO_TELEMETRY = "1"` in PowerShell, `export EXPO_NO_TELEMETRY=1` in a Unix shell.

```
$env:EXPO_NO_TELEMETRY = "1"   # or: export EXPO_NO_TELEMETRY=1
npm ci              # exactly what the lockfile says
npm run typecheck   # TypeScript
npm test            # Jest with React Native Testing Library (tests under src/ and test/, never under app/)
npm run licenses    # after changing dependencies: the licenses list (a test fails when it is stale)
npx expo start      # the development server (Metro) for a development build
```

Add a dependency with `npm install --save-exact <package>@<version>`, using the version
`node_modules/expo/bundledNativeModules.json` names for Expo SDK packages; check its license (MIT, BSD,
Apache or similar) and that it sends nothing anywhere.

### The API client (`packages/api-client`)

`packages/api-client/src/schema.ts` holds TypeScript types of the operations listed in
`packages/api-client/include.json` (exact paths, or `prefix/**`), generated from the same OpenAPI
description `GET /api/openapi.json` serves. From the repository root:

```
npx tsx packages/api-client/generate.ts          # regenerate after changing an API the app uses
npx tsx packages/api-client/generate.ts --check  # what CI runs: fails when schema.ts is out of date
```

The app imports the types by relative path, for example
`import type { ApiResponse } from '../../../packages/api-client/src/index.ts'` and
`ApiResponse<'/api/notifications', 'get'>`. To use another API in the app, add its path to
`include.json` and regenerate. It has no runtime code: requests go through `mobile/src/api/client.ts`.

### The tag photo test set

`mobile/test/tag-photos/` measures the Tag camera's value rules (spec §5.5, E38-05) on pictures of
invented tags: printed digits, letters and digits, every code type, tags carrying both, several tags in
view, with rotation, blur, glare and low contrast.

- `node mobile/test/tag-photos/generate.mjs` (from the repository root; uses the root install's
  `bwip-js`) writes the pictures (`images/`) and `set.json`: what each picture shows, which record it
  belongs to, and recognizer output modeled on the on-device readers.
- `harness.test.ts` (part of `npm test` in `mobile/`) runs the app's rules on that output against a
  stand-in server and checks the target: at least 98% right, never a wrong record.
- To measure the real recognizers: `node mobile/test/tag-photos/import-reads.mjs push` puts the
  pictures on the connected emulator or phone; in a development build, **Tag > Choose a picture** reads
  them and logs `[tag-photo-reads]` lines (`adb logcat -s ReactNativeJS`); save the log and run
  `node mobile/test/tag-photos/import-reads.mjs import <log> "<device and system>"`, which writes
  `real-reads.json`; the harness then also prints the real rate.

## Offline work

Offline work (spec §5.6, E38-10) has three parts. Everything the app keeps for it is in the app's private
documents folder: one SQLite database (`offline.db`, expo-sqlite) and a folder of files (`offline/`,
photos). That folder is the app's protected storage: on Android the app's internal storage, encrypted by
the system's file-based encryption and never backed up (`allowBackup: false`); on iPhone the app's
sandbox under Data Protection. Signing out, or being signed out (a refused refresh, the device signed out
on the web, the account deactivated, the area switched off), deletes the database and the folder
(`wipeOffline`, registered with the session's `onWipe` when the session starts). On iPhone the database and files folders are excluded from iCloud and computer backups (SandpiperStorage). On Android the manifest's backup and data extraction rules (plugins/withPlatformSecurity.js) exclude every folder, also from device-to-device transfer. A wipe also empties the app's cache folder, and a signed-out start finishes any wipe left half done.

- **The outbox** (`src/offline/outbox.ts`). Work is saved first and sent afterward, in the order it was
  saved. Each item has a UUID made when it was saved (its `clientId`), which is its idempotency key: the
  server keeps each answer for 7 days (`SYNC_KEEP_DAYS`, table `mobile_sync_items`), so an item sent
  again after a lost answer, a timeout or the app being closed is answered from memory and never done
  twice. Items go in batches (`POST /api/mobile/sync`, up to 50, each answered separately: `done`,
  `rejected` with the server's reason, or `retry`); files go one at a time
  (`PUT /api/mobile/sync/attachment`, the whole file received before anything is done, so a connection
  lost during the upload does nothing). An item that depends on another (a photo on its report) waits for
  it. A `retry`, or no connection, stops the run; it starts again when the app starts, when it comes to
  the front, when the network comes back (expo-network) and every 30 seconds. A `rejected` item stays
  under **Report > Offline work** (Needs attention) until the person sends it again or discards it; a
  server that stopped part-way answers `uncertain`, which can only be sent again as new work (a new id).
  Fully sent work is kept a day so the person sees it arrived.
- **The server side** (`server/src/modules/mobile/sync.ts`). Each item is done through the application's
  own route, in-process, with the person's own token: a report is `POST /api/tickets` (or
  `/api/safety-events`, or the portal's report routes) exactly as on the web, a photo is
  `PUT /api/attachments/upload`. Validation, permissions, restrictions, hooks, notifications and audit are
  the web's, and a refusal comes back with the route's own reason. Only the app's own token may use these
  routes (`mobile_app_only`), so a signed-out device can send nothing.
- **The offline package** (`GET /api/mobile/package`, `server/src/modules/mobile/package.ts`; in the app
  `src/offline/package.ts`). My work, the lists the report forms need, the sites the person may see, the
  portal's report choices, the attachment limits, the tag formats with the tag values of the records the
  package covers, the organization's time zone, and parts (`inspections` with their checklists,
  `condition`, `counts`; see "Field work"). It is read through the application's own routes as the person, so it holds only what
  they may see. It expires after `mobile.offline_days` (Administration > Mobile app, default 7); the app
  deletes an expired package, or another person's, when it notices, and downloads a fresh one at most
  every hour when online. Screens read it through `orOffline(fromServer, fromPackage)`: the server
  first, the package when the server cannot be reached.

### Adding a kind of offline work

A new kind of work is a new kind of outbox item and a new package part; the outbox, the storage, the wipe
and Needs attention need no change (wave 15 added inspections, condition assessments and counts this way,
see "Field work" below).

1. **Server, the work:** `defineSyncKind(app, { key, check, run })` from `modules/mobile/sync.ts`, for
   example `inspection.complete`. `check(payload)` cleans the payload or returns a message (the item is
   rejected at once); `run(env, payload)` does the work through `env.call(method, url, body)` (the
   application's own routes, as the person) and returns the route's answer with a `result` (`recordType`
   and `id` when it made a record, so a later item can name it: `env.madeBy(clientId)`). Status 2xx is
   `done`; 401, 408, 429 and 5xx are `retry`; any other refusal is `rejected` with its reason. Add the key
   to `SyncKind` in `shared/mobile-api.ts`.
2. **Server, the package:** `definePackagePart(app, { key, build })` from `modules/mobile/package.ts`;
   `build(env)` returns `{ data, records }`, where `records` are the records the work covers (their tag
   values join the package's lookup table). Read with `env.call` so only what the person may see is
   included, and describe the part's shape in `shared/mobile-api.ts`.
3. **App:** `defineOutboxKind({ kind, send: 'batch' | 'upload', noun })` in `src/offline/kinds.ts`; the
   screen saves work with `outbox().add([...])` (the items of one piece of work in one call; a photo
   names the item it belongs to with `dependsOn`) and reads the package with `useOfflinePackage()`.
4. **Tests:** the server kind as in `server/src/modules/mobile/sync.test.ts` (the same batch twice, a
   removed permission rejected), the app's screen with a stand-in outbox (`src/offline/screen.test.tsx`).

### Field work (wave 15)

Inspections and condition assessments (E38-11) and inventory counts (E38-12) are built on the pieces
above (server `server/src/modules/mobile/fieldwork.ts`; app `src/inspections/`, `src/counts/`, routes
`app/fieldwork/`, opened from **Report > Inspections, condition and counts**):

| Work | Outbox items | Server route, as the person | Package part |
|---|---|---|---|
| An inspection | one `attachment` per photo and one for the drawn signature (to the inspection), then `inspection.complete` (or `inspection.answers`) naming them by clientId | `PUT /api/inspections/:id/responses`, then `POST /api/inspections/:id/complete` with `signed_by_name` and `signature_attachment_id` | `inspections`: assigned to me, not closed, due by the package's last day, with checklist items and the answers already given (`PackageInspection`) |
| A condition assessment | `condition.assess`, then its photos (`attachment` with `parent`) | `POST /api/condition-assessments` | `condition`: assessments due for what I look after; the lists `condition_rating` and `condition_method` |
| A count find | one `count.found` per tag read | `POST /api/inventory-counts/:id/found` | `counts`: open counts I may count (`tags.count`), up to 20, with their records (up to 3000 each) |

- **The same rules.** The completion rules (every item answered, a photo where needed unless not
  applicable, result, score, findings) are one file, `shared/inspection-rules.ts`, used by the audits
  module's complete route and by the app's runner, which previews the result. The server checks again.
- **Drafts.** An inspection half answered, and the finds of a count joined, are kept as drafts in the
  same SQLite database (`kv` rows under `draft:`, photos under `offline/drafts/`), wiped with everything
  else. `drafts()` in `src/offline/index.ts`.
- **Photos before the answers.** An answer names its photos by the clientIds of `attachment` items saved
  before it in the same group; the server turns them into attachment ids (`env.attachmentOf`) and adds
  them to the photos already on the server. A photo refused or not yet arrived makes the completion
  refused with `photo_missing` (Needs attention), never silently dropped.
- **The signature** is the signer's typed name (kept on the inspection as `signed_by_name` and
  `signed_at`, audits migration 002) and an optional finger drawing, made into a PNG on the phone
  without any library (`src/inspections/signature.ts`: 8-bit grayscale, stored deflate blocks) and
  attached to the inspection; its id is in the completion's audit event.
- **Refusals** go to Needs attention with the route's reason: a canceled inspection (status `canceled`,
  409 `inspection_canceled`), a deleted one (404), a removed permission (403 `forbidden`), a count no
  longer open (409 `not_open`).
- **Counting** keeps VisionCamera open and counts every reading that may act alone (codes, and text a
  format and its check character confirm); other text waits for **Count it**. Each value is classified
  at once from the package (`src/counts/match.ts`: found, found before, unexpected, not covered, unknown)
  and replaced by the server's answer (`SyncResult.outcome`) when it arrived. Finds from several phones
  merge on the server (one atomic insert-or-update per find).
- **Offline tag lookup** (spec §5.5 step 7): when the lookup cannot reach the server (no answer, a
  timeout, 5xx), the Tag tab looks the values up in the package's `tags.values` (`src/tags/offline.ts`);
  a record there opens a short card with the offline actions (report a problem or hazard, record
  condition); other values are "not available offline". The tag formats also come from the package then.

## Push notifications

The server sends pushes itself, with your organization's own credentials (Administration > Push
notifications, part of the Mobile app area). No Expo push service and no relay is used. A push says only
"You have N new notifications"; the app fetches the rest when the person opens it.

- **iPhone (Apple Push Notification service):** in your Apple Developer account, create a key with
  Apple Push Notifications service (Certificates, Identifiers & Profiles > Keys), and enable Push
  Notifications for the app identifier `com.sandpipergrc` (or your own bundle id). Enter the key id,
  team id and bundle id, and load the .p8 file. TestFlight and App Store builds use Apple's production
  environment; development builds register as `sandbox`. `app.json` sets `expo-notifications` to
  `mode: production` (the `aps-environment` entitlement).
- **Android with Firebase Cloud Messaging (optional):** create a Firebase project of your own, add an
  Android app `com.sandpipergrc`, and download its `google-services.json`. Put it at
  `mobile/google-services.json` (git-ignored) or set `GRC_GOOGLE_SERVICES_FILE=<path>` before
  `npx expo prebuild`; `plugins/withPushNotifications.js` then applies Google's services plugin.
  Without the file the build has no Firebase project: the app cannot get an FCM token and uses
  UnifiedPush when the server offers it. On the server, load a service account key of the same project
  (Project settings > Service accounts > Generate new private key). Only its project id, account name
  and private key are kept, the key encrypted.
- **Android with UnifiedPush:** for phones without Google services. Each phone runs a UnifiedPush
  distributor connected to a push server (for example one your organization runs). List the push
  servers phones may use (host, host:port or *.domain; a private address must be listed exactly). The
  server makes its own VAPID key when UnifiedPush is first switched on; "Make a new key" (unavailable while the page has unsaved changes) makes phones
  register again. The app's connector is the local Expo module `SandpiperUnifiedPush`
  (`mobile/modules/sandpiper-unifiedpush/`, Kotlin), autolinked from `mobile/modules/`. It wraps
  `org.unifiedpush.android:connector` 3.3.5 (Apache-2.0, pinned exactly in its `android/build.gradle`),
  which brings only the Kotlin standard library and Google's Tink cryptography library (with
  protobuf-java, Gson, jsr305 and error-prone annotations), and no Google Play services, Firebase or
  analytics. Check the license and dependency tree before raising the version
  (`gradlew :sandpiper-unifiedpush:dependencies --configuration releaseRuntimeClasspath`). The
  connector makes the message keys on the phone and decrypts each message there; the module shows only
  a message in the server's "N new notifications" form, on the same channel and tag as the other
  services. Its Kotlin unit tests run with `gradlew :sandpiper-unifiedpush:testDebugUnitTest`. A
  distributor that gives a new address while the app is closed is picked up when the app next opens
  (the app registers again at every start).
- **What the build sends to Google:** Firebase Messaging's automatic token creation and Firebase
  Analytics are switched off in the manifest. The app asks for a token only after the person switches
  push on. Google's data transport is removed as for ML Kit. Verified with a Gradle merged manifest: no
  data-transport component and no analytics library in the release classpath. Firebase Messaging
  itself brings `firebase-measurement-connector` (an interface library only) and lists Firebase's own
  data-transport registrar in the manifest.
- **Retries:** a push that fails for a while only (no answer, a refused connection, 5xx, or 429) is
  tried again after 30 seconds, 2, 10 and 30 minutes and 1 hour, or after the wait the service asks for
  (Retry-After, up to 6 hours), then given up with the reason shown on the administration page. A
  service that answers busy or unavailable is left alone for the rest of that run. Each retry is sent
  once, says how many notifications are unread at that moment, and is dropped when everything has been
  read. A token the service no longer knows is removed at once and never retried.
- **Test:** on the administration page, "Send a test to my phones" sends a test push to your own
  registered phones and shows any error.

## Camera and recognition libraries

The Tag tab uses VisionCamera 5 (`react-native-vision-camera`, with its barcode-scanner and worklets
packages and Nitro modules) and `react-native-vision-camera-ocr-plus` for text, both on the phone with
Google's ML Kit on Android and ML Kit on iPhone. VisionCamera 5 has **no Expo config plugin**: the
camera permission is set in `app.json` directly (`ios.infoPlist.NSCameraUsageDescription`,
`android.permissions`), and the microphone permission is blocked. The text recognizer's plugin is set
to leave out the translation and non-Latin models (`disableTranslate`, `disableNonLatinTextRecognition`),
which would otherwise be downloaded.

### No usage data from ML Kit

ML Kit can send usage statistics (never pictures) to Google through Google's data transport
("Firelog"). The app promises to send nothing anywhere, so:

- **Android:** `mobile/plugins/withoutDataTransport.js` removes the data transport's components from
  the app's manifest (`tools:node="remove"` on
  `com.google.android.datatransport.runtime.backends.TransportBackendDiscovery`,
  `...scheduling.jobscheduling.JobInfoSchedulerService` and
  `...scheduling.jobscheduling.AlarmManagerSchedulerBroadcastReceiver`). With no transport backend
  registered, events are dropped on the phone, and nothing is scheduled for upload. Check it in a
  build: `android/app/build/intermediates/merged_manifests/<variant>/.../AndroidManifest.xml` must not
  contain `datatransport`; and on a device, `adb logcat | findstr /i transport` shows no upload being
  scheduled after reading tags.
- **iPhone:** ML Kit's iOS libraries depend on `GoogleDataTransport` and offer no documented switch to
  turn its logging off; it cannot be left out without breaking ML Kit. This is not verified: whether
  the iOS build sends usage statistics has not been measured (it needs a Mac and a proxy on the
  network). Until it has been, the iPhone app cannot claim the same as Android; see
  [Security](security.md).

## Build tools

- **Android** (Windows, macOS or Linux): JDK 17 and the Android SDK. `tools/install-android-tools.ps1`
  (Windows) or `tools/install-android-tools.sh` (macOS, Linux) download a portable copy into `.tools/`
  with no administrator rights: Temurin JDK 17 (SHA-256 checked against the Adoptium API), the Android
  command-line tools (SHA-1 checked against Google's SDK repository list), then `platform-tools`,
  `platforms;android-36` and `build-tools;36.0.0` through the Android command-line tool with
  `--no-metrics`. Add `-WithEmulator` / `--with-emulator` for the emulator and a virtual phone
  `sandpiper-test`, and `-AcceptLicenses` / `--accept-licenses` to accept the SDK licenses without being
  asked. Gradle downloads the NDK, CMake and newer platforms on the first build. Then:

  ```powershell
  $env:JAVA_HOME = "$PWD\.tools\jdk"; $env:ANDROID_HOME = "$PWD\.tools\android-sdk"
  $env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
  $env:EXPO_NO_TELEMETRY = "1"     # Expo sends no usage data
  $env:ANDROID_AVD_HOME = "$PWD\.tools\android-avd"
  ```
- **iPhone**: a Mac with Xcode (from the App Store) and CocoaPods. There is no way to build iPhone apps
  on Windows or Linux; GitHub Actions' macOS runners build them in CI.

The native projects (`mobile/android/`, `mobile/ios/`) are generated from `app.json` and the config
plugins by `npx expo prebuild` and are never committed; change `app.json` or a plugin instead.

## Running the app against a local server

1. Start a scratch server (see [Working on several modules at once](development.md#working-on-several-modules-at-once))
   and switch **Mobile app** on under **Administration > Features**. Create a person to sign in with.
2. Generate the Android project and build a development app (it loads the JavaScript from Metro):

   ```
   cd mobile
   $env:EXPO_NO_TELEMETRY = "1"            # or: export EXPO_NO_TELEMETRY=1
   npx expo prebuild --platform android --no-install
   cd android
   .\gradlew.bat assembleDebug -PreactNativeArchitectures=x86_64 -PnativeBuildDir=C:/b   # Windows (see below)
   ./gradlew assembleDebug                                                                # macOS, Linux
   ```
3. Start the emulator (`& "$env:ANDROID_HOME\emulator\emulator.exe" -avd sandpiper-test`) or connect a
   phone with USB debugging, install the app and start Metro (without `CI=1`, which turns reloads off):

   ```
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   cd .. ; $env:EXPO_NO_TELEMETRY = "1"; npx expo start --port 8081
   ```

   The development app looks for Metro at `localhost:8081` on the phone. `adb reverse tcp:8081
   tcp:8081` usually connects it; if it does not (it did not on a Windows emulator), open the developer
   menu (`adb shell input keyevent 82`) and set **Settings > Debug server host** to `10.0.2.2:8081`,
   or write that setting (`debug_http_host`) into
   `/data/data/com.sandpipergrc/shared_prefs/com.sandpipergrc_preferences.xml` with `adb shell run-as
   com.sandpipergrc` and start the app again. On a fresh emulator Chrome shows its welcome screen at the
   first sign-in: choose **Use without an account**.
4. In the app, type the server address. The emulator reaches your computer as `10.0.2.2`, so a server
   on port 8146 is `http://10.0.2.2:8146`; a phone uses `adb reverse tcp:8146 tcp:8146` and
   `http://127.0.0.1:8146`. **Plain HTTP works only in development builds**; release builds refuse
   it, and on Android they trust only the system's certificate authorities (an explicit network security config; development builds allow plain HTTP and user authorities), so a test server for a
   release build needs a certificate from a public or system-installed authority.

On iPhone: `export EXPO_NO_TELEMETRY=1; npx expo prebuild --platform ios`, then `npx expo run:ios`
(simulator) on a Mac.

**Windows path lengths.** The C++ parts of some libraries (Reanimated, Worklets, Nitro modules) are
compiled with CMake, whose object paths under `node_modules/<library>/android/.cxx/...` repeat the
source path and pass Windows' 260-character limit when the repository is in a deep folder; the build
then fails with `ninja: error: mkdir(...): No such file or directory`. Pass a short folder for those
build files with `-PnativeBuildDir=C:/b` (or set `NATIVE_BUILD_DIR`), added by
`mobile/plugins/withNativeBuildDir.js`: each library's CMake folder moves to a short folder there, and
CMake is told (`CMAKE_OBJECT_PATH_MAX=240`) to replace an object file's folder with a short hash when
its path would be too long. (Turning on long paths in Windows, an administrator setting, may also
work; it has not been tried for this project.)
`-PreactNativeArchitectures=x86_64` builds only what the emulator needs, which is much faster.

## Release builds

### Android: an unsigned APK, signed afterward

`mobile/plugins/withUnsignedRelease.js` makes release builds unsigned (Expo's template would sign them
with a shared debug key). CI builds one on every push (artifact **sandpiper-grc-android-unsigned**):

```
cd mobile; export EXPO_NO_TELEMETRY=1; npx expo prebuild --platform android --no-install
cd android
./gradlew assembleRelease          # → app/build/outputs/apk/release/app-release-unsigned.apk
```

**The signing key is kept outside the repository**, for example in a password manager or on an
encrypted drive, with a backup: an app signed with a different key cannot update an installed one.
Make it once:

```
keytool -genkeypair -v -keystore ~/keys/sandpiper-grc-release.jks -alias sandpiper-grc \
  -keyalg RSA -keysize 4096 -validity 10000
```

Sign each APK with the SDK's build tools (aligned first, then signed, then checked):

```
$BT = "$env:ANDROID_HOME\build-tools\36.0.0"
& "$BT\zipalign.exe" -p -f 4 app-release-unsigned.apk app-release-aligned.apk
& "$BT\apksigner.bat" sign --ks $HOME\keys\sandpiper-grc-release.jks --ks-key-alias sandpiper-grc `
  --out sandpiper-grc-0.1.0.apk app-release-aligned.apk
& "$BT\apksigner.bat" verify --print-certs sandpiper-grc-0.1.0.apk
```

Publish the signed APK on the GitHub release with its SHA-256 and the certificate's SHA-256
fingerprint (from `verify --print-certs`), so testers can check it. Testers install it after allowing
"Install unknown apps" for their browser or file manager; an organization's device management can
push it instead.

### iPhone: unsigned builds in CI, TestFlight by the maintainer

CI builds the app for the simulator and for devices without signing (`CODE_SIGNING_ALLOWED=NO`), to
prove it builds. To distribute it, someone with an **Apple Developer Program** membership (a yearly
fee; there is no practical way to put an app on iPhones without one):

1. On a Mac: `cd mobile; export EXPO_NO_TELEMETRY=1; npm ci; npx expo prebuild --platform ios`, open `ios/SandpiperGRC.xcworkspace`
   in Xcode, choose your team under **Signing & Capabilities** (automatic signing), and set the version
   and build number.
2. **Product > Archive**, then in the Organizer **Distribute App > TestFlight & App Store** and upload.
   (Or `xcodebuild archive` and `xcrun altool --upload-app` / the Transporter app.)
3. In App Store Connect, answer the export compliance question (the app uses only the operating
   system's encryption; `ITSAppUsesNonExemptEncryption` is false in `app.json`), fill the beta's
   privacy answers (**the publisher collects no data**: the app talks only to the organization's own
   server), and add testers by email or a public link.

**TestFlight builds expire after 90 days**: upload a new build at least that often, or testers lose
the app.

## Your own name and icon

An organization can build its own copy, for example with its name and icon, signed with its own keys:

- `mobile/app.json`: `name` (shown under the icon), `slug`, `icon`, `android.adaptiveIcon`, `ios.icon`
  and `splash` (1024 × 1024 PNG icons; see Expo's app config documentation).
- A copy distributed side by side with the project's beta needs its own `ios.bundleIdentifier` and
  `android.package` (for example `org.example.grc`).
- **Keep `scheme` as `com.sandpipergrc`**: the server's built-in mobile client accepts only the redirect
  `com.sandpipergrc:/oauth` (`shared/mobile-api.ts`), so a different scheme cannot sign in.
- Nothing in the app names an organization: the server's name on the connect screen comes from the
  server (`appName`).

## Continuous integration

The `mobile` job in `.github/workflows/ci.yml` runs on every push and pull request (actions pinned by
commit):

- **android** (Linux): the API client freshness check, `npm run typecheck`, `npm test`, `expo prebuild`
  and `./gradlew assembleRelease`; the unsigned APK is kept as an artifact for 30 days.
- **ios** (macOS): `expo prebuild`, `pod install`, and `xcodebuild` Release builds for the simulator
  and for devices, unsigned.

The end-to-end flows below run locally on the Android emulator; they are not yet part of CI.

## End-to-end flows (Maestro)

`mobile/test/maestro/` holds [Maestro](https://maestro.dev) flows (Apache-2.0) for the Android emulator
against a scratch server: `connect-sign-in.yaml` (connect, sign in with a password in the browser,
confirm the password when the server asks), `report-two-photos.yaml` (a problem report with two
photos from the photo picker arrives with both), `airplane-mode-sync.yaml` (a report with two photos
written in airplane mode waits on the phone, then arrives when the network is back) and
`sign-out-wipes.yaml` (signing out warns about the unsent report and removes it from the phone); and
`inspection-offline.yaml` (an inspection completed and signed in airplane mode arrives once) and
`count-offline.yaml` (counting in airplane mode, found and unexpected shown at once, finds arriving
when the network is back), run by `run-fieldwork.sh`, which makes the invented records first and then
checks the server (`fieldwork.mjs`): the inspection complete once, signed, with the signature attached,
and the count's totals.
`run.sh` runs them in that order on a clean app and then asks the server that each report arrived
exactly once, with two files, and that the unsent one never did. `large-text.yaml`, run by
`run-large-text.sh` (with `INSPECTION` set to an inspection of `run-fieldwork.sh`'s set-up, on an app
already signed in), goes through My work, Notifications, the report form, an inspection, the Tag tab's
number box and Account at Android's largest text size (font scale 2.0) in the dark theme, and puts the
emulator's text size and theme back afterward (see "Accessibility").

1. Install the Maestro command-line tool into `.tools/maestro` (no system-wide install): download
   `maestro.zip` from the project's GitHub release, check it against the release's
   `checksums_sha256.txt`, and unzip it there. It needs Java 17 (`.tools/jdk`). Keep its usage reporting
   off: `MAESTRO_CLI_NO_ANALYTICS=1` (`run.sh` sets it).
2. Start a scratch server (see [Working on several modules at once](development.md#working-on-several-modules-at-once)),
   switch **Mobile app** on, and create a person without a second factor.
3. Build and install the development app and start Metro (see "Running the app against a local
   server"), with the emulator running. On a Windows emulator `adb reverse` of Metro's default port 8081
   did not work; start Metro on another port (`npx expo start --port 8250`) and give it as `METRO_PORT`:
   `run.sh` reverses that port and points the development app at it.
4. In Git Bash or a Unix shell, with `maestro`, `adb` and `node` on the path:

   ```
   SERVER=http://10.0.2.2:8150 SERVER_LOCAL=http://127.0.0.1:8150 USERNAME=... PASSWORD=... \
     METRO_PORT=8250 mobile/test/maestro/run.sh
   ```

**Lost connections.** `mobile/test/maestro/dropproxy.mjs` is a small proxy (port 8151 to the server on
8150) that loses answers on purpose: the server does the first outbox batch and the first photo, then
the connection to the phone is cut before the answer arrives, and the first photo upload is cut
half-way. Run `node mobile/test/maestro/dropproxy.mjs`, connect the app to `http://10.0.2.2:8151`, run
`report-two-photos.yaml`, and check that the report arrived once with two files.

## Accessibility

The app is checked against WCAG 2.1 AA where it applies to apps (E38-15); what was proven and what still
needs a person is in the [accessibility statement](accessibility.md#mobile-app). Rules for new screens:

- **Use the shared building blocks** (`src/ui`, `src/records/ui.tsx`). Every control has a role and a
  name that starts with the words it shows (`accessibilityLabel` may add what it acts on after them:
  "Discard: Report a leak"); a choice says `selected` or `checked` (`Row selected`, radios), a row that
  opens a list says `expanded` (`Row expanded`), a switch is a whole `SwitchRow` (a bare Android
  `Switch` is under 48 dp). A `Row` with a control at the right keeps that control a separate item (an
  accessible parent would hide it from VoiceOver). Screen titles and section names are headings.
- **Messages are said.** `Banner` (warning, error) and `Notice` (error, success) call `useAnnounce`,
  which asks the system to say the text when it appears or changes (`announce` for an info message
  that reports a status change). Text that already sits in an `accessibilityLiveRegion` (the tag
  camera's status, counting's finds, the number of search results) uses `useAnnounce(text, { iosOnly:
  true })`, since VoiceOver has no live regions. Field errors are said and become the field's hint.
- **Focus after a change.** When part of a screen replaces another (an edit form, the next checklist
  item), put the heading's ref from `useFocusOn(key)` on the new part's heading. A part of a screen
  shown in its own mode gets its own `key` on `Screen`, so it opens at its top.
- **Large text.** No fixed heights on anything holding text, no `numberOfLines` that cuts text off,
  and no `maxFontSizeMultiplier` except the tab labels (1.4, so five fit). Rows of buttons wrap
  (`flexWrap`, children `flexGrow: 1`) rather than breaking words. Top-bar titles give `fontSize`
  (`HEADER_TITLE_SIZE`), which makes Android scale them. Touch targets are at least 48 points.
- **No gesture only.** Pull to refresh needs a Refresh or Try again button, endless scrolling a Load
  more button, a camera a typed alternative, the finger signature the typed name.
- **Colors** from `src/theme` only; text meets 4.5:1 and text-box and switch borders 3:1
  (`borderStrong`) in light and dark, checked by `src/ui/tests/a11y.test.tsx`.
- **Check it on the emulator** at `adb shell settings put system font_scale 2.0`, light and dark
  (`adb shell cmd uimode night yes`), and read the accessibility tree with `adb shell uiautomator dump`
  (content-desc, checkable, checked, selected, bounds). The emulator image has TalkBack
  (`com.google.android.marvin.talkback`).

## Versions

The app's version is `version` in `mobile/app.json`. The server says which app versions it accepts
(`MOBILE_COMPAT` in `shared/mobile-api.ts`, served by `GET /api/mobile/hello` and, signed in, by
`GET /api/version`): the app refuses a server whose mobile API it does not know, asks to be updated
when it is older than `minVersion`, and suggests an update when it is older than `recommendedVersion`.
Raise `minVersion` only when a server change breaks older apps.

### Release checklist

1. Raise `version` in `mobile/app.json`.
2. If the server's mobile API changed, update `MOBILE_COMPAT` in `shared/mobile-api.ts`: raise
   `minVersion` only when older apps break, `recommendedVersion` when the new app is worth the update.
3. Run `npm run typecheck` and `npm test` in `mobile/`, and check that the `mobile` CI job passes on
   Linux and macOS.
4. Build the signed Android APK (see above) and attach it to the GitHub release; upload the iPhone
   build to TestFlight. Upload a new iPhone build at least every 90 days.
5. Release the server with the same `MOBILE_COMPAT` before telling testers to update the app.
