# Contributing to Sandpiper GRC

Thank you for helping build GRC for transit organizations. This page is the short
version; the detail is in the [developer guide](docs/development.md) (structure, conventions and the full hard rules) and
[`docs/architecture.md`](docs/architecture.md) (how the pieces fit together).

> **License.** Sandpiper GRC is released under the [MIT License](LICENSE). By contributing,
> you agree that your contribution is licensed under the same terms. Please open an issue
> before starting anything substantial.

## Set up

On Windows, with no administrator rights:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\install-node.ps1   # portable Node.js into .tools\node, checksum verified
.\grc.ps1 npm install
.\grc.ps1 seed -Profile dev      # invented sample data
.\grc.ps1 start                  # http://127.0.0.1:8080
```

On Linux or macOS, `./tools/install-node.sh` puts the Node.js version named in
[`tools/node-version.txt`](tools/node-version.txt) into `.tools/node`; then
`./grc.sh install`, `./grc.sh seed --profile dev` and `./grc.sh start`. `grc.sh` takes
the same commands as `grc.ps1` (see [`docs/operations.md`](docs/operations.md)).

For day-to-day development use `.\grc.ps1 dev`: the API with file watching on port 8080
and the web application with hot reload on http://127.0.0.1:5173.

Full instructions: [`docs/installation.md`](docs/installation.md).

## The hard rules, in brief

These are not style preferences. A change that breaks one will not be merged.

1. **Nothing that identifies one organization in the repository.** Transit terms are
   welcome; real organization, agency, regulator, person, place, vendor or product names
   are not, nor is the law, regulator or contract of one jurisdiction as a built-in
   default. Samples and tests use invented data. Anything specific to one installation belongs in that installation's private
   organization profile or is entered in the application.
2. **`seed/` is private.** It is git-ignored. Never commit it, send it anywhere, or paste
   its content into code, logs, tests, issues or documentation.
3. **Local only.** No telemetry, no externally hosted fonts or scripts, no calls to
   outside services from application code.
4. **Documentation and the roadmap change with the code, always** (next section).
5. **Do not copy any commercial product's branding, text, icons or screens.**
6. **Every data change writes an audit event. Every feature ships with a test.**
7. **Configuration over code.** Statuses, priorities, categories and scales are rows in
   the lookup and settings tables, not constants.
8. **Plain English in the interface, American spelling** ("catalog", "authorization",
   "organization").

## Documentation and the roadmap

A change is not finished until every place that describes it is updated **in the same
pull request**:

- `docs/user/*.md`: the user guide. The same files are built into the application's Help
  section, so rebuild the web application after editing them.
- `docs/`: `installation.md`, `operations.md`, `architecture.md`, `security.md`,
  `known-gaps.md`, and the index `docs/README.md`.
- `docs/roadmap/`: the feature tracker. Mark the issue done (tick its acceptance
  criteria, add an "Implemented in" line), add issues for anything left out or newly
  found, and keep the epic's table and the summary in `docs/roadmap/README.md` in step.
  A change with no issue gets one first. The format is described in
  [`docs/roadmap/README.md`](docs/roadmap/README.md); the GitHub issue templates mirror it.
- `README.md` when what the product does, or how to run it, changes.
- `docs/development.md` when structure, commands or conventions change.

The pull request template repeats this as a checklist.

## Tests and checks

```powershell
.\grc.ps1 typecheck      # npm run typecheck: the server and the web application
.\grc.ps1 test           # npm test: every *.test.ts beside the code (Vitest)
.\grc.ps1 build          # npm run build: the production web build
```

Run `.\grc.ps1 ci` (or `./grc.sh ci`: typecheck, tests, the tests again on UTC, the web
build, and the dependency audit, which is skipped without a network) before every commit
and push. GitHub Actions runs the same checks on Windows
and Linux for every push and pull request, and also the tests on a PostgreSQL server,
installation on Linux and macOS, the container image, the browser suite and the
accessibility audit ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)); a pull
request must pass them before it is merged. Locally, run only the browser suites your
change touches (`npm run test:e2e -- --only <suites>`). Dependabot proposes dependency
updates weekly ([`.github/dependabot.yml`](.github/dependabot.yml)).

- Tests live beside the code as `*.test.ts` and use `testApp()` from
  `server/src/test/helpers.ts`: an in-memory application with a signed-in administrator,
  `as(roleKey)` for a user holding one other role, and `anon`.
- Run one module alone: `$env:GRC_MODULES='tickets'; npx vitest run server/src/modules/tickets`.
- Tests never read `seed/` and never need the network.
- Look at your screens in a real browser, in light and dark, wide and narrow, before
  calling them done.

## How the code is organized: the module pattern

The application is a small core plus modules. A module is two folders and nothing else:

```
server/src/modules/<key>/    index.ts, migrations/*.sql, seed.ts, *.test.ts
web/src/modules/<key>/       index.tsx and its pages
```

- Modules are discovered automatically on both sides. **A module never edits files
  outside its own two folders.** Folders whose names start with `_` are ignored.
- On the server a module exports a `ModuleDef`: `seedDefaults` (idempotent, runs at every
  start), `register` (routes) and `seed` (sample or imported data). Most record types
  are declared with `ctx.defineResource(...)`, which generates the list, read, create,
  update, soft-delete, statistics and export routes with permission checks, validation
  and audit.
- Database changes are numbered SQL migrations in the module's `migrations/` folder.
  There are **no foreign keys across modules**: store the other record's identifier in a
  plain column and declare the field as a reference.
- On the web a module exports its navigation entries and routes; pages are built from
  the shared components in `web/src/core/` (see `web/src/core/README.md`).
- Shared code (`server/src/core/`, `web/src/core/`) changes rarely and deliberately.
  Operations commands (backup, restore, export, import, status) are in `server/src/ops/`.

The conventions for each of these, with examples, are in the [developer guide](docs/development.md).

## Pull requests

- Keep them small and about one thing; name the roadmap issue (for example `E16-09`).
- Do not add or remove npm packages without saying why in the pull request.
- TypeScript throughout, ES modules, relative imports with the `.ts` extension on the
  server, no enums. `.editorconfig` holds the whitespace rules.

## Reporting bugs and security problems

- Bugs and ideas: open an issue using the templates. Do not include real data.
- Security problems: **not** as a public issue. See [`SECURITY.md`](SECURITY.md).
