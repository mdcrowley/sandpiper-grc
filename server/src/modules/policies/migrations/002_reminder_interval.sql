-- E10-18: a policy may set its own days between acknowledgment reminders; empty uses the
-- module setting policies.reminder_interval_days.
alter table policies add column reminder_interval_days int;
