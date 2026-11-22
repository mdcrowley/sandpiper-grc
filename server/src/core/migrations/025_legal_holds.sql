-- Legal holds (wave 11 contract C1, E34). Core tables, so a hold applies even when the holds module or
-- the area a held record belongs to is not loaded or is switched off: core/holds.ts reads them on every
-- delete, purge, anonymize and file removal. Permission module `legal`; record type `legal_hold`.

create table legal_holds (
  id uuid primary key default gen_random_uuid(),
  ref text unique,                                   -- LGH-00001
  matter text not null,                              -- what the hold is for; never shown in a refusal
  description text,
  custodian_id uuid,                                 -- a user: who looks after the hold
  counsel_name text,                                 -- the lawyer or firm advising, as typed (personal)
  starts_on date,
  ends_on date,                                      -- expected end only: a hold stays until it is released
  status text not null default 'active',             -- legal_hold_status: active | released
  released_on date,
  released_by_name text,
  release_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

-- The records a hold covers. A row taken off the hold keeps its history (released_at), and a saved
-- query never puts back a record taken off by hand.
create table legal_hold_records (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null references legal_holds(id),
  record_type text not null,
  record_id uuid not null,
  query_id uuid,                                     -- the saved query that added it; null when added by hand
  added_by uuid,
  added_at timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid,
  unique (hold_id, record_type, record_id)
);
create index legal_hold_records_record_ix on legal_hold_records (record_type, record_id) where released_at is null;

-- Saved queries: every record of a type matching a search and filters, in the list API's shape
-- (`q` and `f.<field>` filters). Run when saved and nightly as system work; they only ever add.
create table legal_hold_queries (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null references legal_holds(id),
  record_type text not null,
  q text,
  filters jsonb not null default '{}',               -- { "f.status": "closed", "f.created_at.lt": "2026-01-01" }
  last_run_at timestamptz,
  matched int not null default 0,
  created_at timestamptz not null default now(), created_by uuid
);
create index legal_hold_queries_hold_ix on legal_hold_queries (hold_id);
