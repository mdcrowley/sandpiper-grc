-- Application portfolio facts on systems (E45-42): the version in use, the date the vendor stops
-- supporting it (with reminders, as assets have) and what the system costs each year.
alter table systems add column if not exists version text;
alter table systems add column if not exists support_end date;
alter table systems add column if not exists annual_cost numeric;
