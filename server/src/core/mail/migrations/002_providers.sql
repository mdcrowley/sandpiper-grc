-- Mail through a mail service's web interface (E14-25): Microsoft Graph and the Gmail API.
-- Applied under the scope "core.mail".

-- Each provider's own settings, by provider name, never secret:
--   graph: { tenantId, clientId, authMethod: secret|certificate, mailbox, cloud, thumbprint?, certExpires? }
--   gmail: { mailbox, clientEmail, clientId, keyId }
alter table mail_config add column provider_settings jsonb not null default '{}'::jsonb;
-- Each provider's credential, encrypted with the installation's secret key (context "mail:<name>"):
-- graph: the client secret, or the certificate and its private key (PEM); gmail: the service account's JSON key.
-- Kept when another provider is chosen, so email to ticket can read a mailbox through it.
alter table mail_config add column provider_secrets jsonb not null default '{}'::jsonb;
