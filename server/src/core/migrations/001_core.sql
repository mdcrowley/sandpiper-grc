create table departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  email text not null,
  display_name text not null,
  password_hash text,
  status text not null default 'active',          -- pending | active | disabled
  department_id uuid,
  totp_secret text,
  totp_enabled boolean not null default false,
  recovery_codes jsonb not null default '[]',
  failed_attempts int not null default 0,
  locked_until timestamptz,
  password_changed_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index users_username_uq on users (lower(username)) where deleted_at is null;
create unique index users_email_uq on users (lower(email)) where deleted_at is null;

create table password_history (
  id bigserial primary key,
  user_id uuid not null references users(id),
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  enabled boolean not null default true,
  requires_mfa boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission text not null,
  primary key (role_id, permission)
);
create table user_roles (
  user_id uuid not null references users(id),
  role_id uuid not null references roles(id),
  primary key (user_id, role_id)
);

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users(id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ip text,
  user_agent text
);

create table one_time_tokens (
  token_hash text primary key,
  user_id uuid not null references users(id),
  purpose text not null,                           -- setup | reset
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid
);

create table audit_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_name text,
  ip text,
  action text not null,
  record_type text,
  record_id text,
  summary text,
  before jsonb,
  after jsonb
);
create index audit_events_record_ix on audit_events (record_type, record_id);
create index audit_events_at_ix on audit_events (at);

create function audit_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_events is append-only';
end $$;
create trigger audit_events_no_change before update or delete on audit_events
  for each row execute function audit_events_append_only();

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(), updated_by uuid
);

create table lookups (
  id uuid primary key default gen_random_uuid(),
  list_key text not null,
  value text not null,
  label text not null,
  color text not null default 'gray',
  sort int not null default 0,
  active boolean not null default true,
  meta jsonb not null default '{}',
  unique (list_key, value)
);

create table counters (
  key text primary key,
  value int not null
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  record_type text not null,
  record_id uuid not null,
  body text not null,
  internal boolean not null default true,
  author_id uuid,
  author_name text,
  created_at timestamptz not null default now()
);
create index comments_record_ix on comments (record_type, record_id);

create table record_links (
  id uuid primary key default gen_random_uuid(),
  from_type text not null,
  from_id uuid not null,
  to_type text not null,
  to_id uuid not null,
  relation text not null default 'related',
  created_at timestamptz not null default now(), created_by uuid,
  unique (from_type, from_id, to_type, to_id, relation)
);
create index record_links_to_ix on record_links (to_type, to_id);
