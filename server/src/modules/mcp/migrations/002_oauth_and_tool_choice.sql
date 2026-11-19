-- E21-16 OAuth 2.1 for remote connectors, E21-19 tool choice per token, E13-14 request ids in the call log.

-- Connectors (OAuth clients): registered by themselves (RFC 7591, when an administrator allows it)
-- or by an administrator. Only the SHA-256 of a client secret is kept.
create table mcp_oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  secret_hash text,
  name text not null,
  redirect_uris jsonb not null,
  auth_method text not null default 'none',
  client_uri text,
  registered_by text not null default 'dynamic',
  created_at timestamptz not null default now(),
  created_by uuid,
  created_ip text,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid
);

-- Authorization codes: single use, a few minutes, bound to the client, redirect address and PKCE challenge.
create table mcp_oauth_codes (
  code_hash text primary key,
  client_id text not null,
  user_id uuid not null,
  redirect_uri text not null,
  code_challenge text not null,
  scope text not null,
  permissions jsonb not null,
  resource text,
  grant_days integer not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  grant_id uuid,
  created_at timestamptz not null default now()
);

-- One grant per consent: what a person allowed one connector to do, until it expires or is revoked.
-- Its id is the "token id" in audit events and the call log.
create table mcp_oauth_grants (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  user_id uuid not null,
  name text not null,
  scope text not null,
  permissions jsonb not null,
  resource text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  last_used_ip text,
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_reason text
);
create index mcp_oauth_grants_user_ix on mcp_oauth_grants (user_id);
create index mcp_oauth_grants_client_ix on mcp_oauth_grants (client_id);

-- Access tokens (an hour) and refresh tokens (rotated on every use), stored as SHA-256 only.
create table mcp_oauth_tokens (
  token_hash text primary key,
  grant_id uuid not null references mcp_oauth_grants (id) on delete cascade,
  kind text not null check (kind in ('access', 'refresh')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index mcp_oauth_tokens_grant_ix on mcp_oauth_tokens (grant_id);

-- The tools one token (or OAuth grant) is limited to; no row = not limited.
create table mcp_token_tools (
  token_id uuid primary key,
  tools jsonb not null,
  updated_at timestamptz not null default now()
);

alter table mcp_calls add column if not exists request_id text;
