-- E02-30: the directory user name a person last signed in, linked or confirmed with, kept
-- with their linked directory so that the confirmation dialog can fill it in. Never the password.
-- Empty for identities from OpenID Connect and SAML, which have no user name to type.
alter table user_identities add column if not exists login_name text;
