-- Failed attempts, self-certified completion, notification markers, and exercise checklists.
-- Additive; existing rows keep working.

-- The day of the latest attempt that did not pass. A record with an attempt and no
-- completion date is still due: a failed result never counts as complete.
alter table training_records add column if not exists attempted_on date;
-- Completed by the person themselves, on a course that allows it (with their evidence note).
alter table training_records add column if not exists self_certified boolean not null default false;
-- When the person was told the training was assigned to them, and last reminded it is overdue.
alter table training_records add column if not exists assigned_notified_at timestamptz;
alter table training_records add column if not exists overdue_reminded_at timestamptz;

-- Rows written before this change: a "did not pass" completion with nothing later for the
-- same person and course becomes an attempt, so the training is due again (it was wrongly
-- counted as complete). A failed result followed by a later completion stays as history.
-- 1. Where the person already has a record to complete, the attempt is noted on it and the
--    failed row is removed (soft delete), so they do not have two records to complete.
update training_records o set attempted_on = f.completed_on, score = coalesce(o.score, f.score), result = f.result
from training_records f
where f.deleted_at is null and f.completed_on is not null and f.result = 'failed'
  and o.deleted_at is null and o.completed_on is null and o.course_id = f.course_id and o.person_key = f.person_key
  and not exists (select 1 from training_records l where l.deleted_at is null and l.course_id = f.course_id
                    and l.person_key = f.person_key and l.completed_on > f.completed_on);
update training_records f set deleted_at = now()
where f.deleted_at is null and f.completed_on is not null and f.result = 'failed'
  and exists (select 1 from training_records o where o.deleted_at is null and o.completed_on is null
                and o.course_id = f.course_id and o.person_key = f.person_key and o.attempted_on = f.completed_on);
-- 2. Otherwise the failed row itself becomes the record to complete.
update training_records f set attempted_on = completed_on, completed_on = null
where f.deleted_at is null and f.completed_on is not null and f.result = 'failed'
  and not exists (select 1 from training_records l where l.deleted_at is null and l.id <> f.id and l.course_id = f.course_id
                    and l.person_key = f.person_key and (l.completed_on is null or l.completed_on > f.completed_on));

-- Nobody is told now about training assigned before notifications existed.
update training_records set assigned_notified_at = now() where assigned_notified_at is null;

-- A course people may mark complete themselves.
alter table courses add column if not exists self_certify boolean not null default false;

-- The steps of an exercise, copied from a security incident scenario checklist (or added by
-- hand), with how each went.
create table if not exists exercise_steps (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references exercises(id),
  phase text,
  step text not null,
  sort int not null default 0,
  outcome text,                     -- lookup exercise_step_outcome
  notes text,
  source_scenario text,             -- the incident scenario the step was copied from
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index if not exists exercise_steps_exercise_ix on exercise_steps (exercise_id, sort);
