-- Wave 11, E36-01 and E36-02: user provisioning (SCIM 2.0) and audit-log forwarding. Always loaded,
-- and off until an administrator sets them up.

-- Provisioning tokens. Only the SHA-256 of a token is kept; `prefix` (its first characters) tells
-- tokens apart. `allowed_addresses`: addresses or CIDR ranges it may be used from (null = any).
create table scim_tokens (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  prefix text not null,
  token_hash text not null unique,
  allowed_addresses jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  last_used_at timestamptz,
  last_used_ip text,
  revoked_at timestamptz,
  revoked_by uuid
);

-- Groups the identity provider pushes. A group grants nothing until an administrator maps it to roles
-- (`role_keys`); roles that can administer are never granted this way.
create table scim_group_roles (
  id uuid primary key default gen_random_uuid(),       -- the SCIM id of the group
  display_name text not null,
  external_id text,
  role_keys jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  mapped_at timestamptz,
  mapped_by uuid
);
create unique index scim_group_roles_name_ix on scim_group_roles (lower(display_name));

create table scim_group_members (
  group_id uuid not null references scim_group_roles(id) on delete cascade,
  user_id uuid not null,
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index scim_group_members_user_ix on scim_group_members (user_id);

-- Roles provisioning gave a person (through a mapped group), so only those are taken away again when
-- the person leaves the group: a role an administrator gave by hand is never removed by provisioning.
create table scim_role_grants (
  user_id uuid not null,
  role_id uuid not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

-- The identity provider's own ids for accounts (users' columns are not changed). `user_name` is the
-- SCIM userName as sent; `deactivated` says provisioning (not an administrator) disabled the account,
-- so provisioning may enable it again.
create table user_external_ids (
  user_id uuid not null,
  source text not null default 'scim',
  external_id text,
  user_name text,
  deactivated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, source)
);
create unique index user_external_ids_external_ix on user_external_ids (source, external_id) where external_id is not null;
create unique index user_external_ids_name_ix on user_external_ids (source, lower(user_name)) where user_name is not null;

-- Audit-log forwarders. Syslog (RFC 5424 over TLS, or plain TCP inside a trusted network) or JSON lines
-- over HTTPS. The HTTPS address and the secret are sealed with the secret key. `cursor_id` is the last
-- audit event sent; `claimed_until` lets one run at a time work on a forwarder.
create table audit_forwarders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('syslog_tls', 'syslog_tcp', 'https_json')),
  host text not null,
  port integer,
  url_sealed text,
  secret_sealed text,
  ca_cert text,
  format text not null default 'rfc5424' check (format in ('rfc5424', 'json_lines')),
  include_actions jsonb not null default '[]',
  active boolean not null default false,
  cursor_id bigint not null default 0,
  claimed_until timestamptz,
  failures integer not null default 0,
  retry_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table audit_forward_log (
  id uuid primary key default gen_random_uuid(),
  forwarder_id uuid not null references audit_forwarders(id),
  from_id bigint,
  to_id bigint,
  count integer not null default 0,
  status text not null,                  -- sent | failed | test
  error text,
  attempted_at timestamptz not null default now()
);
create index audit_forward_log_forwarder_ix on audit_forward_log (forwarder_id, attempted_at desc);
create index audit_forward_log_at_ix on audit_forward_log (attempted_at);
