-- Notifications by email (E14-04).

-- How each kind reaches the person: { "<kind>": "app" | "email" | "both" | "none" }.
-- A kind not named here is "app". "none" is also kept in muted_kinds, as before.
alter table notification_preferences add column channels jsonb not null default '{}';
-- The day (organization time zone) the last daily summary was sent.
alter table notification_preferences add column last_digest_on date;

-- false: the person chose email only for this kind, so the bell and the list leave it out.
alter table notifications add column in_app boolean not null default true;
-- null: not for email; queued: a message was queued; digest: waiting for the daily summary;
-- digested: included in a summary; skipped: email was off or the person has no address.
alter table notifications add column email_state text;
create index notifications_digest_ix on notifications (user_id, created_at) where email_state = 'digest';
