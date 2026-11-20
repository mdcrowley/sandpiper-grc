-- SAML 2.0 sign-in (E02-10). Protocol code: server/src/core/identity/saml.ts.

-- The response an identity provider posted to the assertion consumer service, kept (encrypted) only
-- until the browser that started the sign-in comes back for it with its state cookie.
alter table identity_flows add column posted text;

-- Assertions already accepted, so that each one works once (kept until it could no longer be presented).
create table identity_saml_assertions (
  provider_id uuid not null references identity_providers(id),
  assertion_id text not null,
  expires_at timestamptz not null,
  primary key (provider_id, assertion_id)
);
create index identity_saml_assertions_expires_ix on identity_saml_assertions (expires_at);
