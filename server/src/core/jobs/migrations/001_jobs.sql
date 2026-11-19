-- The background job queue (E14-12). Applied under the scope "core.jobs".

create table jobs (
  id uuid primary key default gen_random_uuid(),
  -- Registered by a module: jobs.register('<type>', handler). Types with no handler in this
  -- process are left alone (their module may not be loaded here).
  type text not null,
  payload jsonb not null default '{}',
  -- queued: waiting for run_at; running: claimed, held until locked_until;
  -- failed: the last attempt failed and another is due at run_at;
  -- done: finished; dead: gave up after max_attempts, or a permanent error.
  status text not null default 'queued',
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null default 5,
  -- First wait after a failure; it doubles with each attempt (capped at six hours).
  backoff_seconds int not null default 60,
  -- The lease: a process that crashes mid-job leaves status 'running' with locked_until in the
  -- past, and any poller may claim the job again.
  locked_by text,
  locked_until timestamptz,
  -- Set by enqueue({ key }): at most one queued, failed or running job per key.
  dedupe_key text,
  -- The schedule that queued it, if any.
  schedule text,
  result jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index jobs_due_ix on jobs (run_at) where status in ('queued', 'failed');
create index jobs_lease_ix on jobs (locked_until) where status = 'running';
create index jobs_recent_ix on jobs (created_at desc);
create index jobs_status_ix on jobs (status, created_at desc);
create unique index jobs_dedupe_ix on jobs (dedupe_key) where dedupe_key is not null and status in ('queued', 'failed', 'running');

-- Recurring work. The poller that moves next_run_at forward (a conditional update) is the one
-- that queues the run, so two processes cannot both queue it.
create table job_schedules (
  name text primary key,
  type text not null,
  payload jsonb not null default '{}',
  every_seconds int not null,
  next_run_at timestamptz not null default now(),
  last_run_at timestamptz,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
