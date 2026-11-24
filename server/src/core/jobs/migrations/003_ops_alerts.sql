-- Alerts about background work that keeps failing (E40-04). Applied under the scope "core.jobs".
--
-- One row per problem, by key (`job.dead:<type>`, `mail.failing`, `webhook:<id>`, `forwarder:<id>`,
-- `jobs.stalled`, `jobs.poller:<process>`, ...). A problem is raised when it is first seen and told
-- to the administrators once (`notified_at`, claimed with a conditional update so that two server
-- processes cannot both tell them); seeing it again only moves `last_seen_at`. When it is gone,
-- `cleared_at` is set, and the same problem coming back later is a new occurrence, told again.
create table ops_alerts (
  key text primary key,
  title text not null,
  detail text,
  -- In-app path to open (Background jobs, Email, Webhooks, ...).
  route text,
  opened_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  notified_at timestamptz,
  cleared_at timestamptz,
  -- Occurrences so far (raised again after clearing).
  occurrences int not null default 1
);
create index ops_alerts_open_ix on ops_alerts (opened_at desc) where cleared_at is null;
