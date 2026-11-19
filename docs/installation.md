# Installation

Sandpiper GRC runs in a container, or from source on Windows, macOS or Linux. Pick one:

| Way | Best for | Needs |
|---|---|---|
| [Docker](#quick-start-with-docker) | Trying it out, and servers | Docker with Compose |
| [Windows](#windows) | One Windows machine, no administrator rights | Windows 10 or 11, 64-bit |
| [macOS](#macos) | One Mac | macOS 13.5 or later, Intel or Apple silicon |
| [Linux](#linux) | A workstation or a server | x64 or arm64, glibc (not Alpine) |

Then: [first sign-in](#first-sign-in), [sample data](#sample-data), [the organization
profile](#the-organization-profile) and the [environment variables](#environment-variables).
To serve a team, read [Server installation](#server-installation) too.

This is a **prototype**: read [Security](security.md) and [Known gaps](known-gaps.md) before
holding real data in it. The running application makes no outbound connections until an
administrator switches one on; internet access is needed during installation only.

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

No administrator rights, no Docker and no database server. Everything goes through
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
.\grc.ps1 npm install
.\grc.ps1 start
```

The first start builds the web application, creates the `data\` folder and the database,
and prints `Sandpiper GRC is running at http://127.0.0.1:8080`. Open that address. To use
passkeys on this machine, open `http://localhost:8080` instead (browsers refuse passkeys at
an IP address).

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
one machine. On a server, run it as a **systemd service** instead, so it starts at boot and
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

The unit listens on `127.0.0.1:8080` and trusts a reverse proxy on the same machine; add the
proxy of [Reverse proxy](#reverse-proxy) in front of it.

## First sign-in

While no user exists, the application shows a **setup wizard**. It creates the first
administrator: username, email address, name and password. There is **no default account**
and no default password.

- Username: 3 to 64 letters, numbers, dots, dashes or underscores.
- Password: at least 14 characters, not on the built-in list of common passwords, and not
  containing the username.

The wizard works once. After that, administrators add users under Administration. A new
user gets a one-time setup link (valid for 24 hours), which the administrator passes on.
A new installation asks everyone to set up a second factor.

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

| Field | Purpose | Behavior |
|---|---|---|
| `appName` | The name shown in the application | Applied only if no name has been set yet. Change it later under Administration, Settings |
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
exactly as it is. The application ships five starter rules, all inactive and without
deadlines, with the keys `national_cyber_agency`, `data_protection_regulator`,
`data_sharing_partners`, `insurer` and `affected_individuals`. **A profile rule that reuses
one of those keys is skipped.** Either give your rules different keys, or edit the starter
rules in the application. An invalid rule makes the security incidents part of the seed
fail with a message naming the rule.

Deadlines and recipients depend on your law, regulators, contracts and insurer. Set them
yourself, with legal advice.

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
| `GRC_TRUST_PROXY` | off | Which reverse proxies may set `X-Forwarded-For`, `-Proto` and `-Host`: addresses, CIDR ranges and the words `loopback`, `private` and `linklocal`, or a number of proxy hops (only when nothing can reach the server except through them). Never set it without such a proxy |
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
| `data/` | Database (`data/pg`), attached files (`data/files`), `grc.pid`, `server.log`, `server.log.err` | No |
| `data.secret.key` (beside `data/`) | The secret key, unless supplied another way. Not in backups: back it up separately | No |
| `seed/` | Your organization profile and import files | No, never |
| `backups/` | Backups, safety copies made by `restore`, exports, copies of the code for `upgrade`, and the scheduled backup log | No |

## Before you rely on it

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
  machine's `backups/` folder, install as above, then `restore <name>`.
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
- **Create a role and a database** (as a superuser, in `psql`). The application's role owns
  its database, because migrations create and change tables at every start:

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

### HTTPS

Plain HTTP is accepted only on the loopback address. Choose one of:

- **A reverse proxy terminates HTTPS** in front of the application (next section). This is
  the usual choice, and what the container and the systemd service expect.
- **The application serves HTTPS itself**, given a certificate and key in PEM files:

  ```sh
  GRC_HOST=0.0.0.0  GRC_PORT=8443
  GRC_TLS_CERT=/etc/sandpiper-grc/tls/fullchain.pem  GRC_TLS_KEY=/etc/sandpiper-grc/tls/privkey.pem
  ```

  Ports below 1024 need a privilege; use 8443 with a firewall redirect. The certificate is
  read at start: restart after renewing it.

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
| Containers | `GRC_TRUST_PROXY=private` (as `compose.yaml` does) |

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
  client_max_body_size 25m;                    # attachments
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

If people sign in with passkeys, set `GRC_WEBAUTHN_RP_ID` and `GRC_WEBAUTHN_ORIGINS` to the
address they type, and set `auth.public_url` under Administration > Settings for sign-in
providers ([Security](security.md)).

### Containers

See [Docker](docker.md): the published image, `compose.yaml` (embedded database) and
`compose.postgres.yaml` (with PostgreSQL), volumes, backups, the secret key and upgrades.

Next: [Operations](operations.md).
