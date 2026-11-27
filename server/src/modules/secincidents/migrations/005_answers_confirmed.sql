-- E18-77: when the notification questions (the Affected tab) were last answered. Until then an
-- incident with no clock says the questions are unanswered, not that no notification is required.
alter table security_incidents add column answers_confirmed_at timestamptz;
-- Incidents declared before this column existed went through the declare flow's questions.
update security_incidents set answers_confirmed_at = coalesce(declared_at, created_at) where declared_at is not null;
