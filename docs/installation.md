# Installation

This installs the prototype on one Windows machine. It needs no administrator rights, no
Docker and no database server. It is not a production installation: see
[Security](security.md) and [Known gaps](known-gaps.md).

## Requirements

- Windows 10 or 11, 64-bit, with Windows PowerShell 5.1 (included with Windows).
- The repository, cloned or copied to a folder you can write to.
- Internet access **during installation only**, to download Node.js and the npm packages.
  The running application makes no outbound connections.
- A current web browser on the same machine. The server listens on `127.0.0.1` only, so it
  cannot be reached from another computer.

## 1. Put the portable Node.js in `.tools\node`

The application runs on a portable copy of Node.js 24 LTS kept inside the repository
folder. Nothing is installed system-wide. One command fetches it:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\install-node.ps1
```

The script:

1. Reads the Node.js major version from `tools\node-version.txt`. That file is the one
   place the version is pinned; the CI workflow (`.github/workflows/ci.yml`) reads it too.
2. Downloads `SHASUMS256.txt` for the newest release of that major version from
   nodejs.org, then the Windows x64 zip named in it.
3. Computes the zip's SHA-256 and compares it with the published value. On a mismatch it
   stops and installs nothing.
4. Extracts the zip so that `.tools\node\node.exe` exists, and prints the version.

It contacts nodejs.org only, and needs no administrator rights. If Node.js is already
there it says so and changes nothing; add `-Force` to replace it with the newest release
of the same major version (stop the server first). `-Mirror <url>` uses a copy of the
Node.js downloads inside your own network, and `-Destination <folder>` puts it somewhere
else.

The checksum list is fetched over HTTPS; the script does not check its OpenPGP signature.
To do that as well, or to install without the script, follow the manual steps.

`grc.ps1` stops with "Portable Node.js is missing from .tools\node" until Node.js is in
place.

### Manual steps

1. From nodejs.org, download the Node.js 24 LTS **Windows x64 zip** (`node-v24.x.y-win-x64.zip`)
   and the `SHASUMS256.txt` file published beside it for the same version. (The signed
   list, `SHASUMS256.txt.asc`, can be checked with GnuPG against the Node.js release keys
   if you want proof that the list itself is genuine.)
2. Verify the download. Compute the checksum:

   ```powershell
   Get-FileHash .\node-v24.x.y-win-x64.zip -Algorithm SHA256
   ```

   Find the line for the same file name in `SHASUMS256.txt` and compare the two values.
   They must match exactly (letter case does not matter). If they differ, delete the file
   and download it again.
3. Extract it so that `.tools\node\node.exe` exists. The zip holds one top-level folder,
   which you rename to `node`:

   ```powershell
   New-Item -ItemType Directory -Force .tools | Out-Null
   Expand-Archive .\node-v24.x.y-win-x64.zip -DestinationPath .tools
   Rename-Item .tools\node-v24.x.y-win-x64 node
   Test-Path .tools\node\node.exe    # must print True
   ```

## 2. Install the packages

```powershell
.\grc.ps1 npm install
```

This downloads the npm packages into `node_modules\`. (`.\grc.ps1 start` runs the same
install by itself when `node_modules\` is missing.)

### If the script is blocked

Windows may refuse to run scripts ("running scripts is disabled on this system"). Use any
one of these; none needs administrator rights:

```powershell
# Run one command with the policy bypassed
powershell -ExecutionPolicy Bypass -File .\grc.ps1 start

# Or allow scripts for this PowerShell window only
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

# Or, if the files came from a downloaded zip, remove the "downloaded" mark
Unblock-File .\grc.ps1
```

## 3. Start it

```powershell
.\grc.ps1 start
```

The first start builds the web application, creates the `data\` folder, creates the
database and applies the migrations. It then prints
`Sandpiper GRC is running at http://127.0.0.1:8080`. Open that address in a browser.

## 4. Complete the setup wizard

