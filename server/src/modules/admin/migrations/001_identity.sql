-- Single sign-on: sign-in providers, linked identities, per-person sign-in rules, the break-glass
-- account, in-flight sign-ins and how each session was made. Protocol code: server/src/core/identity.

create table identity_providers (
  id uuid primary key default gen_random_uuid(),
  key text not null,                       -- short name used in addresses; fixed once created
  type text not null,                      -- oidc (saml and ldap would be further kinds)
  name text not null,                      -- shown on the sign-in button
  enabled boolean not null default false,  -- nothing is fetched from the provider until this is on
  is_default boolean not null default false,
  config jsonb not null default '{}',
  secret text,                             -- client secret, encrypted (core/secretbox.ts, enc:v1:...)
  sort int not null default 100,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index identity_providers_key_uq on identity_providers (key);
create unique index identity_providers_default_uq on identity_providers ((true)) where is_default and deleted_at is null;

-- One external identity belongs to one person; a person has at most one identity per provider.
create table user_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  provider_id uuid not null references identity_providers(id),
  subject text not null,
  email text,
  link_method text not null,               -- self | sign_in_confirmed | permit | jit
  linked_at timestamptz not null default now(),
  linked_by uuid,
  last_used_at timestamptz,
  unique (provider_id, subject),
  unique (user_id, provider_id)
);
create index user_identities_user_ix on user_identities (user_id);

-- Per-person sign-in rules. No row = no rules.
create table identity_user_settings (
  user_id uuid primary key references users(id),
  break_glass boolean not null default false,
  allowed_methods text[],                  -- null = any; otherwise 'local' and/or provider ids
  permit_provider_id uuid references identity_providers(id),  -- may link by email at next sign-in
  permit_expires_at timestamptz,
  permit_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index identity_one_break_glass on identity_user_settings ((true)) where break_glass;

-- Sign-ins in flight (between leaving for the provider and coming back), and confirmed external
-- identities waiting for a password to link them. Short-lived and single-use.
create table identity_flows (
  state_hash text primary key,
  provider_id uuid not null references identity_providers(id),
  purpose text not null,                   -- signin | link | reauth | pending_link
  remember text,                           -- encrypted nonce and PKCE verifier
  redirect_uri text,
  user_id uuid references users(id),
  session_hash text,
  subject text,
  email text,
  return_to text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index identity_flows_expires_ix on identity_flows (expires_at);

-- How each session was made, for the audit trail and the break-glass banner.
create table identity_sessions (
  token_hash text primary key references sessions(token_hash) on delete cascade,
  method text not null,                    -- local, or a provider key
  provider_id uuid,
  break_glass boolean not null default false,
  created_at timestamptz not null default now()
);
