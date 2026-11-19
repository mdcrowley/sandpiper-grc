-- Idempotency keys for POST create routes (core/api/conventions.ts). A client that sends
-- `Idempotency-Key` with a create gets the original answer again when it repeats the request
-- (for example after a time-out), instead of a second record. Keys expire after 24 hours.
create table if not exists api_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  -- Who sent it: the user, and the token when one was used ('session' otherwise).
  owner text not null,
  key text not null,
  method text not null,
  path text not null,
  -- SHA-256 of the method, route and body: the same key with a different request is refused.
  fingerprint text not null,
  -- Null while the first request is still running.
  status integer,
  content_type text,
  body text,
  record_type text,
  record_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (owner, key)
);
create index if not exists api_idempotency_keys_expires on api_idempotency_keys (expires_at);
