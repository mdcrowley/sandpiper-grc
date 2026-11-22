-- Calendar feeds (E36-03): a person's own ICS address. Only the SHA-256 of the secret in the address
-- is kept; the address is shown once, when the feed is made. Revoking stops it at once.
create table calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  token_hash text not null unique,
  -- Calendar source keys (core/calendar.ts) chosen for this feed.
  sources jsonb not null default '[]',
  -- titles: record titles are shown; busy: only what kind of date it is.
  detail text not null default 'titles' check (detail in ('titles', 'busy')),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid
);
create index calendar_feeds_user_ix on calendar_feeds (user_id) where revoked_at is null;

-- Ticketing bridge (E36-06): connections to an outside ticketing tool. Off until an administrator
-- adds and switches one on. Addresses and secrets are sealed with the secret key.
create table ticket_connectors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Where actions and vulnerabilities are sent (sealed), with its host shown to administrators.
  url_sealed text not null,
  url_host text not null,
  -- Signs what is sent (X-GRC-Signature, as webhooks) and checks status updates that come back.
  secret_sealed text not null,
  inbound_secret_sealed text not null,
  active boolean not null default false,
  -- Record types it carries: action and/or vulnerability.
  record_types jsonb not null default '["action"]',
  -- Send automatically when a record of these types is created.
  push_on_create boolean not null default false,
  -- Restricted records are never sent unless this is set (needs security.view).
  include_restricted boolean not null default false,
  -- { "<outside status>": "<our status>" } per record type: { "action": { "Resolved": "done" } }
  status_map jsonb not null default '{}',
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table external_ticket_links (
  id uuid primary key default gen_random_uuid(),
  connector_id uuid not null references ticket_connectors(id),
  record_type text not null,
  record_id uuid not null,
  external_id text,
  external_url text,
  external_status text,
  -- push_requested_at: someone asked for it to be sent; push_claimed_at: a run has taken it.
  push_requested_at timestamptz,
  push_claimed_at timestamptz,
  pushed_at timestamptz,
  push_attempts int not null default 0,
  push_error text,
  synced_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid
);
create unique index external_ticket_links_uq on external_ticket_links (connector_id, record_type, record_id);
create index external_ticket_links_pending_ix on external_ticket_links (push_requested_at) where pushed_at is null;

-- Signatures of status updates already accepted, so a copy sent again is refused (the last 1,000 per connector).
create table ticket_inbound_signatures (
  connector_id uuid not null references ticket_connectors(id),
  signature text not null,
  seen_at timestamptz not null default now(),
  primary key (connector_id, signature)
);
