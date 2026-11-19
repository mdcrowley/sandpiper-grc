-- Passkeys and security keys (E02-08). Implemented in server/src/core/webauthn/.

-- One row per registered authenticator credential. The public key is not secret; the private key
-- never leaves the authenticator. A removed key keeps its row (revoked_at) so history stays readable
-- and a revoked credential is recognized and refused rather than treated as unknown.
create table webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  credential_id text not null,            -- base64url, as the browser reports it
  public_key text not null,               -- SubjectPublicKeyInfo (DER), base64
  alg int not null,                       -- COSE algorithm: -7 ES256, -257 RS256, -8 EdDSA
  sign_count bigint not null default 0,
  rp_id text not null,                    -- the relying-party ID it was registered for
  name text not null,
  transports jsonb not null default '[]',
  aaguid text,
  attestation_format text,
  user_verified boolean not null default false,   -- user verification was performed at registration
  backup_eligible boolean not null default false, -- a synced passkey (may live on several devices)
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_used_ip text,
  revoked_at timestamptz,
  revoked_by uuid
);
create unique index webauthn_credentials_cid_uq on webauthn_credentials (credential_id);
create index webauthn_credentials_user_ix on webauthn_credentials (user_id) where revoked_at is null;

-- Challenges issued for a ceremony; each is used once and expires after a few minutes.
-- Only a hash of the challenge is kept.
create table webauthn_challenges (
  challenge_hash text primary key,
  purpose text not null,                  -- register | login
  user_id uuid,                           -- register: the person; login: set when a username was given
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index webauthn_challenges_exp_ix on webauthn_challenges (expires_at);
