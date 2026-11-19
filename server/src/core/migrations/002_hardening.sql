-- Account-security and platform hardening (E01-21, E01-22, E01-23, E02-05, E02-06, E18-21).

-- E01-23: which permission module owns a configurable list, and whether every signed-in user may read it.
create table lookup_lists (
  list_key text primary key,
  module text,
  public boolean not null default false
);

-- E02-06: the last accepted time step of the authenticator code, so a code cannot be used twice.
alter table users add column totp_last_step bigint;
-- E02-05: when the second factor first became required of this user (start of any grace period).
alter table users add column mfa_required_since timestamptz;

-- E01-21: when the password was last proved in this session (sign-in or POST /api/auth/confirm).
alter table sessions add column confirmed_at timestamptz;

-- E01-22: failure counters for the rate limiters, kept in the database so a restart does not reset them.
create table rate_limit_hits (
  id bigserial primary key,
  bucket text not null,
  key text not null,
  at timestamptz not null default now()
);
create index rate_limit_hits_ix on rate_limit_hits (bucket, key, at);

-- E18-21: default grants already offered to each default role, so "sync default grants" only adds new ones.
create table role_default_grants (
  role_key text not null,
  permission text not null,
  applied_at timestamptz not null default now(),
  primary key (role_key, permission)
);
