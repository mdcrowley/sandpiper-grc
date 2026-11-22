-- The mobile app (wave 13, E38-02): signed-in installations (devices), the authorization codes of the
-- app's sign-in, and its access and refresh tokens. Codes and tokens are stored as SHA-256 only; the
-- installation id the app sends is stored as SHA-256 too (it binds the tokens to the installation).

-- One row per signed-in installation of the app for one person. Revoking it (signing it out) ends every
-- token of it at once: the token lookups require revoked_at is null.
create table mobile_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  installation_hash text not null,
  name text not null,
  platform text not null check (platform in ('ios', 'android')),
  app_version text not null,
  created_at timestamptz not null default now(),
  -- The last full sign-in through the browser (a code exchange); a refresh does not move it.
  signed_in_at timestamptz not null default now(),
  -- The recent sign-in claim: when the person last proved their password (or second factor) for a
  -- prompt=login sign-in. Sensitive actions accept it for auth.reauth_minutes. Never set by a refresh.
  auth_time timestamptz,
  last_used_at timestamptz,
  last_used_ip text,
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_reason text
);
create index mobile_devices_user_ix on mobile_devices (user_id);
create unique index mobile_devices_active_ux on mobile_devices (user_id, installation_hash) where revoked_at is null;

-- Authorization codes: single use, five minutes, bound to the PKCE challenge and the installation.
create table mobile_codes (
  code_hash text primary key,
  user_id uuid not null,
  installation_hash text not null,
  device_name text not null,
  platform text not null,
  app_version text not null,
  code_challenge text not null,
  prompt_login boolean not null default false,
  auth_time timestamptz,
  expires_at timestamptz not null,
  used_at timestamptz,
  device_id uuid,
  created_at timestamptz not null default now()
);

-- Access tokens (minutes) and refresh tokens (rotated on every use; a used one presented again revokes the
-- device, except one retry within 30 seconds while the pair it gave was never used). Each answer is a pair
-- (pair_id). used_at: a refresh token's rotation, an access token's first use. rotated_to: the pair a refresh
-- token gave. retried_at: when its one retry was answered. superseded_at: a pair replaced by a retry (presenting
-- its refresh token signs the device out).
create table mobile_tokens (
  token_hash text primary key,
  device_id uuid not null references mobile_devices (id) on delete cascade,
  kind text not null check (kind in ('access', 'refresh')),
  pair_id uuid not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  rotated_to uuid,
  retried_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now()
);
create index mobile_tokens_device_ix on mobile_tokens (device_id);
create index mobile_tokens_pair_ix on mobile_tokens (pair_id);
