-- Push notifications on the phone (E38-14): the administrator's push credentials, each signed-in
-- phone's push registration, and how far each person has been told.

-- One row (id = 1). Keys are sealed with the application's secret key (core/secretbox.ts) and never
-- leave the server; the fingerprints let an administrator tell which key is stored.
create table push_config (
  id int primary key check (id = 1),
  apns_enabled boolean not null default false,
  apns_key_id text not null default '',
  apns_team_id text not null default '',
  apns_bundle_id text not null default 'com.sandpipergrc',
  apns_key_sealed text,
  apns_key_fingerprint text,
  fcm_enabled boolean not null default false,
  fcm_project_id text not null default '',
  fcm_client_email text not null default '',
  fcm_key_sealed text,
  fcm_key_fingerprint text,
  unifiedpush_enabled boolean not null default false,
  unifiedpush_hosts jsonb not null default '[]',
  unifiedpush_contact text not null default '',
  vapid_public_key text,
  vapid_private_sealed text,
  updated_at timestamptz,
  updated_by uuid
);

-- One registration per signed-in installation of the app (mobile_devices.id; no foreign key across
-- modules). The device token or UnifiedPush endpoint and keys are sealed together as JSON
-- (context push-target:<id>); target_hash finds the same phone registered again under another sign-in.
create table push_registrations (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null unique,
  user_id uuid not null,
  provider text not null check (provider in ('apns', 'fcm', 'unifiedpush')),
  environment text not null default 'production' check (environment in ('production', 'sandbox')),
  target_sealed text not null,
  target_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sent_at timestamptz,
  failures int not null default 0,
  last_error text,
  last_error_at timestamptz
);
create index push_registrations_user_ix on push_registrations (user_id);
create index push_registrations_target_ix on push_registrations (target_hash);

-- How far each person has been told: the newest notification a push has covered. A run claims a
-- person by moving this forward (only one run can), so overlapping runs send once.
create table push_cursor (
  user_id uuid primary key,
  pushed_upto timestamptz not null,
  last_count int not null default 0,
  updated_at timestamptz not null default now()
);

-- A phone that is signed out (by its owner, an administrator, deactivation, the area being switched
-- off) loses its registration at once, whichever path signed it out. Created only when the mobile
-- module's table exists; delivery also skips and removes registrations of signed-out phones.
create function push_forget_device() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    delete from push_registrations where device_id = old.id;
    return old;
  end if;
  if new.revoked_at is not null then
    delete from push_registrations where device_id = new.id;
  end if;
  return new;
end $$;

do $$
begin
  if to_regclass('public.mobile_devices') is not null then
    execute 'create trigger mobile_devices_push_forget after update of revoked_at or delete on mobile_devices
      for each row execute function push_forget_device()';
  end if;
end $$;
