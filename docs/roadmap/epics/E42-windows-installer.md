# E42 Windows installer, in-place updates and the update check

**Status:** in progress (7 of 8 issues done; E42-07 needs a real Windows Server and a person)

## Goal

An IT administrator downloads one file, runs it on a Windows server or PC, and has Sandpiper GRC
running as a service in a few minutes, with no internet access needed. Later versions install
over it safely, rolling back by themselves when an upgrade fails. Plain management scripts in the
Start menu run the service day to day. The server can say when a newer release exists. Installers
for other platforms come later and can reuse the same pieces (the staged program folder, the
upgrade and rollback steps, the settings file read by the service).

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E42-01 | The Windows installer: one offline file, install pages, silent install | done | P1 |
| E42-02 | The Windows service: boot start, restart after a crash, low-privilege account, logs, secrets | done | P1 |
| E42-03 | In-place upgrade with backup and automatic rollback; downgrades refused | done | P1 |
| E42-04 | Uninstall that keeps the data unless asked | done | P1 |
| E42-05 | Management scripts and Start menu shortcuts | done | P2 |
| E42-06 | The update check on Administration > About | done | P2 |
| E42-07 | Build and test in continuous integration; release asset; proof on a real Windows Server | in progress | P1 |
| E42-08 | Installer hardening: folders made in advance, the program folder's permissions, service privileges, links | done | P1 |

### E42-01 The Windows installer: one offline file, install pages, silent install

**Status:** done · **Priority:** P1 · **Type:** feature · **Implemented in:** `tools/installer/sandpiper-grc.iss` (Inno Setup 6: pages, upgrade detection, downgrade refusal, calls to `grc-windows.ps1`, uninstall form), `tools/installer/build.ps1` (stages the portable Node.js of `tools/node-version.txt`, the server without tests, `shared/`, the built web application and `npm ci --omit=dev` packages, compiles the service host, writes `SHA256SUMS.txt`), `deploy/windows/grc-windows.ps1` (`install`).

**Acceptance criteria**

- [x] One `.exe`, built with a free tool whose license allows our use (Inno Setup 6.7.4, its own permissive license), bundling everything needed to run offline
- [x] Program files under Program Files; data, backups, logs, settings and the key under ProgramData (or a chosen folder), apart from them
- [x] Pages for the port, the data folder, an optional HTTPS certificate and key, the firewall (only with HTTPS), and shortcuts; the first administrator is created by the existing setup wizard, which the installer opens
- [x] Silent install with `/PORT`, `/DATADIR`, `/TLSCERT`, `/TLSKEY`, `/FIREWALL`, `/DIR`, `/TASKS`, and documented exit codes
- [x] The installer waits for `/api/ready` before it finishes, then offers to open the browser
- [x] The installer is unsigned: `docs/installation.md` explains the SmartScreen warning and how to check the SHA-256 the release lists

### E42-02 The Windows service: boot start, restart after a crash, low-privilege account, logs, secrets

