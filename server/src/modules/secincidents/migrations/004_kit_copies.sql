-- Stored PDF copies of the offline incident kit (E09-16). Made on a schedule, after any change to
-- what the kit contains, and on request. The file is kept in the table as base64 (a kit is tens of
-- kilobytes) so it is in every backup; only the newest copies are kept (setting security.kit_keep).
create table incident_kit_copies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- first | schedule | change | on_demand
  reason text not null,
  produced_by uuid,
  produced_by_name text,
  -- Of the kit's contents, without the time it was made: a different fingerprint means a different kit.
  fingerprint text not null,
  pages integer not null,
  size_bytes integer not null,
  content text not null,
  -- What happened to the email of an automatic copy, for the screen.
  delivery text
);
create index incident_kit_copies_created_ix on incident_kit_copies (created_at desc);
