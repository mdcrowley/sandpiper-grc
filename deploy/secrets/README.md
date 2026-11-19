# Secrets for compose.yaml

Create these files here before the first `docker compose up`. They are git-ignored and are
never copied into the image.

| File | Contents | Needed by |
|---|---|---|
| `secret_key.txt` | 64 hexadecimal characters: `openssl rand -hex 32` | both profiles |
| `db_password.txt` | the database password: `openssl rand -base64 32 \| tr -d '/+='` | `server` profile (create it for `embedded` too; it is not used) |

The application runs as user 1000 inside the container and must be able to read them:
`chmod 644 *.txt` on a single-user host, or `chown 1000 *.txt && chmod 400 *.txt`.

Keep a copy of `secret_key.txt` somewhere safe and separate from backups: without it, the
authenticator keys in the database cannot be read. See `docs/installation.md`, "Containers".
