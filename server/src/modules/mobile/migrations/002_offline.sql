-- Offline work for the mobile app (wave 14, E38-10): the answers the server gave to the app's outbox
-- items, kept for 7 days so that an item sent again (a lost connection, a retry after a restart) is
-- answered from here instead of being done twice.
--
-- One row per item, keyed by the person and the client-made UUID. `state` is `running` while the item
-- is being done and `done` once it has been; a refused item is not kept (the person may correct it and
-- send it again with the same id). A row left `running` (the server stopped mid-way) is never redone
-- by itself: the item is answered "not sure it arrived" for the person to check.
create table mobile_sync_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  device_id uuid not null,
  client_id uuid not null,
  kind text not null,
  -- SHA-256 of the kind and the payload: the same id with different content is refused.
  fingerprint text not null,
  state text not null check (state in ('running', 'done')),
  record_type text,
  record_id uuid,
  answer jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  expires_at timestamptz not null
);
create unique index mobile_sync_items_client_ux on mobile_sync_items (user_id, client_id);
create index mobile_sync_items_expires_ix on mobile_sync_items (expires_at);

