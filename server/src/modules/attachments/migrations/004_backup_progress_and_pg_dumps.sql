-- E40-11: "Back up now" runs as a background job, and the page follows its progress; on a
-- PostgreSQL server, dumps made by deploy/postgres/pg-backup.sh are checked and recorded here too.
-- trigger: scheduled | manual | pg_dump (a dump found in the pg_dump folder and checked).
alter table backup_runs add column if not exists progress jsonb;
alter table backup_runs add column if not exists job_id uuid;
create index if not exists backup_runs_trigger_ix on backup_runs (trigger, started_at desc);
create index if not exists backup_runs_running_ix on backup_runs (started_at) where status = 'running';
