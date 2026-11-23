# Load test

`run.mjs` measures Sandpiper GRC at a realistic volume (roadmap E16-14). It uses Node.js
built-ins only and contacts nothing outside the machine. Results and their limits are
recorded in [Operations, "Performance and load testing"](../../docs/operations.md#performance-and-load-testing).

```
node tools/load/run.mjs                                   # scale 1, 8 at once, 15 s per scenario
node tools/load/run.mjs --scale 4 --concurrency 16 --ops  # more records, more people, and operations timings
```

What it does:

1. Starts a throw-away instance of the application (the code in this folder) in a new
   temporary data folder on `--port` (default 8190), and completes the setup wizard.
2. Creates invented records through the API: at scale 1, 10,000 tickets,
   3,000 assets, 2,000 actions, 1,500 changes, 1,500 vulnerabilities and some hundreds of
   each other type. A record a type's own rule refuses (an end before a start, an override
   without a reason) is tried again with fewer fields, and a name that must be unique and is
   already taken (a vendor's name, a vehicle's fleet number) is made unique. The words follow a Zipf distribution
   over a vocabulary of about 500 transit and IT words (the word of rank r is about 1/r as
   common as the first), as real text does: a few words are in thousands of records, most in
   a handful. A search is what a person might type: one word of the vocabulary (65 %), two
   (20 %), a number (10 %) or a misspelled word that matches nothing (5 %).
3. Has `--concurrency` simulated people repeat each scenario for `--duration` seconds, and
   reports requests, errors, requests per second and the 50th, 95th and 99th percentile and
   longest times: ticket list pages (first, random and sorted, filtered, full-text), ticket
   statistics, the first page of every list, global search, one record, the whole Overview
   dashboard (every call it makes, timed until the last answer, with the 95th percentile of
   each call), the Overview again while someone saves a ticket every second (the server keeps
   the Overview's figures only while nothing is written, so this is its cost when people are
   also working), and creating and updating a ticket. The time the instance took to start (until
   it answered) is reported too.
4. With `--ops`: stops the instance and times `backup`, `export-all`, `verify-backup`,
   `restore` and `import-all` into an empty installation at that volume.
5. Writes `load-<time>.json` and `load-<time>.md` to `--out` (default `tools/load/out/`,
   git-ignored) and deletes the temporary folder (`--keep` keeps it).

