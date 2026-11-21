# Docker

Sandpiper GRC is published as a container image for `linux/amd64` and `linux/arm64`:

```
ghcr.io/mdcrowley/sandpiper-grc
```

| Tag | What it is |
|---|---|
| `latest` | The newest release |
| `0.2.0`, `0.2` | A release, or the newest patch of a minor version (pin one of these in production) |
| `edge` | The `main` branch, rebuilt on every change. For trying out what is coming, not for real data |

The image runs as an unprivileged user (uid 1000), with a read-only root filesystem, no
compiler and no development packages, and a health check on `/api/ready` (the server
answers and so does its database; [Operations](operations.md#health-check)). It is built
from a Node.js base image pinned by digest, by a workflow whose actions are pinned to commit
SHAs. It works with
Docker Engine, Docker Desktop (Windows, macOS, Linux) and Podman. Each published image
carries a software bill of materials and signed build provenance; check an image with
`gh attestation verify oci://ghcr.io/mdcrowley/sandpiper-grc:<tag> --owner mdcrowley`.

This is a **prototype**: read [Security](security.md) and [Known gaps](known-gaps.md) before
holding real data in it.

## Quick start

You need Docker with the Compose plugin (`docker compose version` prints 2.24 or later) and
this repository's `compose.yaml` (clone the repository, or download `compose.yaml` and
`.env.example` on their own).

```sh
git clone https://github.com/mdcrowley/sandpiper-grc.git && cd sandpiper-grc
docker compose up -d
docker compose ps          # wait until app shows "healthy" (about 30 seconds)
```

Open <http://127.0.0.1:8080>. The first visit shows the **setup wizard**, which creates the
first administrator; there is no default account. Then, optionally, load the invented
sample data (a bus and light-rail operator):

```sh
docker compose stop app
docker compose run --rm app grc seed --profile dev
docker compose start app
```

Complete the setup wizard **before** loading sample data: some sample records are
assigned to existing users. Seeding needs the database to itself, which is why the
application is stopped around it.

If the published image cannot be pulled (offline, or before the first release), Compose
builds it from the folder instead, which takes a few minutes. To always build from source:
`GRC_IMAGE=sandpiper-grc:local docker compose up -d --build`.

## What runs

`compose.yaml` runs one container, `app`, with the **embedded database** (PostgreSQL
compiled to WebAssembly, inside the application process). Two named volumes hold
everything it writes:

| Volume | Mounted at | Contents |
|---|---|---|
| `sandpiper-grc_grc-data` | `/var/lib/sandpiper` | `data/` (database, attached files), `backups/` (backups and the server's own daily archives), `seed/` (if you put your organization profile there) |
| `sandpiper-grc_grc-key` | `/var/lib/sandpiper-key` | `secret.key`, the key that encrypts authenticator keys and other stored secrets |

The port is published on `127.0.0.1:8080` only, over plain HTTP. That is enough for one
person on the same machine; to serve anyone else, put a reverse proxy that terminates HTTPS
in front of it ([HTTPS](#https-behind-a-reverse-proxy)).

The container restarts by itself (`restart: unless-stopped`). `docker compose stop` sends a
terminate signal: the server finishes the requests in progress and closes the database
cleanly (it gives up after 20 seconds). The shipped `compose.yaml` gives the container 30
seconds (`stop_grace_period: 30s`) before Compose ends it, so the server always has time to
finish.

## Configuration

All configuration is by environment variable. Copy `.env.example` to `.env` beside
`compose.yaml` and uncomment what you need; `.env` is git-ignored. Every `GRC_*` line in it
reaches the application. Then apply the change with `docker compose up -d`.

The ones most installations set:

| Variable | Default | Purpose |
|---|---|---|
| `GRC_TIMEZONE` | `UTC` | The organization's time zone, as an IANA name such as `America/Chicago`. Decide it before recording real data |
| `GRC_CURRENCY` | `USD` | ISO 4217 code for money fields (display only) |
| `GRC_TRUST_PROXY` | `gateway` | Which reverse proxies may set forwarded headers. `gateway` is the Docker host itself, where a proxy in front of the published port connects from, and nothing else. See [HTTPS behind a reverse proxy](#https-behind-a-reverse-proxy) |
| `GRC_WEBAUTHN_RP_ID`, `GRC_WEBAUTHN_ORIGINS` | the request's address | The host name and origin people type, for passkeys behind a proxy |

Settings that steer Compose rather than the application:

| Variable | Default | Purpose |
|---|---|---|
| `GRC_IMAGE` | `ghcr.io/mdcrowley/sandpiper-grc:latest` | The image to run. Pin a version (`...:0.2.0`) in production |
| `GRC_BIND` | `127.0.0.1` | Host address the port is published on |
| `GRC_PUBLISH_PORT` | `8080` | Host port |
| `COMPOSE_FILE` | `compose.yaml` | `compose.yaml:compose.postgres.yaml` (with `;` on Windows) makes the PostgreSQL variant the default |

Do not set `GRC_PORT`, `GRC_HOST`, `GRC_DATA_DIR`, `GRC_BACKUP_DIR` or `GRC_WEB_DIST`: the
image sets them to match its volumes, port mapping and health check. Every other variable
is described in [Installation](installation.md#environment-variables).

For anything `.env` cannot express (extra mounts, secrets, a certificate), add a
`compose.override.yaml` beside `compose.yaml`; Compose reads it by itself. For example, the
organization time zone and a key supplied as a Compose secret:

```yaml
# compose.override.yaml
services:
  app:
    environment:
      GRC_TIMEZONE: America/Chicago
      GRC_SECRET_KEY_FILE: /run/secrets/grc_secret_key
    secrets:
      - grc_secret_key
secrets:
  grc_secret_key:
    file: ./deploy/secrets/secret_key.txt
```

## Commands inside the container

The image has a `grc` command for the operations of `server/src/cli.ts`:

```sh
docker compose exec app grc status             # version, data size, last backup, migrations
docker compose exec app grc version            # the version and the commit the image was built from
docker compose exec app grc logs --lines 100   # the server's log, readably (--level warn, --follow)
docker compose exec app grc backups            # list backups
docker compose exec app grc secret-key show    # where the key comes from (fingerprint only)
```

**Logs.** The server writes every entry to the container's output as one JSON line
(`docker compose logs -f app`; `GRC_LOG_CONSOLE=json` in the image), one line per request
with its request identifier, and keeps the same entries in the data volume
(`/var/lib/sandpiper/data/logs/grc.log`, rotated at 10 MB, five old files kept). Passwords,
tokens and query strings are never logged. Settings: [Operations](operations.md#logs).

Commands that need the database to itself (`seed`, `backup`, `restore`, `export-all`,
`import-all`, `move-files`, `migrate`, `secret-key rotate`) refuse to run while the server
is running. (There is no `grc start` or `grc stop`: Compose starts and stops the server.) Run them in a one-off container with the application stopped:

```sh
docker compose stop app
docker compose run --rm app grc backup
docker compose start app
```

`grc` with no command lists them all. They are the same commands as `grc.ps1` and `grc.sh`
use; see [Operations](operations.md).

### Your organization profile

To load your own [organization profile](installation.md#the-organization-profile) and import
files, mount your private `seed/` folder for the run:

```sh
docker compose stop app
docker compose run --rm -v "$PWD/seed:/seed:ro" -e GRC_SEED_DIR=/seed app grc seed
docker compose start app
```

## Volumes and backups

Two kinds of backup, and you want both:

1. **Application backups** (`grc backup`): a verified copy of the data folder, with a
   manifest and checksums, written to `/var/lib/sandpiper/backups` in the data volume. The
   server also takes its own daily archives there when switched on under Administration >
   Backups. Copy them off the machine:

   ```sh
   docker compose stop app
   docker compose run --rm app grc backup --prune 14
   docker compose start app
   docker compose cp app:/var/lib/sandpiper/backups ./grc-backups   # works while app runs or is stopped
   ```

   Encrypted backups: `grc backup --encrypt --key-file /run/secrets/backup_key` with the key
   file mounted (see [Encrypted backups](operations.md#encrypted-backups-and-exports)).
2. **Volume backups**: a copy of the whole volume, with the application stopped, using any
   small image:

   ```sh
   docker compose stop app
   docker run --rm -v sandpiper-grc_grc-data:/data:ro -v "$PWD:/out" busybox \
     tar -czf /out/grc-data-$(date +%Y%m%d).tar.gz -C /data .
   docker compose start app
   ```

   To put one back, stop the application, empty the volume and unpack it:
   `docker run --rm -v sandpiper-grc_grc-data:/data -v "$PWD:/in" busybox sh -c 'rm -rf /data/* && tar -xzf /in/grc-data-YYYYMMDD.tar.gz -C /data'`.

Restore an application backup with the application stopped:
`docker compose run --rm app grc restore latest` (or a backup's name from `grc backups`).

For a schedule, run the three backup lines from cron or a systemd timer on the host; see
[Scheduled backups](operations.md#scheduled-backups).

## Secret key

The secret key encrypts authenticator (second-factor) keys, sign-in provider secrets,
webhook secrets and the mail server password in the database. **Without it those values cannot be read**, so people would
have to set up their second factor again.

By default it is generated on first start as `/var/lib/sandpiper-key/secret.key`, in its own
volume, so a copy or backup of the data volume never holds the key beside the values it
protects. Keep a copy of the key somewhere safe and separate from the backups:

```sh
docker compose cp app:/var/lib/sandpiper-key/secret.key ./sandpiper-secret.key
chmod 600 ./sandpiper-secret.key
```

Other ways to supply it (the first that is set wins):

- `GRC_SECRET_KEY` in `.env`: 64 hex characters (`openssl rand -hex 32`).
- `GRC_SECRET_KEY_FILE` pointing at a mounted file, such as a Compose secret (example under
  [Configuration](#configuration)). The file must be readable by uid 1000.

To change the key, see [Security](security.md). `docker compose down -v` deletes the key
volume along with the data: never run it on an installation you want to keep.

## Upgrades

```sh
docker compose stop app && docker compose run --rm app grc backup && docker compose start app   # first, a backup (pg_dump with PostgreSQL)
docker compose pull
docker compose up -d
```

The new container applies database migrations at start and turns healthy when it is ready
(`docker compose ps`, `docker compose logs app`); `grc version` and Help > About show the
version now running. To go back, set `GRC_IMAGE` to the
previous version and restore the pre-upgrade backup. With `GRC_IMAGE` pinned to a version,
change it in `.env` first. A build from source upgrades with `git pull` and
`docker compose up -d --build`.

## PostgreSQL variant

`compose.postgres.yaml` adds a PostgreSQL 17 server and points the application at it.
Attached files, backups and the key stay in the application's volumes; the database lives
in the `sandpiper-grc_grc-pg` volume.

```sh
openssl rand -hex 24 > deploy/secrets/db_password.txt     # the database password, git-ignored
docker compose -f compose.yaml -f compose.postgres.yaml up -d
```

The password reaches both containers as a secret file, never as an environment variable.
On Linux the file must be readable by both containers (uid 1000 and the database's own
user): `chmod 644 deploy/secrets/db_password.txt` on a single-user host. Put `COMPOSE_FILE=compose.yaml:compose.postgres.yaml` in `.env` to make this
the default.

The application does not run as the database's administrator. Two accounts
([A least-privilege database role](installation.md#a-least-privilege-database-role)):

| Account | Password | Used for |
|---|---|---|
| `grc` | `deploy/secrets/db_password.txt` | Owns the database and its tables; the database image makes it the server's administrator. The application uses it only at start, to run the migrations and grant `grc_app` its rights (`GRC_DATABASE_MIGRATE_URL`) |
| `grc_app` | Generated, in the `sandpiper-grc_grc-db-app` volume (read-only to the application) | Everything else. It may read and write rows and nothing more: it cannot change tables or triggers, cannot change or delete audit events, and has none of the administrator's features |

A one-off service, `db-roles`, creates `grc_app` (or confirms it) before each start, from
`deploy/postgres/app-role.sh`; it then exits, so `docker compose ps -a` shows it as
`exited (0)`. An installation made before this keeps its data: at the next
`docker compose up -d`, `db-roles` adds the role and the application grants it its rights.
To give `grc_app` a new password, delete the file and start again:
`docker compose -f compose.yaml -f compose.postgres.yaml run --rm --no-deps --entrypoint sh db-roles -c 'rm /run/grc-db/app_password'`, then
`docker compose -f compose.yaml -f compose.postgres.yaml up -d --force-recreate`.

Back up the database with PostgreSQL's own tools while it runs:

```sh
docker compose exec db pg_dump -U grc -Fc grc > grc-$(date +%Y%m%d).dump
```

and the files with a volume backup as above (`grc backup` and `grc restore` copy the
embedded database only, so with PostgreSQL they refuse and say so). See
[PostgreSQL server backups](operations.md#postgresql-server-backups). To move an embedded
installation to PostgreSQL, `grc export-all` on the old one and `grc import-all` on the new
one before the setup wizard ([Export and import](operations.md#export-and-import)).

To use a PostgreSQL server elsewhere instead, do not use `compose.postgres.yaml`; set
`GRC_DATABASE_URL`, `GRC_DATABASE_PASSWORD_FILE` (a mounted secret) and
`GRC_DATABASE_SSL=verify` for the application ([Installation](installation.md#postgresql-server)).

## HTTPS behind a reverse proxy

The container speaks plain HTTP and is told so (`GRC_ALLOW_INSECURE=1`). A reverse proxy in
front terminates HTTPS. The application believes the forwarded headers (`X-Forwarded-For`,
`-Proto`) only from the proxies named in `GRC_TRUST_PROXY`, so audit-log addresses, rate
limits, API token address limits and the `Secure` cookie flag are right and nobody else can
choose them. The default, `gateway`, trusts the Docker host: a proxy on the host that
connects to the published port (`127.0.0.1:8080`, as below) arrives from the container
network's gateway, whose address the application looks up at start and logs
(`GRC_TRUST_PROXY: "gateway" is 172.18.0.1 ...`). Other choices:

| Where the proxy is | `GRC_TRUST_PROXY` |
|---|---|
| On the Docker host, connecting to the published port (the examples below) | `gateway` (default) |
| In a container on the same Compose network | The proxy container's own address: give it a fixed one (`ipv4_address`) and name that |
| No proxy (people connect to the published port directly) | `off` |

Do not use `private`: it trusts every private address, and the people on your own network
have private addresses too, so any of them could set the address the application records for
them and get round the per-address limits. Keep `GRC_BIND=127.0.0.1` with `gateway`: with
the port published on every interface, some Docker set-ups (Docker Desktop in particular)
forward outside connections from the gateway address too.

Caddy, on the same host, obtains and renews the certificate itself:

```caddyfile
grc.example.test {
  reverse_proxy 127.0.0.1:8080
}
```

nginx:

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

Then set, in `.env`, the address people type, for passkeys and the sign-in provider
redirect: `GRC_WEBAUTHN_RP_ID=grc.example.test` and
`GRC_WEBAUTHN_ORIGINS=https://grc.example.test`, and under Administration > Sign-in
providers, on the **Redirect address** card, the **Application address** (`auth.public_url`). Keep `GRC_BIND=127.0.0.1` so only the proxy reaches the port. If the proxy
runs in Compose too, put it on the same network, point it at `app:8080` instead, and set
`GRC_TRUST_PROXY` to its own address (see the table above).

To have the container serve HTTPS itself instead, mount the certificate and key, set
`GRC_TLS_CERT` and `GRC_TLS_KEY`, remove `GRC_ALLOW_INSECURE` (in a `compose.override.yaml`,
set it to `"0"`), set `GRC_TRUST_PROXY=off` (nothing sits in front to forward addresses), and
publish the port where you need it. A renewed certificate written to
the same files is used within `GRC_TLS_RELOAD_SECONDS` (default 60) without a restart, or at
once with `docker compose kill -s HUP app`; a broken one is refused and the old one kept
([Installation](installation.md#https)).

## Troubleshooting

| What you see | What to do |
|---|---|
| `app` stays `starting` or turns `unhealthy` | `docker compose logs app`. The first start creates the database and takes up to a minute |
| `Refusing to serve plain HTTP on 0.0.0.0` | `GRC_ALLOW_INSECURE` was removed without setting `GRC_TLS_CERT` and `GRC_TLS_KEY` |
| `The server is running on this data folder` from a `grc` command | Stop the application first (`docker compose stop app`) and use `docker compose run --rm app grc ...`. After a crash, a stale `grc.pid` can remain: `docker compose run --rm app sh -c 'rm -f /var/lib/sandpiper/data/grc.pid'` |
| `A server (process 1 on <id>, ...) is using this data folder` from a `grc` command or the application | Another container has the data volume: the running `app` beside a `docker compose run`, or a second application container. Stop it first. After a crash the lock (`data/grc.lock`) clears by itself once it has not been touched for a minute, so a container restarted at once may refuse to start for up to a minute and then starts ([Operations](operations.md#stale-pid-file-or-lock)) |
| `app` turns `unhealthy` with PostgreSQL | The health check asks the database (`/api/ready`): see `docker compose logs app` for `[ready] the database is not ready: ...` and check the `db` container |
| `bind: address already in use` | Another program has port 8080: set `GRC_PUBLISH_PORT` in `.env` |
| `EACCES` or `permission denied` under `/var/lib/sandpiper` | A bind-mounted host folder is not writable by uid 1000: `sudo chown -R 1000:1000 <folder>`, or use the named volumes |
| Pull fails with `denied` or `unauthorized` | Compose builds from source instead. To use a release, check the tag exists and the network can reach ghcr.io |
| `GRC_TIMEZONE "..." is not a known time zone` | Use an IANA name such as `Europe/Berlin` |
| Coming from the earlier `compose.yaml` with the `embedded` and `server` profiles | The key was the secret file `deploy/secrets/secret_key.txt`: keep using it with the override example under [Configuration](#configuration). The volumes had other names: move the data across with a volume backup and restore |
| Everything should go | `docker compose down -v` deletes the containers **and the volumes**, including the key |

See also [Operations](operations.md) and [Installation](installation.md).
