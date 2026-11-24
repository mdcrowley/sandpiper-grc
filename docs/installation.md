# Installation

Sandpiper GRC runs as a Windows service from an installer, in a container, or from source on
Windows, macOS or Linux. Pick one:

| Way | Best for | Needs |
|---|---|---|
| [Windows installer](#windows-installer) | The easiest way: a Windows server or PC, run as a service | Windows 10 or 11, or Windows Server 2016 or later, 64-bit; administrator rights |
| [Docker](#quick-start-with-docker) | Trying it out, and servers | Docker with Compose |
| [Windows](#windows) (from source) | One Windows machine, no administrator rights | Windows 10 or 11, 64-bit |
| [macOS](#macos) | One Mac | macOS 13.5 or later, Intel or Apple silicon |
| [Linux](#linux) | A workstation or a server | x64 or arm64, glibc (not Alpine) |

Then: [first sign-in](#first-sign-in), [sample data](#sample-data), [the organization
profile](#the-organization-profile), the [environment variables](#environment-variables) and
[what to set before a pilot](#settings-that-must-be-yours-before-a-pilot). To serve a team,
read [Server installation](#server-installation) too.

This is a **prototype**: read [Security](security.md) and [Known gaps](known-gaps.md) before
holding real data in it. The running application makes no outbound connections until an
administrator switches one on; internet access is needed during installation only.

## Windows installer

One file installs everything Sandpiper GRC needs, with no internet access: its own copy of
Node.js, the server, the web application and the packages it uses. The server runs as a Windows
service that starts at boot and restarts after a crash.

1. Download `SandpiperGRC-Setup-<version>.exe` and `SHA256SUMS.txt` from the
   [releases page](https://github.com/mdcrowley/sandpiper-grc/releases).
2. **Check the download.** The installer is not code-signed (signing costs money), so Windows
   SmartScreen says "Windows protected your PC" and names an unknown publisher. Before you go
   past that, compare the file's checksum with the one the release lists:

   ```powershell
   Get-FileHash .\SandpiperGRC-Setup-0.3.0.exe -Algorithm SHA256   # must equal the line in SHA256SUMS.txt
   ```

   If they match, select **More info**, then **Run anyway**. If they do not, delete the file.
3. Run it as an administrator and answer its pages:
   - **Port** (default 8080).
   - **Data folder** (default `C:\ProgramData\Sandpiper GRC`): the database, attached files,
     backups, logs, settings and the secret key, kept apart from the program files in
     `C:\Program Files\Sandpiper GRC`.
   - **HTTPS certificate** (optional): a certificate and its private key as PEM files. Without
     them the server listens on this computer only (`http://localhost:<port>`); with them it
     listens on every address, over HTTPS. To serve a team without a certificate here, put a
     [reverse proxy](#reverse-proxy) in front later.
   - **Windows Firewall** (only with a certificate): open the port on domain and private
     networks.
   - **Shortcuts**: a "Sandpiper GRC" Start menu folder (on by default) and a desktop shortcut.
4. The installer sets up the service, starts it, waits until `/api/ready` answers and offers to
   open the browser. There you create the first administrator in the [setup wizard](#first-sign-in).
   With the firewall opened, do that straight away: until then anyone who can reach the port could.

**What it sets up.**

| What | Where |
|---|---|
| Program files: `node\node.exe`, `app\` (server, web application, packages), `SandpiperService.exe`, `grc-windows.ps1`, `sandpiper.cmd` and `sandpiper.ps1` | `C:\Program Files\Sandpiper GRC` |
| Data (`GRC_DATA_DIR`), backups (`GRC_BACKUP_DIR`), seed folder (`GRC_SEED_DIR`) | `data\`, `backups\`, `seed\` in the data folder |
| Logs: `grc.log` (the server's own), `service.log` (the service and the server's console) | `logs\` in the data folder |
| The setup log: every install, upgrade, rollback and removal | `setup.log` in the data folder itself, where the service cannot write |
| Settings, read by the service at every start | `config\grc.env` in the data folder (`KEY=VALUE` lines, the [environment variables](#environment-variables); only `GRC_*` lines are read) |
| The secret key, 32 random bytes made at install time | `config\secret.key` in the data folder (`GRC_SECRET_KEY_FILE`) |
| The service | `SandpiperGRC` ("Sandpiper GRC"), automatic start, restarted after a failure, running as its own virtual account `NT SERVICE\SandpiperGRC` |
| Where the installation is recorded | `HKLM\SOFTWARE\Sandpiper GRC\SandpiperGRC` |

The data folder does not inherit the permissions of `C:\ProgramData`: only SYSTEM and
Administrators have access, and the service's virtual account may change `data`, `backups`,
`logs` and `seed` and read `config`. The secret key file is readable by SYSTEM, Administrators
and the service only. The program folder has its own permissions too, wherever it is: SYSTEM and
Administrators have full control, Users and the service may read and run the files, and nothing
is inherited from the folder above (a new folder directly under `C:\` would otherwise let every
signed-in user change it). Both folders belong to Administrators. The service account has no password, no rights anywhere else, and only
the privileges `SeChangeNotifyPrivilege` and `SeCreateGlobalPrivilege` (without
`SeImpersonatePrivilege`, which code taking over a service could use to become SYSTEM); it can
read a certificate and key you named, and the installer grants it exactly that. Where a domain policy sets "Log on as a service" without the virtual accounts (Windows allows them by default), the service runs as Network Service instead and keeps its own service identity, so the same folder permissions apply; `setup.log` says so.

**A folder that already exists.** Any user may create folders in `C:\ProgramData`, and in a folder
directly under `C:\`, so a data folder or program folder that is already there may have been
prepared by someone else, with settings or a secret key of their choosing. Before the installer
uses either (a new installation, a reinstallation over a kept data folder, and every upgrade), it
checks every item in it: each must belong to SYSTEM, Administrators or TrustedInstaller (in `data`,
`backups`, `logs` and `seed` also the service's own account), and none may be a junction or
symbolic link. If anything fails the check, the installer stops before copying anything (exit
code 7 when silent; an upgrade changes nothing and starts the service again) and names what it
found. If you did not make the folder, delete it or choose another one. If you made it yourself
without administrator rights (from an ordinary Explorer window, for example) and have checked what
is in it, give it to Administrators and run the installer again:

```powershell
takeown /F "C:\ProgramData\Sandpiper GRC" /A /R /D Y
```

When the check passes, the installer resets every permission inside the folder to the inherited
ones, so no other entry is left, and keeps the existing settings and secret key. In `config\grc.env`
only `GRC_*` lines are read, by the service and by every command the installer and the management
scripts run as administrator; any other line, such as `NODE_OPTIONS` or `PATH`, is ignored and
named in `logs\service.log` and `setup.log`.

**Silent installation**, from an administrator's command prompt:

```powershell
.\SandpiperGRC-Setup-0.3.0.exe /VERYSILENT /SUPPRESSMSGBOXES /LOG=setup-log.txt `
  /PORT=8080 /DATADIR="D:\Sandpiper GRC" /TLSCERT=C:\certs\grc.pem /TLSKEY=C:\certs\grc-key.pem /FIREWALL=1
```

`/DIR=` changes the program folder and `/TASKS="startmenu,desktopicon"` the shortcuts. Exit
code 0 means the service is running and ready; 7 that the installer stopped before copying
anything (a [folder that already exists](#windows-installer) failed the check, or an upgrade could
not start; the reason is in the `/LOG` file); 11 that it was installed but did not become
ready (see `logs\service.log`); 12 that an upgrade failed and was undone; 13 that undoing it did not
finish. A program folder outside `C:\Program Files` is locked down the same way, but the folder
above it must be one only administrators can rename or change (the installer warns in `setup.log`
when it is not).

**Managing it.** The Start menu folder has **Open Sandpiper GRC**, **Server status**, **Start
server**, **Stop server**, **Restart server**, **Back up now**, **Check for updates**, **Open
logs folder** and **Uninstall Sandpiper GRC**. The same commands work in a command prompt as
`"C:\Program Files\Sandpiper GRC\sandpiper.cmd" status` (and `start`, `stop`, `restart`,
`backup`, `check-update`, `logs`, `open`); see [Operations](operations.md#windows-service-installed-by-the-installer).

**Upgrading and removing.** Run a newer installer over the installed one: it backs up the data,
replaces the program, updates the database and starts the service, and puts the previous
version back by itself if anything fails. An older installer refuses to run over a newer
version. Uninstalling (Settings > Apps, or the Start menu) removes the program and the service
and keeps the data folder unless you check the box to delete it. Details:
[Operations](operations.md#windows-service-installed-by-the-installer).

The workflow "Windows installer" builds the installer on a clean Windows Server runner and, as an
administrator there, refuses a data folder and a program folder planted by another account,
installs it silently outside Program Files and checks both folders' permissions and the service's
privileges, signs in, backs up, upgrades to a newer build, refuses an older one, rolls back a
broken upgrade, uninstalls, reinstalls over the kept data, and removes the data without following
a junction in it; the same test passed on a Windows 11 workstation. A real Windows Server restart and an install clicked through by a person are still to
be done ([E42](roadmap/epics/E42-windows-installer.md)). Other
platforms install [from source](#macos) or with [Docker](#quick-start-with-docker); installers
for them may follow and would reuse the same pieces.

## Quick start with Docker

```sh
git clone https://github.com/mdcrowley/sandpiper-grc.git && cd sandpiper-grc
docker compose up -d
docker compose ps        # wait until app is "healthy"
```

Open <http://127.0.0.1:8080> and complete the [setup wizard](#first-sign-in). Sample data:

```sh
docker compose stop app && docker compose run --rm app grc seed --profile dev && docker compose start app
```

Configuration, volumes, backups, the secret key, upgrades, PostgreSQL and HTTPS for the
container are in [Docker](docker.md).

## Windows

From source, for one machine: no administrator rights, no Docker and no database server. Everything goes through
`grc.ps1` in Windows PowerShell 5.1 (included with Windows), and Node.js is a portable copy
inside the repository folder.

### 1. Put the portable Node.js in `.tools\node`

From the repository folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\install-node.ps1
```

The script reads the Node.js major version from `tools\node-version.txt` (the one place it
is pinned; continuous integration and the container image follow it), downloads
`SHASUMS256.txt` for the newest release of that major version from nodejs.org, then the
Windows x64 zip named in it, checks the zip's SHA-256 against the list (and installs nothing
on a mismatch), and extracts it so that `.tools\node\node.exe` exists. It contacts nodejs.org
only. If Node.js is already there it says so and changes nothing; `-Force` replaces it with
the newest release of the same major version (stop the server first), `-Mirror <url>` uses a
copy of the Node.js downloads inside your network, and `-Destination <folder>` puts it
somewhere else.

The script does not check the OpenPGP signature of the checksum list. To do that too, or to
install by hand: download `node-v24.x.y-win-x64.zip` and `SHASUMS256.txt` (and
`SHASUMS256.txt.asc`, which GnuPG checks against the Node.js release keys) from nodejs.org,
compare `Get-FileHash .\node-v24.x.y-win-x64.zip -Algorithm SHA256` with the line for that
file, then:

```powershell
New-Item -ItemType Directory -Force .tools | Out-Null
Expand-Archive .\node-v24.x.y-win-x64.zip -DestinationPath .tools
Rename-Item .tools\node-v24.x.y-win-x64 node
Test-Path .tools\node\node.exe    # must print True
```

`grc.ps1` stops with "Portable Node.js is missing from .tools\node" until it is in place.

### 2. Install the packages and start

```powershell
.\grc.ps1 install
.\grc.ps1 start
```

The first start builds the web application, creates the `data\` folder and the database,
and prints `Sandpiper GRC is running at http://127.0.0.1:8080`. Open that address. To use
passkeys on this machine, open `http://localhost:8080` instead (browsers refuse passkeys at
an IP address).

Continuous integration follows these steps on a clean Windows machine for every change
(job "Install and run with grc.ps1"): `install-node.ps1`, `.\grc.ps1 install`, then
`start`, `health`, `seed -Profile dev`, `backup`, `verify-backup`, `status`, `logs` and
`stop`, each run in Windows PowerShell 5.1, and `schedule-backup`, a run of the scheduled
task and `unschedule-backup`.

### If the script is blocked

Windows may refuse to run scripts ("running scripts is disabled on this system"). Any one of
these works without administrator rights:

```powershell
powershell -ExecutionPolicy Bypass -File .\grc.ps1 start    # one command
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass  # this window only
Unblock-File .\grc.ps1                                       # files from a downloaded zip
```

## macOS

Everything goes through `grc.sh`, the counterpart of `grc.ps1`. It uses Node.js from
`.tools/node` when that exists, otherwise the `node` on your `PATH`, and checks that the
major version matches `tools/node-version.txt` (24).

### 1. Node.js

Either one:

- **The pinned copy in the repository folder** (no administrator rights, nothing installed
  system-wide):

  ```sh
  ./tools/install-node.sh
  ```

  It downloads the newest Node.js 24 for macOS and your processor (x64 or arm64) from
  nodejs.org, checks it against the published `SHASUMS256.txt`, and unpacks it into
  `.tools/node`. `--force` replaces an existing copy, `--mirror <url>` uses a mirror inside
  your network.
- **Homebrew**: `brew install node@24`. That formula is not linked into your `PATH` by
  default; add `export PATH="$(brew --prefix node@24)/bin:$PATH"` to `~/.zprofile` and open a
  new terminal. `node --version` must print `v24.x.y`.

### 2. Install the packages and start

```sh
./grc.sh install     # npm install (and the pinned Node.js, if no suitable one is found)
./grc.sh start
```

Open <http://127.0.0.1:8080> (or `http://localhost:8080` for passkeys). Every `grc.ps1`
command has a `grc.sh` equivalent; options are written `--profile dev` or `-Profile dev`
([Operations](operations.md#commands)). `./grc.sh` with no command lists them.

If the files came from a downloaded zip and macOS says "permission denied", run
`chmod +x grc.sh tools/install-node.sh` once, or start them with `sh`.

### macOS service

To keep it running, starting when you sign in and after a crash:
`./grc.sh service install` writes a launchd agent for your account
(`~/Library/LaunchAgents/org.sandpiper-grc.server.plist`) with the settings in force and
starts it; `./grc.sh service remove` takes it away ([Operations](operations.md#running-as-a-service-on-linux-and-macos)).
For a Mac that serves a team, `deploy/launchd/` has a system daemon run by its own role
account, and a daily backup; the comments at the top of each file give the commands.

## Linux

The same as macOS: `grc.sh` with Node.js 24 from one of

- `./tools/install-node.sh` (the pinned copy in `.tools/node`; x64 or arm64; needs `curl` or
  `wget`, `tar` and `sha256sum`),
- your distribution's packages, if they provide Node.js 24 (`node --version`), or the
  NodeSource packages,
- or nvm (`nvm install 24 && nvm use 24`).

```sh
./tools/install-node.sh   # unless Node.js 24 is already installed
./grc.sh install
./grc.sh start
```

`./grc.sh start` runs the server in the background for the current user, for one person on
one machine. `./grc.sh service install` makes that a systemd **user** service, which
starts when you sign in (at boot with `loginctl enable-linger`) and restarts after a crash
([Operations](operations.md#running-as-a-service-on-linux-and-macos)). On a server, run it
as a **system service** instead, so it starts at boot and
restarts after a failure. `deploy/systemd/` has a service unit (with sandboxing, a state
directory under `/var/lib/sandpiper-grc` and settings in `/etc/sandpiper-grc/env`) and a
daily backup timer; the comments at the top of each file give the commands:

```sh
sudo git clone https://github.com/mdcrowley/sandpiper-grc.git /opt/sandpiper-grc && cd /opt/sandpiper-grc
sudo ./tools/install-node.sh && sudo ./grc.sh install && sudo ./grc.sh build
sudo useradd --system --home-dir /var/lib/sandpiper-grc --shell /usr/sbin/nologin sandpiper
sudo install -d -m 750 -o root -g sandpiper /etc/sandpiper-grc
sudo install -m 640 -o root -g sandpiper /dev/null /etc/sandpiper-grc/env   # your GRC_* settings
sudo cp deploy/systemd/sandpiper-grc*.service deploy/systemd/sandpiper-grc-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sandpiper-grc sandpiper-grc-backup.timer
journalctl -u sandpiper-grc -f
```

The server's own log, one line per request, is `/var/lib/sandpiper-grc/data/logs/grc.log`
(`sudo -u sandpiper GRC_DATA_DIR=/var/lib/sandpiper-grc/data ./grc.sh logs`).

The unit listens on `127.0.0.1:8080` and trusts a reverse proxy on the same machine; add the
proxy of [Reverse proxy](#reverse-proxy) in front of it.

These steps, with the backup timer and a user service beside them, were followed as written in
a Debian 12 container running systemd and checked again after a restart of the container
([Operations](operations.md#running-as-a-service-on-linux-and-macos)); a restart of a real
machine has not been tested yet.

## First sign-in

While no user exists, the application shows a **setup wizard**. It creates the first
administrator: username, email address, name and password. There is **no default account**
and no default password.

- Username: 3 to 64 letters, numbers, dots, dashes or underscores.
- Password: at least 14 characters, not on the built-in list of common passwords, and not
  containing the username.

The wizard works once. Its last choice is the second factor: by default it is **required**
for the roles that carry "Members must use a second factor" (Administrator and Security lead
to begin with), and you are taken straight to setting up your own. **Only remind people for
now** leaves it as a reminder; switch it to Required before real records go in.

After the wizard, everything else is done in the application. The
[Administration](user/09-administration.md) page of the user guide has the detail:

- **Users**: Administration > Users. A new user gets a one-time setup link (valid for 24
  hours), emailed when outgoing email is set up, otherwise passed on by the administrator
  ([Users](user/09-administration.md#users)).
- **Roles**: the roles supplied, what each may do, and roles of your own
  ([Roles and permissions](user/09-administration.md#roles-and-permissions)).
- **Second factor**: who must use one, Off, Reminder or Required, and a grace period
  ([Second factor](user/09-administration.md#second-factor)). Single sign-on and the
  break-glass account are under [Sign-in providers](user/09-administration.md#sign-in-providers-single-sign-on).
- **Lists**: the values of every status, category and other drop-down
  ([Lists](user/09-administration.md#lists)).
- **Organization and settings**: names, contacts, logo and colors
  ([Organization](user/09-administration.md#organization)); sessions, passwords, outbound
  connections, retention and files ([Settings](user/09-administration.md#settings)); which
  parts of the application are switched on ([Features](user/09-administration.md#features)).

<a id="5-load-data"></a>

## Sample data

`seed` loads data. It is safe to run more than once: it adds what is missing and does not
overwrite what people have changed. If the server is running, `grc.ps1` and `grc.sh` stop
it, load the data and start it again.

```powershell
.\grc.ps1 seed -Profile dev          # Windows
```

```sh
./grc.sh seed --profile dev          # macOS and Linux
docker compose stop app && docker compose run --rm app grc seed --profile dev && docker compose start app   # Docker
```

The `dev` profile loads invented sample data for a bus and light-rail operator in every
module and needs no files. Sample records are labeled `[Sample]` where they could be
mistaken for real ones. Complete the setup wizard first: some sample records are assigned
to existing active users, and a seed run before any user exists leaves them unassigned.

## The organization profile

The `pilot` profile (the default: `seed` with no profile) reads your private `seed/` folder
(`GRC_SEED_DIR`). The folder must exist; every file in it is optional, and a missing file is
skipped and named in the output. `seed/` is git-ignored: never commit it.

```sh
mkdir -p seed
cp examples/organization.example.json seed/organization.json
# edit seed/organization.json, then:
./grc.sh seed            # or .\grc.ps1 seed
```

(An older `seed/organisation.json` is still read when `organization.json` is not there.)

Be aware of two things:

- The pilot profile **also adds invented sample records** (service desk tickets, problems
  and knowledge articles, projects, risks, assets and one security incident, all labeled
  `[Sample]` or clearly invented), because those modules have no import file. Delete them
  in the application when you no longer want them.
- Without `csf_subcategory_designations.csv` the framework is created with its functions
  and categories but **no outcomes**. Add outcomes on the framework page, supply the file,
  or use the `dev` profile.

### `seed/organization.json`

A JSON object. Every section is optional. An invented example is in
[`examples/organization.example.json`](../examples/organization.example.json).

The organization's details in it (names, address, contacts, colors and logos) are **only an
optional, one-time import** into the settings under **Administration > Organization**: each is
written only where nothing is stored yet, so a later seed never overwrites what an administrator
has changed, and you may leave them out and enter everything in the application instead. The
`dev` profile fills them with an invented example organization.

| Field | Purpose | Behavior |
|---|---|---|
| `appName` | The name shown in the application | Applied only if no name has been set yet. Change it later under Administration > Organization |
| `name`, `legalName`, `shortName` | The organization's names | Each applied only if not set yet; afterward they live in the application (Administration > Organization) |
| `address` | `{ "street": [up to three lines], "city", "region", "postalCode", "country" }`, all optional | As above |
| `phone`, `email`, `website` | General contacts | As above. Checked as in the application; a value that is not allowed is skipped and named in the output |
| `securityContact` | `{ "phone", "email" }`, printed in the offline incident kit | As above |
| `branding` | `{ "primaryColor": "#rrggbb", "accentColor": "#rrggbb", "logo": "file.png", "logoDark": "file.png" }`; logo files sit directly in the `seed/` folder (PNG, JPEG or WebP, up to 512 KB) | As above |
| `lookups` | Extra values for any configurable list, as `{ "<list key>": [ { "value", "label", "color"?, "sort"?, "meta"? } ] }` | Adds values that do not exist. Never changes an existing value |
| `obligations` | Entries for the obligations register | Each needs `title`; optional `source`, `requirement`, `how_met`, `evidence`, `next_due_on` (`YYYY-MM-DD`). Matched by title: an existing or deleted obligation is never changed or recreated |
| `notificationRules` | Who must be told about a security incident, and by when | See below |

Each notification rule has:

| Field | Meaning |
|---|---|
| `key` | Unique identifier. Required |
| `trigger` | When the rule applies: `any`, `is_cyber_incident`, `personal_info_involved`, or `kind:<value>` for a kind of data, where `<value>` is a value of the `incident_data_kind` list (add your own kinds under `lookups` in the same profile). The former names `health_data_involved` and `card_data_involved` are still accepted and are read as `kind:health_information` and `kind:payment_card_data`. Required |
| `party` | Who must be notified. Required |
| `hours` | Deadline in hours from discovery, from `0` (immediately) to `8784`, or `null` for no deadline yet |
| `required` | `true` unless set to `false` |
| `active` | Defaults to `true` when `hours` is set, otherwise `false`. An active rule must have `hours` |
| `guidance` | Free text shown with the task |

A rule is added only when no rule with the same `key` exists; an existing rule is left
exactly as it is. The application ships seven starter rules, all inactive and without
deadlines, with the keys `national_cyber_agency`, `data_protection_regulator`,
`data_sharing_partners`, `insurer`, `affected_individuals`, `transport_oversight` and
`funding_partners`. **A profile rule that reuses one of those keys is skipped.** Either give your rules different keys, or edit the starter
rules in the application. An invalid rule makes the security incidents part of the seed
fail with a message naming the rule.

Deadlines and recipients depend on your law, regulators, contracts and insurer. Set them
yourself, with legal advice. The example file shows the three shapes a rule can take: an
active rule with a deadline (`example_cyber_agency`, 72 hours), one that applies at once to
one kind of data (`example_card_acquirer`, `hours: 0`), and an inactive placeholder still
waiting for its deadline (`example_cyber_insurer`).

### Optional import files

Plain text, UTF-8, first line is the header. Columns are found by header name, so their
order does not matter, but the header text must match exactly unless noted. The parser is
simple: there is no quoting, so a cell cannot contain the delimiter or a line break. Blank
lines are ignored.

| File | Delimiter | Loads | Header row |
|---|---|---|---|
| `sites.psv` | `\|` | Sites | `Site\|Address\|Function\|Technology known to be there\|Power and physical protection\|Others on site\|To confirm` |
| `data_categories.psv` | `\|` | Data categories | `Data category\|What it contains\|Where held\|Custodian (role)\|Shared with\|Rule or agreement that applies\|Retention found\|Gaps` |
| `systems.psv` | `\|` | Systems | `System\|Group\|Vendor\|What it does\|Main users\|Hosting\|Status and outlook\|Sensitive data held\|Agreement on file\|Source\|To confirm` |
| `vendor_contracts.psv` | `\|` | Vendors, one contract per vendor, clause checks and follow-up actions | `Vendor\|Service\|Criticality (proposed)\|Document on file\|Date and resolution\|Term and renewal\|Value\|Hosting\|Terms not on file\|Action` plus the clause columns `Data ownership and return\|Named security standard\|Breach notice\|Service levels and recovery\|Liability cap\|Cyber insurance required` |
| `csf_subcategory_designations.csv` | `,` | Which framework outcomes exist, and which are priorities | An identifier column named `id` (or `identifier` or `subcategory`) and a rating column named `focus_area_ratings` (or `designation` or `rating`) |
| `csf_target_profile.psv` | `\|` | Target profile for the outcomes, and a "Baseline" snapshot | `ID\|Outcome\|Evidence\|Target\|FirstAction\|AlsoSatisfies\|Phase\|Status` |
| `information_requests.psv` | `\|` | Actions with the source "information request" | `ID\|Dept\|Item\|Why\|Feeds\|Form\|Priority\|IfNone` |
| `vehicles.psv` | `\|` | Vehicles | `Fleet number\|Mode\|Status\|Make\|Model\|Model year\|Registration\|Depot\|In service since\|Capacity\|Funding source\|Funder interest (%)\|Notes` |
| `services.psv` | `\|` | Services (routes and lines) and the systems each depends on | `Route\|Name\|Mode\|Service type\|Status\|Depot\|Description\|Systems\|Notes` |

Notes on each file:

- **`sites.psv`, `data_categories.psv`, `systems.psv`**: rows are matched by name, so a
  second run updates rather than duplicates. For systems, hosting type and status are
  worked out from the `Hosting` and `Status and outlook` text only where the text is
  unambiguous, and only on first load. Systems are linked to data categories named in
  `Sensitive data held` and to sites whose `Technology known to be there` names the system.
- **`vendor_contracts.psv`**: one row per vendor. The first word of `Criticality (proposed)`
  is used when it matches a value in the vendor criticality list. Start and end dates are
  read from `Term and renewal` only in the form `1 March 2030 to 28 Feb 2031`; a notice
  period only in the form `90 days notice`; a total value only when the whole `Value` cell
  is one amount written with a dollar sign, such as `$12,500.00`. Everything else stays as
  text for a person to complete. A row whose `Action` cell is not empty, `none` or `n/a`
  creates a follow-up action. Systems whose vendor name matches are linked to the vendor.
- **`csf_subcategory_designations.csv`**: identifiers must look like `GV.OC-01`. A rating
  containing the letter `E` marks the outcome as a priority. Header names ignore case,
  spaces and underscores. Outcome text comes from the reference data shipped with the
  application; identifiers with no shipped text are listed in the output.
- **`csf_target_profile.psv`**: `ID` must match a loaded outcome. `Phase` and `Status` must
  match a value or label in the outcome phase and outcome status lists. Fields are filled
  only where still empty, and the status is set only the first time. `AlsoSatisfies` holds
  references to other frameworks separated by semicolons. Header names ignore case, spaces
  and underscores.
- **`information_requests.psv`**: `ID` and `Item` are required. `Priority` is used when it
  matches a value in the action priority list, otherwise `medium`. A row whose `ID` was
  loaded before is skipped.
- **`vehicles.psv`**: `Fleet number` and `Mode` are required. Rows are matched by fleet
  number (ignoring case), so a second run updates rather than duplicates, and an empty cell
  never clears a value already there. `Mode`, `Status` and `Funding source` must match a
  value or label of their list (for example `Bus` or `light_rail`, `In service`, `Grant`);
  a row with an unknown one is skipped. `Model year` is four digits, `In service since` a
  date such as `2019-03-01`, `Capacity` a number, and `Funder interest (%)` a number from 0
  to 100 (above 0 also sets the funder-interest flag). `Depot` is the name of a site, from
  `sites.psv` or already in the application; a depot that is not found is left empty and
  named in the output.
- **`services.psv`**: `Route` and `Name` are required, and rows are matched by `Route`.
  `Mode`, `Service type` and `Status` must match a value or label of their list (for
  example `Fixed route`, `Express`, `Running`). `Systems` names the systems the service
  depends on, separated by semicolons, each optionally followed by what for in brackets:
  `Example Dispatch (CAD/AVL); Example Fares (Fare collection)`. Without brackets the
  dependency is recorded as **Other**. A system or depot that is not found is named in the
  output and left out.
- `vehicles.psv` and `services.psv` find depots and systems by name, so the inventory files
  (`sites.psv`, `systems.psv`) in the same folder are loaded first. A row that cannot be
  loaded is skipped and named in the output with its line number; the other rows are
  still loaded.

The seed prints one line per module. A line starting `seed <module>: FAILED` means that
module's data was not fully loaded; fix the file and run the command again. In a container,
mount the folder for the run ([Docker](docker.md#your-organization-profile)).

## Environment variables

Set them before running `grc.ps1` (`$env:GRC_TIMEZONE = 'America/Chicago'`) or `grc.sh`
(`export GRC_TIMEZONE=America/Chicago`), in `.env` for Docker, or in
`/etc/sandpiper-grc/env` for the systemd service. They are read at every start; use the
same values for every command (`start`, `seed`, `backup`, `restore`, `upgrade` and the
rest). `.\grc.ps1 schedule-backup` writes the values in force into its scheduled task, and
`./grc.sh schedule-backup` into the lines it prints.

| Variable | Default | Purpose |
|---|---|---|
| `GRC_PORT` | `8080` | Port the server listens on |
| `GRC_HOST` | `127.0.0.1` | Address the server listens on. Any address other machines can reach (`0.0.0.0`, `::`, a network address) needs HTTPS or `GRC_ALLOW_INSECURE=1`; see [Server installation](#server-installation) |
| `GRC_DATA_DIR` | `./data` | Folder for the database, attached files, process id file and logs. `memory` gives a throwaway in-memory database, for tests only |
| `GRC_BACKUP_DIR` | `./backups` | Folder for backups, safety copies and (by default) exports. Point it at another disk to keep backups away from the data |
| `GRC_WEB_DIST` | `./dist/web` | Folder the web application is built into and served from |
| `GRC_SEED_DIR` | `./seed` | Folder the `pilot` seed profile reads |
| `GRC_TIMEZONE` | the machine's time zone (`UTC` in the container) | The organization's time zone, as an IANA name such as `America/Chicago`. Business hours, "today" and due dates are worked out in it. An unknown name stops the server at start |
| `GRC_CURRENCY` | `USD` | ISO 4217 code used to display money fields. Display only: no conversion is done |
| `GRC_SECRET_KEY` | not set | The key that encrypts authenticator keys and other stored secrets: 32 bytes, as 64 hex characters or base64. When not set, the key file below is used |
| `GRC_SECRET_KEY_FILE` | `<data folder>.secret.key`, **beside** the data folder (`/var/lib/sandpiper-key/secret.key` in the container) | Path of a file holding the key, generated on first start if missing. Keep it out of the data and backup folders |
| `GRC_SECRET_KEY_PREVIOUS` | not set | Retired keys, comma-separated, needed for one start after changing the key; see [Security](security.md) |
| `GRC_COOKIE_SECURE` | `off`; `auto` with HTTPS or a trusted proxy | `off`, `auto` or `always`: whether the session cookie is marked `Secure` |
| `GRC_TRUST_PROXY` | off | Which reverse proxies may set `X-Forwarded-For`, `-Proto` and `-Host`: addresses, CIDR ranges and the words `loopback`, `private`, `linklocal` and `gateway` (in a container: the Docker host, where a proxy in front of the published port connects from; the default in `compose.yaml`), or a number of proxy hops (only when nothing can reach the server except through them). Never set it without such a proxy, and prefer the proxy's own address to `private`, which also trusts every person on a private network |
| `GRC_TLS_CERT`, `GRC_TLS_KEY` | not set | PEM certificate (with any intermediate certificates after it) and private key files. When both are set the server speaks HTTPS itself |
| `GRC_ALLOW_INSECURE` | off | `1` allows plain HTTP on an address other machines can reach. Only behind a proxy that terminates HTTPS |
| `GRC_HSTS_MAX_AGE` | `31536000` (one year) | `Strict-Transport-Security` max-age on HTTPS responses. `0` switches the header off |
| `GRC_HSTS_INCLUDE_SUBDOMAINS` | off | `1` adds `includeSubDomains`. Only if every name under the domain is served over HTTPS |
| `GRC_WEBAUTHN_RP_ID`, `GRC_WEBAUTHN_ORIGINS` | the request's address | Passkeys: the host name, and the comma-separated origins, people use |
| `GRC_DATABASE_URL` | not set (embedded database) | A PostgreSQL connection string, `postgres://user@host:5432/dbname`. `GRC_DATABASE_URL_FILE` names a file holding it |
| `GRC_DATABASE_PASSWORD` | not set | The database password, replacing any in the URL. `GRC_DATABASE_PASSWORD_FILE` names a file holding it |
| `GRC_DATABASE_SSL` | as the URL's `sslmode` | `off`, `require` (encrypted, certificate not checked) or `verify` (encrypted and checked). `GRC_DATABASE_SSL_CA` names a PEM file of the certificate authority |
| `GRC_DATABASE_SCHEMA` | the server's default (`public`) | Schema the application's tables live in. Create it, owned by the application's role, beforehand |
| `GRC_DATABASE_POOL_MAX` | `10` | Most connections the server keeps open |
| `GRC_DATABASE_STATEMENT_TIMEOUT` | `120000` | Milliseconds a single statement may run. `0` for no limit |
| `GRC_DATABASE_IDLE_TX_TIMEOUT` | `300000` | Milliseconds a transaction may sit idle before the server ends it |
| `GRC_DATABASE_CONNECT_TIMEOUT` | `10000` | Milliseconds to wait for a new connection |
| `GRC_DATABASE_IDLE_TIMEOUT` | `30000` | Milliseconds an unused pooled connection stays open |
| `GRC_BACKUP_KEY_FILE`, `GRC_BACKUP_PASSPHRASE_FILE`, `GRC_BACKUP_PASSPHRASE` | not set | Key for encrypted backups and exports ([Operations](operations.md#encrypted-backups-and-exports)) |
| `GRC_S3_ACCESS_KEY_ID`, `GRC_S3_SECRET_ACCESS_KEY`, `GRC_S3_SESSION_TOKEN` | not set | Credentials for an S3-compatible object store for attached files, when not entered under Administration |
| `GRC_SEARCH_LANGUAGE` | `english` | PostgreSQL text-search configuration for full-text search |
| `GRC_JOBS` | on | `off` stops the background job poller in this process |
| `GRC_JOBS_POLL_MS` | `10000` | How often the job queue looks for due work |
| `GRC_MODULES` | all modules | Comma-separated module folder names to load. A development aid |
| `GRC_SKIP_NODE_CHECK` | off | `1` lets `grc.sh` run with a Node.js major version other than the pinned one |
| `GRC_DATABASE_MIGRATE_URL` | not set | The **owner** account's connection string for a least-privilege set-up: migrations run as it, and the server itself as the account in `GRC_DATABASE_URL` ([below](#a-least-privilege-database-role)). `_FILE` names a file holding it; `GRC_DATABASE_MIGRATE_PASSWORD` (or `_FILE`) its password |
| `GRC_DATABASE_APP_ROLE` | the user in `GRC_DATABASE_URL` | The role granted the run-time privileges after migrations |
| `GRC_TLS_RELOAD_SECONDS` | `60` | How often the certificate files are looked at for a renewal. `0`: only on `SIGHUP` (Linux, macOS) |
| `GRC_LOG_LEVEL` | `info` | `error`, `warn`, `info` or `debug` ([Operations](operations.md#logs)) |
| `GRC_LOG_DIR` | `<data folder>/logs` | Folder of the server's log `grc.log`; `off` writes no file |
| `GRC_LOG_MAX_MB`, `GRC_LOG_FILES` | `10`, `5` | Size at which the log is rotated, and how many old files are kept |
| `GRC_LOG_CONSOLE` | `text` (`json` in the container) | What the console gets: `text` (start-up line, warnings, errors), `json` (every entry) or `off` |
| `GRC_LOG_REQUESTS` | on | `off` leaves out the line per request |
| `GRC_COMMIT` | the git checkout's commit | The commit shown with the version; the container image has it built in |
| `GRC_PDF_FONTS` | well-known system fonts | Font files for PDF text outside Western European, `;`-separated on Windows and `:` elsewhere; `file.ttc#PostScriptName` picks one font of a collection; `none` switches it off ([Operations](operations.md#fonts-for-pdf-exports)) |
| `GRC_SLOW_QUERY_MS` | not set | Log database statements taking this many milliseconds or more (their text only, never their values) |
| `GRC_STARTUP_WARN_MS` | `2000` | Log a start-up step that takes longer than this many milliseconds, named after where it was added |
| `GRC_STARTUP_TIMEOUT_SECONDS` | `600` | How long one start-up step may take before the start is abandoned (at least `10`). Rebuilding a search index after an upgrade grows with the data |
| `GRC_FIGURES_CACHE_SECONDS` | `10` | How long the Overview's figures are kept while nothing is written (at most `300`); `0` switches the cache off ([Operations](operations.md#performance-and-load-testing)) |
| `GRC_ANALYZE_AFTER_WRITES` | `2000` | Embedded database only: refresh the query planner's statistics after this many writes (at most every ten minutes); `0` switches it off |
| `GRC_SERVICE_NAME` | `sandpiper-grc` | Name of the user service `./grc.sh service install` writes |

Two more are read by the MCP bridge (`tools/mcp-stdio.mjs`), not the server: `GRC_URL` and
`GRC_TOKEN` ([MCP](mcp.md)). `GRC_TEST_DATABASE` and `GRC_TEST_DATABASE_URL` are for the test
suite only ([Developer guide](development.md)).

Limits to know about:

- `dev` proxies the web development server to port 8080, so leave `GRC_PORT` at its default
  when using `dev`.
- Decide the time zone before recording real data. Changing it later changes how existing
  times are displayed and how deadlines are worked out.

## What is created on disk

| Path | Contents | Committed? |
|---|---|---|
| `.tools/node/` | Portable Node.js (`install-node.ps1` or `install-node.sh`) | No |
| `node_modules/` | npm packages | No |
| `dist/web/` | The built web application | No |
| `data/` | Database (`data/pg`), attached files (`data/files`), the server's log (`data/logs`), `grc.pid`, `grc.lock` (the one process using the folder), `server.log`, `server.log.err` | No |
| `data.secret.key` (beside `data/`) | The secret key, unless supplied another way. Not in backups: back it up separately | No |
| `seed/` | Your organization profile and import files | No, never |
| `backups/` | Backups, safety copies made by `restore`, exports, copies of the code for `upgrade`, and the scheduled backup log | No |

## Before you rely on it

### Settings that must be yours before a pilot

The application ships with neutral starting values, not your organization's. Before a pilot
holds real records, an administrator must set at least these, because no built-in value can
be right for you:

- **Incident notification rules.** Every starter rule is inactive and has no deadline, so
  a security incident creates **no** notification tasks until you set them. Decide, with
  legal advice, who must be told and within how many hours under your law, contracts and
  insurance, then edit and switch on the rules under **Cybersecurity > Rules and
  checklists** ([Notification rules](user/07-security-incidents.md#notification-rules-checklists-and-contacts)),
  or load them from the [organization profile](#seedorganizationjson).
- **Service-level targets.** The service desk's respond and resolve targets, business hours
  and holidays are generic examples. Set yours under the service desk settings
  ([Service-level targets](user/02-service-desk.md#service-level-targets)).
- **Risk scales.** The two supplied scales (a 5 by 5 grid and a safety hazard matrix), their
  level meanings and the rating that needs executive approval must match your risk
  management policy. Edit them under **Administration > Risk scales** before risks are
  scored ([Editing the risk scales](user/06-risks-actions-obligations.md#editing-the-risk-scales)).

Also decide the time zone (`GRC_TIMEZONE`, [above](#environment-variables)) and set the
second factor to **Required** ([First sign-in](#first-sign-in)).

### Backups and the key

Once the application holds anything you would not want to lose:

- Schedule backups: `.\grc.ps1 schedule-backup -At 02:00 -Prune 14` on Windows,
  `./grc.sh schedule-backup --at 02:00 --prune 14` (it prints a cron, systemd or launchd
  entry to add) on macOS and Linux, the backup timer in `deploy/systemd/` for the service,
  or [backups for Docker](docker.md#volumes-and-backups). The server can also take its own
  daily archives (Administration > Backups).
- Keep a copy of the [secret key](security.md) somewhere safe, apart from the backups.
- Carry out the [restore test](operations.md#restore-test) once, so you know the backups can
  be put back.

## Moving to another machine

Two ways, both described in [Operations](operations.md):

- **Same version, same kind of machine**: take a backup, copy its folder to the new
  machine's `backups/` folder, install as above, copy the secret key (`data.secret.key`,
  beside the data folder) beside the new data folder, then `restore <name>`. A backup taken
  with `-Encrypt -IncludeSecretKey` carries the key itself.
- **A different version, or a different database engine**: `export-all` on the old machine
  and `import-all <folder>` on a fresh installation that has not been through the setup
  wizard. Take the secret key across as well; see
  [Export and import](operations.md#export-and-import).

## Server installation

Everything above serves one person on one machine. To serve a team, three things change,
each switched on by an environment variable and each independent of the others: the
database moves to a PostgreSQL server, the connection is encrypted, and the server listens
on an address other machines can reach. [Docker](docker.md) and the
[systemd service](#linux) put them together.

Run **one** application process per database. Some timers and counters live in the
process's memory, so two copies against the same database would each run them
([Architecture](architecture.md#path-to-production)).

### PostgreSQL server

Without `GRC_DATABASE_URL` the application uses its embedded database in the data folder.
With it, the same SQL runs on a PostgreSQL server:

- **Version.** PostgreSQL 15 or later. No extensions are needed. Continuous integration runs
  the test suite against PostgreSQL 17.
- **Create a role and a database** (as a superuser, in `psql`). In the simplest set-up the
  application's role owns its database, because migrations create and change tables at
  start. [A least-privilege database role](#a-least-privilege-database-role) separates the
  two, and is recommended for production:

  ```sql
  create role grc login password 'choose-a-long-password';
  -- PostgreSQL 17 and later: byte-order sorting, the same as the embedded database
  create database grc owner grc encoding 'UTF8' template template0 locale_provider builtin builtin_locale 'C.UTF-8';
  -- PostgreSQL 15 and 16:
  -- create database grc owner grc encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C.UTF-8';
  ```

- **Point the application at it**, then start as usual. Migrations run at start-up:

  ```sh
  GRC_DATABASE_URL=postgres://grc@db.example.internal:5432/grc
  GRC_DATABASE_PASSWORD_FILE=/etc/sandpiper-grc/db-password   # or put the password in the URL
  GRC_DATABASE_SSL=verify                                      # a server on another machine
  GRC_DATABASE_SSL_CA=/etc/sandpiper-grc/db-ca.pem             # if its certificate is from a private authority
  ```

  The start-up line names the server (with the password hidden). If it cannot connect, the
  server stops at once and says why.
- **The data folder is still needed** for attached files, the process file and (unless
  `GRC_SECRET_KEY` or `GRC_SECRET_KEY_FILE` is set) the secret key file beside it.
- **Sessions.** Every connection is given the organization's time zone, the statement and
  idle-transaction timeouts and, if set, `GRC_DATABASE_SCHEMA`, so the server's own defaults
  do not matter.
- **Moving embedded data to a server.** `export-all` on the old installation; `import-all
  <folder>` on the new one, with `GRC_DATABASE_URL` pointing at an empty database and before
  the setup wizard. Take the secret key across.
- **Backups** are taken with the database server's own tools in this mode; see
  [Operations](operations.md#postgresql-server-backups).

### A least-privilege database role

When the account the server uses owns the tables, anyone who takes over the server process
could also remove the audit log's append-only trigger. Give the server an account that may
only read and write rows, and keep ownership with a second account used for migrations:

```sql
create role grc_owner login password 'owner-password';
create role grc_app   login password 'app-password';
create database grc owner grc_owner encoding 'UTF8' template template0 locale_provider builtin builtin_locale 'C.UTF-8';
```

```sh
GRC_DATABASE_URL=postgres://grc_app@db.example.internal:5432/grc               # the server runs as this
GRC_DATABASE_PASSWORD_FILE=/etc/sandpiper-grc/app-password
GRC_DATABASE_MIGRATE_URL=postgres://grc_owner@db.example.internal:5432/grc     # migrations run as this
GRC_DATABASE_MIGRATE_PASSWORD_FILE=/etc/sandpiper-grc/owner-password
```

- With `GRC_DATABASE_MIGRATE_URL` set, the server first builds the schema **as the owner**
  at every start (migrations and the search triggers), then **grants the run-time role**
  read and write on every table and sequence, no update or delete on the audit log, and only
  reading the migration list, and closes the owner's connection. It then runs as
  `grc_app`. `npm run cli -- migrate` (or `grc migrate`) does the same without starting
  the server, and `npm run cli -- grant-runtime-role` repeats only the grants.
- To keep the owner's password off the server altogether, leave `GRC_DATABASE_MIGRATE_URL`
  out of the server's settings and run `migrate` with it from an administrator's session
  after each upgrade. Started with migrations pending, the run-time account cannot apply
  them: the server stops with `... may not change the schema: run the migrations as the
  owner role`.
- `grc_app` owns nothing, so it cannot create, alter or drop tables or triggers (tested in
  `server/src/core/migrate.test.ts`, and in continuous integration against PostgreSQL 17).
- The run-time account never attempts a schema change (E16-37). The owner's run gives every
  record table the column that holds custom-field values, so **new custom fields** work at
  once. A change to what is searched (a new text custom field, or an upgrade) needs a search
  trigger rebuilt: the server records it in the `schema_requests` table and logs
  `[schema] waiting for the owner account: ...`, keeps searching that record type with its
  earlier trigger, and the owner's next run (the next start with `GRC_DATABASE_MIGRATE_URL`
  set, or `migrate`) rebuilds it from the application's own definitions and clears the
  request. Nothing stored in that table is ever run. A SECURITY DEFINER function was
  considered and not used: it would give the run-time account a standing way to change the
  schema. Tested in `server/src/ops/db-roles-runtime.test.ts` (embedded, wire protocol and
  PostgreSQL 17). `import-all` also runs as the owner when `GRC_DATABASE_MIGRATE_URL` is set.

### HTTPS

Plain HTTP is accepted only on the loopback address. Choose one of:

- **A reverse proxy terminates HTTPS** in front of the application (next section). This is
  the usual choice, and what the container and the systemd service expect.
- **The application serves HTTPS itself**, given a certificate and key in PEM files:

  ```sh
  GRC_HOST=0.0.0.0  GRC_PORT=8443
  GRC_TLS_CERT=/etc/sandpiper-grc/tls/fullchain.pem  GRC_TLS_KEY=/etc/sandpiper-grc/tls/privkey.pem
  ```

  Ports below 1024 need a privilege; use 8443 with a firewall redirect.

  **Renewing the certificate needs no restart.** The server looks at the two files every
  `GRC_TLS_RELOAD_SECONDS` (default 60) and, at once, on `SIGHUP` (`systemctl reload
  sandpiper-grc`, `docker compose kill -s HUP app`; Linux and macOS). A changed pair is
  checked (both PEM, the key belongs to the certificate) and used for new connections;
  connections already open carry on. A broken or half-written pair is refused with an error in
  the log (`The new TLS certificate was NOT loaded`) and the old certificate stays in use, so
  a renewal tool that writes the two files one after the other is safe.

Either way the session cookie is marked `Secure` and HTTPS responses carry
`Strict-Transport-Security`. Starting on a reachable address with neither a certificate nor
`GRC_ALLOW_INSECURE=1` stops with
`Refusing to serve plain HTTP on 0.0.0.0, which other machines can reach.`

For testing only, `npx tsx server/src/core/tls-selfsigned.ts ./data-certs` writes a
self-signed certificate valid for 30 days for `localhost`, `127.0.0.1` and `::1` (or the
names you give after the folder). Browsers warn on every visit; never use it for real users.

### Reverse proxy

A proxy such as Caddy, nginx, HAProxy or a cloud load balancer terminates HTTPS and passes
requests to the application over HTTP. Tell the application which proxy to believe, so that
client addresses (audit log, sessions, sign-in rate limits) and "was this HTTPS?" come from
its forwarded headers, and only from it:

| Where the proxy runs | Settings |
|---|---|
| Same machine | `GRC_HOST` unset (127.0.0.1), `GRC_TRUST_PROXY=loopback` (as the systemd unit does) |
| Another machine | `GRC_HOST=0.0.0.0`, `GRC_ALLOW_INSECURE=1`, `GRC_TRUST_PROXY=<the proxy's address or range>`, and a firewall so that only the proxy reaches the port |
| Containers | `GRC_TRUST_PROXY=gateway` for a proxy on the Docker host (as `compose.yaml` does), or the proxy container's own address ([Docker](docker.md#https-behind-a-reverse-proxy)) |

The proxy must **replace or append to** `X-Forwarded-For` (never pass on a value the browser
sent unchecked) and set `X-Forwarded-Proto`. With Caddy,
`grc.example.test { reverse_proxy 127.0.0.1:8080 }` is the whole configuration and obtains
the certificate itself. nginx:

```nginx
server {
  listen 443 ssl;
  server_name grc.example.test;
  ssl_certificate     /etc/ssl/grc/fullchain.pem;
  ssl_certificate_key /etc/ssl/grc/privkey.pem;
  client_max_body_size 30m;                    # above the largest attachment
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Keep `client_max_body_size` a few MB above **Largest file (MB)** under Administration > File
settings (25 MB to begin with): the upload carries some overhead, and nginx refuses a larger
request before the application sees it.

If people sign in with passkeys, set `GRC_WEBAUTHN_RP_ID` and `GRC_WEBAUTHN_ORIGINS` to the
address they type, and set the **Application address** (`auth.public_url`) under
Administration > Sign-in providers, on the **Redirect address** card, for sign-in providers
([Security](security.md)).

### Containers

See [Docker](docker.md): the published image, `compose.yaml` (embedded database) and
`compose.postgres.yaml` (with PostgreSQL), volumes, backups, the secret key and upgrades.

### Mail providers

Outgoing email (Administration > Email) is sent in one of three ways. Many mail services no
longer accept SMTP sign-in with a password; for those, use the service's web interface.

| Send through | For | The server connects out to |
|---|---|---|
| SMTP | Any mail server or relay | The mail server you enter |
| Microsoft Graph | Microsoft 365, Exchange Online | `login.microsoftonline.com` and `graph.microsoft.com` (GCC High: `login.microsoftonline.us` and `graph.microsoft.us`; DoD: `login.microsoftonline.us` and `dod-graph.microsoft.us`), port 443 |
| Gmail API | Google Workspace | `oauth2.googleapis.com` and `gmail.googleapis.com`, port 443 |

These addresses are fixed in the application, not taken from the settings or from a key file.
Calls use HTTPS only, follow no redirects and time out after 20 seconds. Nothing is sent
until email is switched on, apart from **Send a test message**. The secret, certificate or key is
kept encrypted with the installation's secret key, like the SMTP password, and is never shown again.
If you rotate the secret key, the old key must stay available as a retired key, or these
credentials must be entered again ([Security](security.md)).

**Microsoft Graph.** In the Microsoft Entra admin center:

1. **App registrations > New registration**: a single-tenant application with any name, such as
   "Sandpiper GRC mail". No redirect address is needed. Note the **Directory (tenant) ID** and
   **Application (client) ID**.
2. **API permissions > Add a permission > Microsoft Graph > Application permissions**: add
   **Mail.Send**, and also **Mail.ReadWrite** if email to ticket reads a mailbox through Graph.
   Select **Grant admin consent**.
3. **Certificates & secrets**: upload a certificate (recommended), or create a client secret and
   copy its **Value**. A self-signed certificate is fine, for example
   `openssl req -x509 -newkey rsa:2048 -nodes -keyout mail.key -out mail.crt -days 730 -subj "/CN=Sandpiper GRC mail"`.
   Upload `mail.crt`, and paste the contents of `mail.crt` and `mail.key` together into the
   application. Note the expiry date: the settings page shows it. A secret expires too, after at
   most two years.
4. Limit the application to the mailboxes it uses. Without a limit, the Mail permissions let
   it act on every mailbox in the tenant. In Exchange Online, use RBAC for Applications, or an
   application access policy
   (`New-ApplicationAccessPolicy -AppId <client id> -PolicyScopeGroupId <mail-enabled security group> -AccessRight RestrictAccess`).
5. In the application, choose **Microsoft Graph**, enter the IDs and the certificate or secret,
   and the **Send as mailbox**: a user or shared mailbox (by default, the from address). The from
   address must be that mailbox's address or one it has Send As permission for.

Graph takes one request of at most 4 MB. A larger message (up to the application's 10 MB limit
for files) is created as a draft, each file over 3 MB is uploaded through an upload session in
parts of 3,200 KiB (the upload address Graph returns must be a Microsoft one, and no access token
is sent to it), and the draft is sent; a draft left by a failed attempt is deleted. A draft cannot
carry `Auto-Submitted` or `References` headers, so their equivalents are used: the message keeps
its Message-ID, `References` and `In-Reply-To` are set through the properties Exchange writes them
from, and `X-Auto-Response-Suppress: All` and `X-GRC-Mail` stay as headers. The large-file upload
connects to the Outlook address Graph names (`outlook.office.com` or `outlook.office365.us`),
port 443.

**Gmail API.** A service account with domain-wide delegation. This was chosen over a person's
own sign-in (an OAuth refresh token) because it needs no browser sign-in and belongs to no one
person, so it does not stop working when someone leaves or changes their password. Your Workspace
administrator grants and withdraws it scope by scope. A personal Gmail account cannot use it; use
SMTP with an app password there.

1. In the Google Cloud console, in a project for this purpose: enable the **Gmail API**, create a
   **service account**, and create a **JSON key** for it (**Keys > Add key**). Organization
   policies may need to allow service account keys.
2. In the Google Admin console: **Security > Access and data control > API controls > Domain-wide
   delegation > Add new**. Enter the service account's client ID (shown on the settings page once
   the key is saved), with the scope `https://www.googleapis.com/auth/gmail.send`, and also
   `https://www.googleapis.com/auth/gmail.modify` if email to ticket reads a mailbox through
   the Gmail API.
3. In the application, choose **Gmail API**, paste the whole key file, and enter the **Send as
   mailbox**: a user in the domain (by default, the from address). Gmail sends from that mailbox's
   address unless the from address is one of its send-as addresses.

**When the test is refused**, the reason says what to fix:

| The test says | Fix |
|---|---|
| The directory (tenant) ID was not found, or the application (client) ID is not registered | Copy both again from the app registration's Overview page; check the Microsoft cloud |
| The client secret is wrong, or has expired | Enter the secret's Value (not its Secret ID), or create a new secret |
| The certificate was not accepted | Upload this certificate to the app registration |
| Permission missing: grant the Mail.Send application permission | Add the permission, grant admin consent, and include the mailbox in the application access policy |
| Domain-wide delegation is missing | Add the client ID and the scope named in the message in the Admin console (it can take some minutes to apply) |
| Wrong mailbox | Use the address of an existing user or shared mailbox (Microsoft) or user (Google) |
| Busy or throttled | Nothing to fix: the message is tried again later: after as long as the service asked (`Retry-After`, in seconds or as a date, or an SMTP reply such as "try again in 5 minutes"), at most an hour; otherwise after 1, 2, 4 and 8 minutes |

### Text messages for alerts

Urgent alerts (security incidents declared, notification clocks turning amber or red) can be sent
as text messages. No paid service is built in. Administration > Email > Text messages offers two
ways, used together or alone:

- **Email-to-text addresses.** The text is emailed, through the mail settings above, to each
  person's email-to-text address (a carrier's or messaging service's address that turns email into
  a text). Nothing else to set up.
- **A webhook to your own text-message system.** Each text is posted to the address you enter. It
  is an outbound connection with the same fences as webhooks: `integrations.outbound_enabled`
  must be on and the host on `integrations.allowed_hosts`; a host that resolves to a private
  address is refused unless that address is listed; redirects are not followed; the address must
  be https (plain http only to this machine, for a relay running beside the application). The
  signing secret is kept encrypted with the installation's secret key (with the mail credentials).

The webhook request:

```
POST <your address>
Content-Type: application/json
User-Agent: grc-text/1
X-GRC-Event: text.message
X-GRC-Delivery: <delivery id>
X-GRC-Timestamp: <seconds since 1970>
X-GRC-Signature: sha256=<hex HMAC-SHA256(secret, timestamp + "." + body)>

{ "type": "text_message", "id": "<delivery id>", "to": "+15550100123",
  "text": "Sandpiper GRC: security incident SEC-0042 needs attention: a notification deadline has passed. Open the app.",
  "purpose": "security", "test": false, "createdAt": "2026-11-19T14:05:00.000Z" }
```

`to` is the person's mobile number as digits with an optional leading `+`. `text` is at most 300
characters and never carries restricted detail. Check the signature and reject a timestamp more
than a few minutes old. Answer any 2xx when you have taken the message; 408, 429 and 5xx are tried
again (four attempts in all), and any other answer is final. Each text is listed in the email
delivery log with the provider **webhook**.

### Email to ticket

Email to ticket turns messages sent to a service desk address into tickets, and replies into
comments on them. It is off by default and is switched on by an administrator under
**Service desk > Settings > Email to ticket**, which shows each message received and what was
done with it. Outgoing email must be set up too (see [Email settings](user/14-attachments-and-notifications.md#email-settings)), for the
acknowledgments and for replies to reach the requester. Choose one of these ways for messages to
arrive:

- **The server reads a mailbox (POP3).** Use a mailbox kept for this alone: messages are
  deleted from it once they are handled, unless **Leave messages in the mailbox after reading them** is on. Port 995 with TLS, or 110 with STARTTLS. The server
  connects out to the mail server, so allow that connection.
- **The server reads a mailbox through Microsoft Graph or the Gmail API**, for a service that
  has switched POP3 sign-in off. It uses the sign-in saved under Administration > Email (see
  [Mail providers](#mail-providers)). Save the sign-in there even if outgoing email stays on SMTP. The Microsoft app needs
  **Mail.ReadWrite**, and the Google delegation needs `https://www.googleapis.com/auth/gmail.modify`.
  Unread messages in the inbox are read, at most 50 at a time. Once handled, each is moved to
  Deleted Items or Trash (or marked read, when left in the mailbox).
- **A mail relay posts each message.** The mail server (or a small relay script) sends every
  message for the service desk address, as the raw message (`content-type: message/rfc822`),
  to `POST /api/tickets/email/inbound` with the headers `X-GRC-Relay-Key: <key>` (created on
  the settings tab and shown once) and `X-GRC-CSRF: 1`. Messages up to 30 MB are taken; the
  answer is 202 once the message is stored.

Auto-replies, bounces, mailing lists, messages from the application's own address, repeated
messages and more than the hourly limit from one sender are ignored and logged. Attachments are
checked like any upload (type, content, malware scanner, size).

Next: [Operations](operations.md).
