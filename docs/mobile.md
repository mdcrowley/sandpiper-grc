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
| `mobile/app/` | Screens (expo-router: every file is a screen). `(auth)/connect.tsx` connect and sign in; `(tabs)/` the five tabs (My work, Tag, Report, Search, Account); `notifications.tsx`; `record/`, `approvals/` |
| `mobile/src/api/client.ts` | The only way screens reach the server: `apiFetch`, `apiUpload`, `useSession`, `confirmIdentity`, `ApiError` |
| `mobile/src/auth/` | Connecting (`server.ts`), OAuth with PKCE (`oauth.ts`), tokens and the session (`session.ts`), storage in the Keychain or Keystore (`storage.ts`), the unlock (`unlock.ts`, `LockScreen.tsx`) |
| `mobile/src/text/` | The words of each screen, one file per screen |
| `mobile/src/theme/` | Colors copied from the web's `tokens.css` (light and dark), spacing, type sizes |
| `mobile/src/ui/` | Shared building blocks (Screen, Button, Field, Banner, Section, Row) |
| `mobile/plugins/` | Expo config plugins of this project: unsigned Android release builds, the Windows native build folder |
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
   it, and on Android they trust only the system's certificate authorities, so a test server for a
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

End-to-end flows on emulators (Maestro) are planned (E38-01); until then the app is checked by hand on
the Android emulator against a scratch server, as above.

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
