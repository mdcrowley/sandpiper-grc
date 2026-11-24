#!/bin/sh
# Sandpiper GRC on a PostgreSQL server: a verified pg_dump backup that the application checks.
#
#   deploy/postgres/pg-backup.sh <backup folder> [keep]
#
# Connection: the usual libpq variables (PGHOST, PGPORT, PGUSER, PGDATABASE, PGPASSWORD or
# PGPASSFILE, PGSSLMODE), or GRC_PG_DUMP_URL with a connection string. Use the owner account or any
# account that may read every table (the application's least-privilege role can read them all).
#
# What it does (docs/operations.md, "PostgreSQL server backups"):
# 1. pg_dump --format=custom into <folder>/grc-db-<yyyyMMdd-HHmmss>.dump.partial, then checks that
#    pg_restore can read its table of contents, and renames it to .dump only then;
# 2. writes <file>.dump.json beside it: when it started and finished, its size, its SHA-256 and how
#    many entries pg_restore listed. Administration > Backups reads these files (set "pg_dump
#    folder" there to this folder, as the server sees it), checks each new dump's size and checksum,
#    records it, and warns the administrators when the newest good one is older than the limit set
#    there;
# 3. keeps the newest [keep] dumps (default 14) and deletes older grc-db-* files.
# It exits non-zero, and writes no .json, when any step fails, so a failed dump never counts.
#
# Run it from cron or a systemd timer, for example every night at 02:15:
#   15 2 * * * PGHOST=db.example.internal PGUSER=grc PGDATABASE=grc PGPASSFILE=/etc/sandpiper-grc/pgpass /opt/sandpiper-grc/deploy/postgres/pg-backup.sh /srv/backups/grc 14
# With compose.postgres.yaml:
#   docker compose exec -T db sh -s /backups 14 < deploy/postgres/pg-backup.sh
# (mount the same backup volume into the application container and name it in Administration > Backups).
set -eu

folder="${1:?usage: pg-backup.sh <backup folder> [keep]}"
keep="${2:-14}"
case "$keep" in ''|*[!0-9]*) echo "pg-backup: keep must be a whole number" >&2; exit 2 ;; esac
[ "$keep" -ge 1 ] || { echo "pg-backup: keep must be 1 or more" >&2; exit 2; }

umask 077
mkdir -p "$folder"
stamp="$(date -u +%Y%m%d-%H%M%S)"
name="grc-db-$stamp.dump"
target="$folder/$name"
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cleanup() { rm -f "$target.partial" "$target.json.partial"; }
trap cleanup EXIT

if [ -n "${GRC_PG_DUMP_URL:-}" ]; then
  pg_dump --format=custom --no-owner --file="$target.partial" --dbname="$GRC_PG_DUMP_URL"
else
  pg_dump --format=custom --no-owner --file="$target.partial"
fi

# A dump pg_restore cannot read is no backup.
entries="$(pg_restore --list "$target.partial" | grep -c -v '^;' || true)"
[ "${entries:-0}" -gt 0 ] || { echo "pg-backup: pg_restore could not read the dump" >&2; exit 1; }

bytes="$(wc -c <"$target.partial" | tr -d ' ')"
if command -v sha256sum >/dev/null 2>&1; then sum="$(sha256sum "$target.partial" | cut -d' ' -f1)"
else sum="$(shasum -a 256 "$target.partial" | cut -d' ' -f1)"; fi
version="$(pg_dump --version | awk '{print $NF}')"
finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mv "$target.partial" "$target"
cat >"$target.json.partial" <<JSON
{
  "kind": "sandpiper-pg-dump",
  "file": "$name",
  "startedAt": "$started",
  "finishedAt": "$finished",
  "bytes": $bytes,
  "sha256": "$sum",
  "entries": $entries,
  "pgDumpVersion": "$version"
}
JSON
mv "$target.json.partial" "$target.json"
echo "pg-backup: $target ($bytes bytes, $entries entries, sha256 $sum)"

# Keep the newest $keep dumps (names sort by time).
ls -1 "$folder" | grep -E '^grc-db-[0-9]{8}-[0-9]{6}\.dump$' | sort -r | tail -n +"$((keep + 1))" | while read -r old; do
  rm -f "$folder/$old" "$folder/$old.json"
  echo "pg-backup: removed $old"
done
