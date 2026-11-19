-- E12-10: how a scheduled delivery uses email, when an administrator has switched email on.
--   off    - stays in the application (a notification with a link)
--   link   - also an email with a link to the stored copy; no figures leave the application
--   attach - also an email with the PDF, Excel or CSV file attached, for recipients who may export
alter table report_schedules add column if not exists email text not null default 'link';
