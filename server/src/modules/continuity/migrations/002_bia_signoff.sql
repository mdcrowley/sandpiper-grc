-- E31-10: impact analysis sign-off through an approval workflow (approval kind `bia_signoff`).
-- The process owner when the analysis was submitted: the person the default workflow asks to sign it off.
alter table bia_assessments add column if not exists process_owner_id uuid;
