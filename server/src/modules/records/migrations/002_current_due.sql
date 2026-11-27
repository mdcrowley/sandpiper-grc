-- E18-83: the date a request is due now (the extended date when there is one), for the list's Due
-- column and its filters; and the same date for open requests only, so the default order puts the
-- overdue open requests first (answered and closed ones last). Worked out by the database.
alter table records_requests add column current_due_on date
  generated always as (coalesce(extended_due_on, due_on)) stored;
alter table records_requests add column open_due_on date
  generated always as (case when status in ('responded', 'closed', 'withdrawn', 'refused') then null else coalesce(extended_due_on, due_on) end) stored;
