-- Removed files are purged from storage after a set period (E14-15); a file found infected by a
-- later scan is removed at once (E14-14). The row stays as the record of what was there.
alter table attachments add column purged_at timestamptz;
-- Why the file was removed: removed (by a person), record_gone (its record was deleted for good),
-- infected (found by the malware scanner after it was attached).
alter table attachments add column removed_reason text;
create index attachments_removed_ix on attachments (deleted_at) where deleted_at is not null and purged_at is null;

-- Backups taken by the running server to a second location (E16-08, E16-17).
create table backup_runs (
  id uuid primary key default gen_random_uuid(),
  -- scheduled | manual
  trigger text not null,
  -- running | ok | failed
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- Where it went, as shown to administrators (a folder path, or the object store and prefix).
  destination text,
  archive_name text,
  bytes bigint,
  encrypted boolean not null default false,
  verified boolean not null default false,
  pruned text[] not null default '{}',
  message text,
  created_by uuid
);
create index backup_runs_started_ix on backup_runs (started_at desc);
