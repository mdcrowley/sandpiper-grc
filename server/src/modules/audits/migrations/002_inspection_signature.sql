-- The signature of completion of an inspection (E38-11, wave 15): who signed it when it was completed
-- (the mobile app asks for a signature; on the web it is optional). The drawn signature itself is a
-- file attached to the inspection; its id is kept in the audit event of the completion.
alter table inspections add column if not exists signed_by_name text;
alter table inspections add column if not exists signed_at timestamptz;
