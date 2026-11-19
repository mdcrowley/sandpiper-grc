-- In-app notifications and each person's choices about them.

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  -- A value of the configurable list `notification_kind` (unknown kinds are still delivered).
  kind text not null default 'general',
  title text not null,
  body text,
  -- Where selecting the notification goes: an in-app path such as /tickets/<id>.
  route text,
  -- The record it is about, when there is one. No foreign key: record types belong to other modules.
  record_type text,
  record_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_ix on notifications (user_id, created_at desc);
create index notifications_unread_ix on notifications (user_id) where read_at is null;
create index notifications_record_ix on notifications (record_type, record_id, kind, user_id);

create table notification_preferences (
  user_id uuid primary key,
  -- Kinds this person has switched off.
  muted_kinds jsonb not null default '[]',
  -- Stored for email delivery later: one summary a day instead of a message per event.
  daily_digest boolean not null default false,
  updated_at timestamptz not null default now()
);
