-- E10-17: a finding can be raised from an exercise step that was not done or went with issues;
-- the finding remembers its step, so a step raises at most one finding.
alter table exercise_findings add column if not exists step_id uuid;
create index if not exists exercise_findings_step_ix on exercise_findings (step_id) where step_id is not null;
