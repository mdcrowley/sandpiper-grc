-- How a session made through a sign-in provider ended up, for the second-factor requirement and for
-- signing out at the provider (E02-22, E02-23).
alter table identity_sessions add column mfa boolean not null default false;          -- the provider showed multi-factor sign-in
alter table identity_sessions add column sid text;                                       -- the provider's session id (back-channel sign-out)
alter table identity_sessions add column id_token_sealed text;                           -- encrypted ID token, kept only when signing out at the provider is on
create index identity_sessions_sid_ix on identity_sessions (provider_id, sid) where sid is not null;

-- Back-channel logout tokens already acted on, so a replayed one does nothing more (kept a day).
create table identity_logout_tokens (
  provider_id uuid not null references identity_providers(id),
  jti text not null,
  received_at timestamptz not null default now(),
  primary key (provider_id, jti)
);
