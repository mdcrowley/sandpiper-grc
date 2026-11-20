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
   without a reason) is tried again with fewer fields. The words follow a Zipf distribution
   over a vocabulary of about 500 transit and IT words (the word of rank r is about 1/r as
   common as the first), as real text does: a few words are in thousands of records, most in
   a handful. A search is what a person might type: one word of the vocabulary (65 %), two
   (20 %), a number (10 %) or a misspelled word that matches nothing (5 %).
3. Has `--concurrency` simulated people repeat each scenario for `--duration` seconds, and
   reports requests, errors, requests per second and the 50th, 95th and 99th percentile and
   longest times: ticket list pages (first, random and sorted, filtered, full-text), ticket
   statistics, the first page of every list, global search, one record, the whole Overview
   dashboard (every call it makes, timed until the last answer, with the 95th percentile of
   each call), and creating and updating a ticket. The time the instance took to start (until
   it answered) is reported too.
4. With `--ops`: stops the instance and times `backup`, `export-all`, `verify-backup`,
   `restore` and `import-all` into an empty installation at that volume.
5. Writes `load-<time>.json` and `load-<time>.md` to `--out` (default `tools/load/out/`,
   git-ignored) and deletes the temporary folder (`--keep` keeps it).

| Option | Default | Meaning |
|---|---|---|
| `--scale n` | `1` | Multiplies every record count (`0.1` for a quick check) |
| `--concurrency n` | `8` | Simulated people at once |
| `--duration s` | `15` | Seconds per scenario |
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