While no user exists, the application shows a setup wizard. It creates the first
administrator: username, email address, name and password. There is **no default
account** and no default password.

- Username: 3 to 64 letters, numbers, dots, dashes or underscores.
- Password: at least 14 characters, not on the built-in list of common passwords, and not
  containing the username.

The wizard works once. After that, administrators add users under Administration. A new
user gets a one-time setup link (valid for 24 hours) which the administrator passes on by
hand, because the prototype sends no email.

## 5. Load data

`.\grc.ps1 seed` loads data. It is safe to run more than once: it adds what is missing and
does not overwrite what people have changed in the application. If the server is running,
the script stops it, loads the data and starts it again.

There are two profiles.

### Sample data: the `dev` profile

```powershell
.\grc.ps1 seed -Profile dev
```

Loads sample data for an invented bus and light-rail operator in every module and needs
no files. Use this to evaluate the application. Sample records are labelled `[Sample]` where they could be
mistaken for real ones.

Tip: complete the setup wizard before seeding. Some sample records are assigned to
existing active users, and a seed run before any user exists leaves them unassigned.

### Your own data: the `pilot` profile

```powershell
.\grc.ps1 seed            # pilot is the default profile
```

Reads the private `seed\` folder. The folder must exist; every file in it is optional and
a missing file is skipped and named in the output. `seed\` is git-ignored: never commit it.

```powershell
New-Item -ItemType Directory -Force seed | Out-Null
Copy-Item examples\organisation.example.json seed\organisation.json
# edit seed\organisation.json, then:
.\grc.ps1 seed
```

Be aware of two things:

- The pilot profile **also adds invented sample records** (service desk tickets, problems
  and knowledge articles, projects, risks, assets and one security incident, all labelled
  `[Sample]` or clearly invented), because those modules have no import file. Delete them
  in the application when you no longer want them.
- Without `csf_subcategory_designations.csv` the framework is created with its functions
  and categories but **no outcomes**. Add outcomes on the framework page, supply the file,
  or use the `dev` profile.

#### The organisation profile: `seed\organisation.json`

A JSON object. Every section is optional. An invented example is in
[`examples/organisation.example.json`](../examples/organisation.example.json).

| Field | Purpose | Behaviour |
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
`data_sharing_partners`, `insurer` and `affected_individuals`. **A profile
rule that reuses one of those keys is skipped.** Either give your rules different keys, or
edit the starter rules in the application. An invalid rule makes the security incidents
part of the seed fail with a message naming the rule.

Deadlines and recipients depend on your law, regulators, contracts and insurer. Set them
yourself, with legal advice.

#### Optional import files

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
module's data was not fully loaded; fix the file and run the command again.

## Environment variables

Set these in the PowerShell window before running `.\grc.ps1`, for example
`$env:GRC_TIMEZONE = 'Europe/London'`. They are read at every start and are not saved
anywhere, so set them every time (or in your PowerShell profile). Use the same values for
every command: `start`, `seed`, `backup`, `restore`, `upgrade` and the rest.
(`.\grc.ps1 schedule-backup` is the exception: it writes the values in force into the
scheduled task.)

| Variable | Default | Purpose |
|---|---|---|
| `GRC_PORT` | `8080` | Port the server listens on (always on `127.0.0.1`) |
| `GRC_DATA_DIR` | `.\data` | Folder for the database, attached files, process id file and logs. The value `memory` gives a throwaway in-memory database; it is meant for tests and for `npm start` in a plain shell, not for `.\grc.ps1 start` |
| `GRC_BACKUP_DIR` | `.\backups` | Folder for backups, safety copies and (by default) exports. Point it at another disk to keep backups away from the data |
| `GRC_WEB_DIST` | `.\dist\web` | Folder the web application is built into and served from. A development aid for running a second copy |
| `GRC_SEED_DIR` | `.\seed` | Folder the `pilot` seed profile reads |
| `GRC_TIMEZONE` | The machine's time zone | The organisation's time zone, as an IANA name such as `Europe/London`. Business hours, "today" and due dates are worked out in it. An unknown name stops the server at start |
| `GRC_CURRENCY` | `USD` | ISO 4217 code used to display money fields, such as `GBP`. Display only: no conversion is done |
| `GRC_SECRET_KEY` | not set | The key that encrypts authenticator (second-factor) keys in the database: 32 bytes, as 64 hex characters or base64. When not set, the key file below is used |
| `GRC_SECRET_KEY_FILE` | `secret.key` in the data folder | Path of a file holding the same key. The default file is generated on first start. Point this outside the data and backup folders to keep the key apart from the database |
| `GRC_SECRET_KEY_PREVIOUS` | not set | Retired keys, comma-separated, in the same format. Needed for one start after changing the key, so existing values can be re-encrypted; see [Security](security.md) |
| `GRC_COOKIE_SECURE` | `off` | `off`, `auto` or `always`: whether the session cookie is marked `Secure`. `auto` marks it when the request arrived over HTTPS. Leave `off` on plain `http://127.0.0.1` |
| `GRC_TRUST_PROXY` | off | `1` when the server sits behind one reverse proxy you control: its `X-Forwarded-Proto` and `X-Forwarded-For` headers are then believed. Never set it without such a proxy |
| `GRC_MODULES` | all modules | Comma-separated module folder names to load, for example `admin,tickets`. A development aid; see [Architecture](architecture.md#testing) |

Limits to know about:

- `.\grc.ps1 dev` proxies the web development server to port 8080, so leave `GRC_PORT` at
  its default when using `dev`.
- Decide the time zone before recording real data. Changing it later changes how existing
  times are displayed and how deadlines are worked out.

## What is created on disk

| Path | Contents | Committed? |
|---|---|---|
| `.tools\node\` | Portable Node.js | No |
| `node_modules\` | npm packages | No |
| `dist\web\` | The built web application | No |
| `data\` | Database (`data\pg`), attached files (`data\files`), `secret.key` (the key that encrypts authenticator keys, unless supplied another way), `grc.pid`, `server.log`, `server.log.err` | No |
| `seed\` | Your organisation profile and import files | No, never |
| `backups\` | Backups made by `.\grc.ps1 backup`, safety copies made by `restore`, exports made by `export-all`, and the scheduled backup log | No |

## Before you rely on it

Once the application holds anything you would not want to lose:

```powershell
.\grc.ps1 schedule-backup -At 02:00 -Prune 14    # a verified backup every day, keeping two weeks
.\grc.ps1 status                                 # shows the schedule and the last backup
```

Then carry out the [restore test](operations.md#restore-test) once, so you know the
backups can be put back. Backups are not encrypted and sit beside the data unless you set
`GRC_BACKUP_DIR`; see [Operations](operations.md#backup).

## Moving to another machine

Two ways, both described in [Operations](operations.md):

- **Same version, same kind of machine**: take a backup, copy its folder to the new
  machine's `backups\` folder, install as above, then `.\grc.ps1 restore <name>`.
- **A different version, or a different database engine later**: `.\grc.ps1 export-all`
  on the old machine and `.\grc.ps1 import-all <folder>` on a fresh installation that has
  not been through the setup wizard. Take the secret key across as well; see
  [Export and import](operations.md#export-and-import).

## Other operating systems

`grc.ps1` and `tools\install-node.ps1` are for Windows. The application itself also runs
on Linux and macOS (not yet tested there, since CI is local on Windows for now): install the Node.js
major version named in `tools/node-version.txt`, then `npm install`,
`npm run seed -- --profile dev`, `npm run build` and `npm start`. Backup, restore, export
and import are available as `npm run cli -- <command>` with the server stopped; starting,
stopping and scheduling are up to you.

Next: [Operations](operations.md).
