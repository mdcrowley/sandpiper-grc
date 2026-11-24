-- Confidential safety reporting and telling the reporter what was done (E41-05).
--
-- A reporter may ask for their identity to be kept confidential. The event then never holds it:
-- `reported_by_id` stays empty and the reporter is kept in `safety_confidential_reporters`, which
-- only the people named in `safety_confidential_viewers` may read, each look audited. Exports,
-- search, the assistant, webhooks and reports read the event row, so they never see the identity.
--
-- When an event with a reporter closes, the reporter is told in plain words what was done
-- (`reporter_outcome`), and the time they were told is recorded (`reporter_told_at`).

alter table safety_events add column confidential_reporter boolean not null default false;
alter table safety_events add column reporter_outcome text;
alter table safety_events add column reporter_told_at timestamptz;

create table safety_confidential_reporters (
  event_id uuid primary key references safety_events(id) on delete cascade,
  -- The reporter's account; null for an anonymous report (nobody to tell).
  user_id uuid,
  created_at timestamptz not null default now()
);
create index safety_confidential_reporters_user_ix on safety_confidential_reporters (user_id);

-- The people named to see a confidential reporter's identity (Administration > Confidential safety reports).
create table safety_confidential_viewers (
  user_id uuid primary key,
  added_by uuid,
  added_at timestamptz not null default now()
);
