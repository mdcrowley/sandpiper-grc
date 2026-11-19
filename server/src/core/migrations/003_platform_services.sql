-- Platform services: API tokens (E02-12), webhooks (E13-06), full-text search of comments (E14-07),
-- custom fields (E14-02), tags (E14-08), watchers (E14-09), per-user preferences (E01-24) and
-- retention (E14-11).

-- E02-12: personal access tokens. Only the SHA-256 of a token is stored; `prefix` is its first
-- characters, kept so a person can tell their tokens apart.
create table api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  name text not null,
  token_hash text not null unique,
  prefix text not null,
  scopes jsonb not null default '[]',
  expires_at timestamptz not null,
  last_used_at timestamptz,
  last_used_ip text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid
);
create index api_tokens_user_ix on api_tokens (user_id);

-- E02-12: which API token (if any) made the change.
alter table audit_events add column token_id uuid;
alter table audit_events add column token_name text;

-- E13-06: outbound webhooks. The signing secret is stored encrypted (core/secretbox.ts).
create table webhooks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  secret text not null,
  events jsonb not null default '[]',              -- ["ticket.create", "ticket.*", "*"]
  active boolean not null default true,
  include_restricted boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references webhooks(id),
  event text not null,
  record_type text,
  record_id uuid,
  payload jsonb not null,
  status text not null default 'pending',          -- pending | delivered | failed | blocked
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  response_status int,
  last_error text,
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz
);
create index webhook_deliveries_due_ix on webhook_deliveries (status, next_attempt_at);
create index webhook_deliveries_hook_ix on webhook_deliveries (webhook_id, created_at);

-- E14-07: comments are searched with the record they belong to.
alter table comments add column search_vector tsvector;
create function comments_search_tg() returns trigger language plpgsql as $$
begin
  new.search_vector := to_tsvector('english', coalesce(new.body, '')) || to_tsvector('simple', coalesce(new.body, ''));
  return new;
end $$;
create trigger comments_search before insert or update on comments
  for each row execute function comments_search_tg();
update comments set search_vector = to_tsvector('english', coalesce(body, '')) || to_tsvector('simple', coalesce(body, ''));
create index comments_search_ix on comments using gin (search_vector);

-- E14-07: one search vector per record, written by a trigger on each record table that the resource
-- engine generates at start-up (core/search.ts). A side table keeps module tables unchanged.
create table search_index (
  record_type text not null,
  record_id uuid not null,
  vector tsvector,
  primary key (record_type, record_id)
);
create index search_index_vector_ix on search_index using gin (vector);

-- E14-07: what each record type's search trigger was last built from, so start-up only rebuilds on
-- change. `table_name` holds the record type.
create table search_index_state (
  table_name text primary key,
  signature text not null,
  built_at timestamptz not null default now()
);

-- E14-02: custom field definitions. Values live in a `custom` jsonb column that the resource engine
-- adds to a record table when its first field is defined.
create table custom_fields (
  id uuid primary key default gen_random_uuid(),
  record_type text not null,
  key text not null,                               -- stored under this key; shown to clients as cf_<key>
  label text not null,
  type text not null,                              -- text | longtext | number | currency | date | boolean | select | multiselect | user | ref
  required boolean not null default false,
  list_key text,                                   -- select and multiselect: the configurable list holding the options
  ref_type text,                                   -- ref: the record type linked to
  section text,
  position int not null default 0,
  help text,
  active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (record_type, key)
);

-- E14-08: free-form tags on any record.
create table record_tags (
  record_type text not null,
  record_id uuid not null,
  tag text not null,
  created_at timestamptz not null default now(), created_by uuid,
  primary key (record_type, record_id, tag)
);
create index record_tags_tag_ix on record_tags (record_type, tag);

-- E14-09: people following a record.
create table record_watchers (
  record_type text not null,
  record_id uuid not null,
  user_id uuid not null references users(id),
  created_at timestamptz not null default now(),
  primary key (record_type, record_id, user_id)
);
create index record_watchers_user_ix on record_watchers (user_id);

-- E01-24: small per-user values (saved views, column choices, overview widgets).
create table user_preferences (
  user_id uuid not null references users(id),
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- E14-11: how long each record type is kept, and the records flagged for review once past it.
create table retention_policies (
  record_type text primary key,
  period_months int not null,
  category text,                                   -- a value of the configurable list retention_category
  basis text not null default 'updated_at',        -- created_at | updated_at: what the period is counted from
  active boolean not null default true,
  notes text,
  updated_at timestamptz not null default now(), updated_by uuid
);

create table retention_reviews (
  id uuid primary key default gen_random_uuid(),
  record_type text not null,
  record_id uuid not null,
  record_label text,
  flagged_at timestamptz not null default now(),
  basis_at timestamptz,
  status text not null default 'pending',          -- pending | extended | deleted
  extended_until date,
  reason text,
  decided_at timestamptz,
  decided_by uuid,
  unique (record_type, record_id)
);
create index retention_reviews_status_ix on retention_reviews (status, record_type);