**Status:** done · **Priority:** P1 · **Type:** feature · **Implemented in:** `deploy/windows/SandpiperService.cs` (a small service host compiled with the .NET Framework 4 C# compiler that comes with Windows: no new runtime and no third-party wrapper; it runs `node.exe` with `config\grc.env`, restarts it when it stops by itself, stops it cleanly through `grc.stop`, ties it to a job object so it cannot outlive the host, and writes `logs\service.log`), `deploy/windows/grc-windows.ps1` (`install`: service definition, recovery actions, virtual account, folder permissions, secret key).

**Acceptance criteria**

- [x] Starts at boot (automatic), restarts after a crash (the host restarts the server; Windows restarts the host), logs to `<data folder>\logs`
- [x] Runs as its own virtual account `NT SERVICE\<name>` with rights only on its folders; where a domain policy refuses virtual accounts the right to log on as a service, it falls back to Network Service and keeps its service SID, so the same folder permissions apply (found on a domain-joined test workstation)
- [x] The data folder does not inherit ProgramData's permissions; the secret key is made at install time (32 random bytes) and readable by SYSTEM, Administrators and the service only, used through `GRC_SECRET_KEY_FILE`
- [x] A clean stop: the host creates `grc.stop` and waits 40 seconds before ending the server by force

### E42-03 In-place upgrade with backup and automatic rollback; downgrades refused

**Status:** done · **Priority:** P1 · **Type:** feature · **Implemented in:** `deploy/windows/grc-windows.ps1` (`pre-upgrade`, `post-upgrade`, `rollback`, `recover`), `tools/installer/sandpiper-grc.iss` (`PrepareToInstall`, `ssPostInstall`, `DeinitializeSetup`, `InitializeSetup`), `tools/installer/build.ps1 -BrokenMigration` (a test build whose migration fails).

**Acceptance criteria**

- [x] A newer installer over an older one: stop the service, back up the data with the installed version (`pre-upgrade`, the app's own backup format), keep a copy of the program files, replace them, run migrations, start, check `/api/ready`
- [x] If any of that fails, the previous program files and the pre-upgrade backup are put back and the previous version starts, the same steps as `grc.ps1 upgrade`; the recorded version and the Settings > Apps entry go back too; exit code 12 when silent
- [x] An installer stopped half-way puts the old files back when it ends (`recover`)
- [x] An older installer is refused with a clear message (exit code 1 when silent)

### E42-04 Uninstall that keeps the data unless asked

**Status:** done · **Priority:** P1 · **Type:** feature · **Implemented in:** `tools/installer/sandpiper-grc.iss` (`InitializeUninstall` form with an unchecked "Also delete the data folder" box, `/REMOVEDATA=1` when silent), `deploy/windows/grc-windows.ps1` (`uninstall`).

**Acceptance criteria**

- [x] Removes the program, the service, the firewall rule, the shortcuts and the registry entry
- [x] Keeps the data folder (database, files, backups, logs, settings, key) unless the box is checked

### E42-05 Management scripts and Start menu shortcuts

**Status:** done · **Priority:** P2 · **Type:** feature · **Implemented in:** `deploy/windows/sandpiper.cmd`, `deploy/windows/sandpiper.ps1`, the `[Icons]` of `tools/installer/sandpiper-grc.iss`.

A tray app was built first and dropped: the organization's endpoint protection stopped it as
malware (a compiled tray program was killed at start, before any of its code ran). The scripts
that replace it are readable, run in ordinary console windows, and use none of the patterns such
tools flag: no hidden windows, no encoded commands, no `Invoke-Expression`, no downloads that are
run, nothing at sign-in.

**Acceptance criteria**

- [x] Start menu folder "Sandpiper GRC": Open Sandpiper GRC, Server status, Start server, Stop server, Restart server, Back up now, Check for updates, Open logs folder, Uninstall
- [x] `sandpiper.cmd status | start | stop | restart | backup | check-update | logs | open` for the console; start, stop, restart and backup ask for administrator rights (UAC) only when needed
- [x] Server status shows the service state and the `/api/ready` answer and waits for a key
- [x] Check for updates shows the installed and newest versions and offers to open the download page; it downloads and runs nothing

### E42-06 The update check on Administration > About

**Status:** done · **Priority:** P2 · **Type:** feature · **Implemented in:** `server/src/modules/admin/updates.ts` (`GET`/`PATCH /api/admin/about`, settings `updates.check_enabled` and `updates.state`), `web/src/modules/admin/About.tsx` (Administration > About), test `server/src/modules/admin/updates.test.ts`; user guide [Administration, About and updates](../../user/09-administration.md#about-and-updates).

**Acceptance criteria**

- [x] The server asks the project's GitHub releases at most once a day, only while an administrator has the About page open, sending no personal or organization data
- [x] Administrators can switch it off on the About page (audited); it is off while outbound connections are off or `api.github.com` is not an allowed host, and the page says which
- [x] The result shows on Administration > About only, with a link to the release notes; the fenced outbound client is used (checked address, verified certificate, no redirects, time and size limits)

### E42-07 Build and test in continuous integration; release asset; proof on a real Windows Server

**Status:** in progress · **Priority:** P1 · **Type:** quality · **Implemented in:** `.github/workflows/windows-installer.yml`, `tools/installer/test-install.ps1`.

**Acceptance criteria**

- [x] A workflow builds the installer on `windows-latest`, installs it silently, checks the service and `/api/ready`, signs in, upgrades to a version-bumped build checking the data survives, forces a failed upgrade and checks the rollback, refuses an older installer, and uninstalls checking the data is kept
- [x] On a version tag the tested installer and `SHA256SUMS.txt` are attached to the GitHub release
- [x] The same test script passed on a Windows 11 workstation (domain-joined, with endpoint protection), elevated by a person at the UAC prompt
- [ ] The workflow has run green on GitHub (it needs a push)
- [ ] On a real Windows Server: install through the pages by hand, restart the machine and see the service come back, HTTPS with a real certificate reached from another computer through the firewall rule, an upgrade between two published releases

### E42-08 Installer hardening: folders made in advance, the program folder's permissions, service privileges, links

**Status:** done · **Priority:** P1 · **Type:** security · **Found by:** the wave 23 security review (S2 high, S3 medium, S4 low) · **Implemented in:** `deploy/windows/grc-windows.ps1` (`prepare`, `Protect-DataFolder`, `Protect-ProgramFolder`, `Find-UntrustedItems`, `Assert-AdminOnly`, `Read-State`, `Set-ServicePrivileges`, `Remove-TreeSafely`, `GRC_*`-only `Read-EnvFile`), `deploy/windows/SandpiperService.cs` (`GRC_*`-only settings), `tools/installer/sandpiper-grc.iss` (`prepare` before files are copied, the refusal reason shown, `recover` run from the installer's temporary folder), `tools/installer/test-install.ps1` (steps 0 and 8 and the permission checks), `.github/workflows/windows-installer.yml`.

Any user may create folders in `C:\ProgramData` (and directly under `C:\`), so before this a user
without administrator rights could make the data folder before an installation, with a `grc.env`
holding `NODE_OPTIONS` and a secret key they knew, and keep ownership of it: their code then ran as
the service and, through Back up now and upgrades, as an administrator. A program folder outside
Program Files inherited "Authenticated Users: Modify" from `C:\`.

**Acceptance criteria**

- [x] A data folder or program folder that exists (new installation, reinstallation, every upgrade) is used only if every item in it belongs to SYSTEM, Administrators or TrustedInstaller (in `data`, `backups`, `logs`, `seed` also the service's account) and none is a junction or link; otherwise the installer stops before copying anything (exit code 7), names what it found and says how to proceed; an upgrade changes nothing and starts the service again
- [x] When the check passes, ownership goes to Administrators and every permission inside is reset to the inherited ones; the existing settings and key are kept
- [x] The program folder gets its own permissions wherever it is (SYSTEM and Administrators full, Users and the service read and run, nothing inherited), before the files are copied and again after an upgrade or rollback; a parent folder others could rename is reported in `setup.log`
- [x] Only `GRC_*` settings are read from `grc.env`, by the service host and by `grc-windows.ps1`; others are ignored and logged
- [x] `grc-windows.ps1` checks owner and permissions of the settings, `upgrade\state.json` and the program files before reading or running them elevated; `state.json` must name the installation's own folders; the installer's recovery runs its own copy of the script, never the one in the data folder
- [x] The service keeps only `SeChangeNotifyPrivilege` and `SeCreateGlobalPrivilege` (`sc.exe privs`; no `SeImpersonatePrivilege`), also after an upgrade of an older installation
- [x] `setup.log` is written to the data folder itself, which the service cannot change
- [x] Removing the data folder (and `upgrade\previous`) deletes junctions and links as links, never what they point to
- [x] The installer test covers a planted data folder and program folder, an install outside Program Files with permission checks, `NODE_OPTIONS` ignored, the privileges, a reinstallation refused while a junction is in the data folder, and `/REMOVEDATA=1` sparing a junction's target; it passed elevated on a Windows 11 workstation with folders planted by a user without administrator rights (2026-11-24)
