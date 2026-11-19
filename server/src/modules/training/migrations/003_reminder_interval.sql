-- E10-18: a course may set its own days between overdue reminders; empty uses the module
-- setting training.reminder_interval_days.
alter table courses add column reminder_interval_days int;
