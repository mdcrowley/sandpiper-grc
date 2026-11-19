# Secrets for Docker Compose

Files here are git-ignored and never copied into the image. See `docs/docker.md`.

| File | Contents | Needed by |
|---|---|---|
| `db_password.txt` | the database password: `openssl rand -hex 24 > deploy/secrets/db_password.txt` | `compose.postgres.yaml` |
| `secret_key.txt` | optional: your own secret key, 64 hex characters (`openssl rand -hex 32`) | a `compose.override.yaml` that mounts it (example in `docs/docker.md`, "Configuration") |

Without `secret_key.txt`, the application generates its key on first start in the `grc-key`
volume, apart from the data. Either way, keep a copy of the key somewhere safe and separate
from backups: without it, the authenticator keys in the database cannot be read.

The application runs as uid 1000 inside the container and must be able to read these files:
`chmod 644 *.txt` on a single-user host.
