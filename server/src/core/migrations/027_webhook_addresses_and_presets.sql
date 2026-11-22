-- E22-45: webhook addresses are kept encrypted with the secret box (core/secretbox.ts), like the
-- signing secret, because many receivers put their own secret in the address. `url` is blanked once
-- the address is sealed (at start-up for rows written before this migration: core/webhooks.ts);
-- `url_host` (scheme, host and port) and `url_fingerprint` (the first 12 hex characters of the
-- address's SHA-256) are what the administrators' screen and the audit log show.
-- E36-04: `preset` chooses the body a delivery carries: plain_json (the full event, as before),
-- chat_text or chat_card (generic chat formats). The signature is the same for every preset.
alter table webhooks add column if not exists url_sealed text;
alter table webhooks add column if not exists url_host text;
alter table webhooks add column if not exists url_fingerprint text;
alter table webhooks add column if not exists preset text not null default 'plain_json';
