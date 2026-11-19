-- Notification housekeeping (E14-17) and reminders sent once (E08-22 and others).

-- Set when the person deletes the notification. It is hidden at once and removed by the daily
-- housekeeping job later, so a reminder sent "once a day" is not sent again the same day.
alter table notifications add column dismissed_at timestamptz;

-- Reminders that go out once per person and occasion, whatever happens to the notification
-- afterwards: app.notify({ once: '<key>' }). The key names the occasion, for example
-- 'obligation.due:<id>:<due date>'. Rows older than about a year are removed by housekeeping.
create table notification_once (
  user_id uuid not null,
  once_key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, once_key)
);
create index notification_once_created_ix on notification_once (created_at);
