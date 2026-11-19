# Security policy

Sandpiper GRC is a **prototype** for evaluation on one machine. It has not had an
independent security review or penetration test. What protects it today, and what does
not yet, is described in [`docs/security.md`](docs/security.md) and
[`docs/known-gaps.md`](docs/known-gaps.md). Please read those before deciding what to
put in it.

## Supported versions

Only the latest version is supported: the newest commit on the default branch (and the
newest release, once there are releases). Fixes are not back-ported to older versions.

| Version | Supported |
|---|---|
| Latest | Yes |
| Anything older | No: upgrade first, then check whether the problem remains |

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request for a security problem.**

Report it privately through GitHub:

1. Go to the repository's **Security** tab:
   <https://github.com/mdcrowley/sandpiper-grc/security>
2. Choose **Report a vulnerability** (under "Advisories"). This opens a private security
   advisory that only you and the maintainers can see.

If you cannot use that form, open a public issue that says only that you have a security
report and need a private channel. Put no detail in it.

### What to include

- **What is affected**: the part of the application (for example sign-in, exports, a
  named screen or API route) and the version or commit you tested. `.\grc.ps1 status`
  shows the version.
- **What you did**: the steps, requests or a small script that reproduce it, starting
  from a fresh installation with the sample data (`.\grc.ps1 seed -Profile dev`) where
  possible.
- **What happened and what you expected**.
- **Impact**: what someone could read, change or prevent, and which account or role they
  would need (none, any signed-in user, a named role).
- **Your environment**: operating system, browser, and anything unusual about the set-up
  (a different port, a proxy in front).
- Any suggestion for a fix, if you have one.

Please **do not include real data**: no real organization, people, records, passwords or
tokens. Use the invented sample data, and remove anything real from logs and
screenshots.

### What to expect

- This is a small, volunteer-maintained project. You will get an acknowledgment and an
  honest assessment as soon as the maintainers can manage; no response time is
  guaranteed.
- If the report is accepted, the fix is developed in the private advisory, released,
  and then the advisory is published. You will be credited in it unless you ask not to be.
- If the report is not accepted (for example because it is already listed in
  `docs/known-gaps.md` as a known limit of the prototype), you will be told why.
- **There is no bug bounty** and no payment for reports.

## Good-faith research

Test only against your own installation. The application is designed to run on your own
machine, so there is never a reason to probe someone else's. Do not use a finding to
read, change or delete data that is not yours.

## Scope notes

These are known and documented limits of the prototype rather than new findings, though
improvements are welcome as ordinary issues or pull requests:

- It serves plain HTTP on `127.0.0.1` only; there is no HTTPS.
- Data at rest (the `data/` and `backups/` folders, and exports) is not encrypted by the
  application.
- Anything else listed under "Not yet" in [`docs/security.md`](docs/security.md).

A way to reach the application from another machine, to act without signing in, to see
restricted records without the permission for them, to change or remove audit events, or
to make the application call an outside service would all be in scope and worth reporting.