| Option | Default | Meaning |
|---|---|---|
| `--scale n` | `1` | Multiplies every record count (`0.1` for a quick check) |
| `--concurrency n` | `8` | Simulated people at once |
| `--seed-concurrency n` | `8` | Records created at once while seeding (a PostgreSQL server takes 16 or more) |
| `--duration s` | `15` | Seconds per scenario |
| `--roles n` | `0` | Also make one person in each of `n` roles (switched on, no second factor required, the administrator's left out) and have the simulated people open the Overview as the administrator and those people in turn, each asking only for the calls their role may see |
| `--only a,b` | all | Scenarios whose name contains one of these words |
| `--ops` | off | Also time backup, export, verification, restore and import |
| `--port n` | `8190` | Port of the throw-away instance (`GRC_PORT`) |
| `--data-parent dir` | the system temporary folder | Where the temporary data folder is made |
| `--out dir` | `tools/load/out` | Where results are written |
| `--keep` | off | Keep the temporary data folder (with `created.json`, the records made) |
| `--seed-only` | off | Create the records and stop (with `--keep`: a folder to measure again) |
| `--reuse dir` | (seed) | Measure a copy of a folder kept with `--keep` instead of seeding again; the copy is deleted afterwards. Lets two versions be measured on the same records, and saves the hour that seeding scale 4 takes |
| `--base url --user u --password p` | (own instance) | Measure an instance that is already running. It **adds thousands of invented records** to it: never use this on a real installation |

With `GRC_DATABASE_URL` set (a PostgreSQL server; use an empty database made for the
test), the throw-away instance uses that server instead of the embedded database.
`LOAD_VERBOSE=1` shows the instance's own output.

The instance gets the environment the tool runs in, so any server setting can be tried. For
example `GRC_FIGURES_CACHE_SECONDS=0` measures the Overview without its kept figures. Without
`--roles` every simulated person signs in as the same administrator, so with the cache on they
share one kept answer per figure, which is the best case; with `--roles n` they open it as
`n + 1` different sets of permissions, each with its own kept answers (E16-41). The people
are made after seeding and kept in `created.json`, so `--reuse` signs in as them again
(seed with `--roles` as large as any later run needs). To compare two versions on the same records, seed once with `--seed-only --keep`, then
run each version with `--reuse <kept folder>` (an older version in a separate `git worktree`,
with this `run.mjs` copied into it). The measured results are in
[Operations](../../docs/operations.md#performance-and-load-testing).

A request that gets no answer at all (a dropped connection) is tried again once and counted;
the count is in the results ("Requests that got no answer at all"). If the instance stops by
itself, the run ends with its exit code and the last lines it wrote, rather than only "fetch
failed".

To see which statements are slow during a run, set `GRC_SLOW_QUERY_MS` (for example `100`)
together with `LOAD_VERBOSE=1`: the instance logs every statement that took that long, with
its time and text (not its values). On the embedded database the time includes waiting for
the statements ahead of it, since it runs one at a time.

The exit code is 1 when any scenario had an error, so the script can run in a scheduled job.

## Measuring on a PostgreSQL server

Any empty database will do. With Docker, for example (a throw-away server on this machine
only; remove it afterwards with `docker rm -f grc-load-pg`):

```
docker run -d --name grc-load-pg -p 127.0.0.1:55432:5432 -e POSTGRES_USER=grc -e POSTGRES_PASSWORD=load-test-only -e POSTGRES_DB=grc_load postgres:17
GRC_DATABASE_URL=postgres://grc:load-test-only@127.0.0.1:55432/grc_load node tools/load/run.mjs --scale 0.5
```

(In PowerShell: `$env:GRC_DATABASE_URL = '...'` on its own line first.) The server and the
load generator then share the machine's processors, so the figures are a lower bound for a
database on its own machine.

To give the database a fixed share of the machine instead, as if it were a small machine of
its own (E16-41), limit the container, and watch whether it is the bottleneck:

```
docker run -d --name grc-load-pg --cpus 2 --memory 2g --memory-swap 2g -p 127.0.0.1:55433:5432 -e POSTGRES_USER=grc -e POSTGRES_PASSWORD=load-test-only -e POSTGRES_DB=grc_load postgres:17
docker stats grc-load-pg        # in another window: 200 % CPU means both of its processors are busy
```

For a database on another machine, point `GRC_DATABASE_URL` at it; the application (the
throw-away instance) and the load generator stay on this one.

With `--reuse`, keep `GRC_DATABASE_URL` pointing at the database that was seeded: the kept
folder holds only the files beside it. A newer version brings that database up to date when
it starts, so measure the older version first. Seeding goes faster on a server with
`--seed-concurrency 16`.

To measure two versions, or the same version several times, on exactly the same records,
keep the seeded database as a template and give each run a fresh copy of it (E16-41):

```
docker exec grc-load-pg createdb -U grc -T grc_load run1     # a copy; nobody may be connected to grc_load meanwhile
GRC_DATABASE_URL=postgres://grc:load-test-only@127.0.0.1:55433/run1 node tools/load/run.mjs --reuse <kept folder> ...
docker exec grc-load-pg dropdb -U grc run1
```

Alternate the versions (before, after, before, after) and compare medians: other work on
the same machine moves single runs a lot. A limited container can be given more processors
while seeding and limited again before measuring (`docker update --cpus 8 grc-load-pg`, then
`--cpus 2`): seeding scale 4 then takes minutes rather than most of an hour.
