# Hosted automation (switched off)

Sandpiper GRC uses **no GitHub Actions and no other hosted automation**. Checks run
locally with `.\grc.ps1 ci` (typecheck, tests and web build).

The two files here are kept for a future decision and do nothing where they are: GitHub
only reads workflows from `.github/workflows/` and Dependabot settings from
`.github/dependabot.yml`.

| File | To switch on later |
|---|---|
| `github-actions-ci.yml` | Copy to `.github/workflows/ci.yml` |
| `dependabot.yml` | Copy to `.github/dependabot.yml` (Dependabot runs its updates on GitHub Actions) |

To be certain nothing can run, also disable Actions for the repository on GitHub:
**Settings > Actions > General > Disable actions**.
