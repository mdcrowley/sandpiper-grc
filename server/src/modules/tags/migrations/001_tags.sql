-- Asset tags (wave 13, E37): formats, stock, series, assignments (the history and the uniqueness of
-- tag values across every taggable type), lookups, label layouts, verifications and inventory counts.
-- Spec: docs/roadmap/specs/asset-tags-and-mobile-apps.md §3.4 and §4.5. Record references are plain
-- uuid columns (no foreign keys across modules). `value_key` is always `valueKey(value)` from
-- shared/tag-format.ts: trimmed, uppercase, without spaces, dashes and underscores.

-- What the organization's tags look like (E37-02). Optional; none are supplied.
create table tag_formats (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  characters text not null default 'digits' check (characters in ('digits', 'alphanumeric', 'pattern')),
  -- With characters = 'pattern': the safe pattern the whole value must match (shared/tag-format.ts).
  pattern text,
  -- Written on the tag before the number part, for example 'TA-'; compared by its value key.
  prefix text not null default '',
  -- Length of the part after the prefix, check character included.
  length_min integer,
  length_max integer,
  check_character text not null default 'none' check (check_character in ('none', 'mod10', 'mod11', 'mod36')),
  carrier text not null default 'any' check (carrier in ('any', 'text', 'code', 'both')),
  -- A safe pattern with one marked part (a group) that is the value, for codes holding more than it.
  extract_pattern text,
  -- Record types that use it; empty = every taggable type.
  record_types jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  sort integer not null default 100,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

-- Series for printing your own tags (E37-03): numbers are taken with one atomic update of next_number.
create table tag_series (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  format_id uuid references tag_formats (id),
  prefix text not null default '',
  -- Zero-padded width of the number part (check character not included).
  digits integer not null default 6 check (digits between 1 and 18),
  next_number bigint not null default 1 check (next_number >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

-- Tag stock (E37-03): a sequential range (first_number to last_number, written as prefix + the number
-- zero-padded to `digits` + the format's check character) or a list of values (tag_range_values).
create table tag_ranges (
  id uuid primary key default gen_random_uuid(),
  format_id uuid references tag_formats (id),
  kind text not null default 'sequence' check (kind in ('sequence', 'list')),
  prefix text not null default '',
  digits integer check (digits between 1 and 18),
  first_number bigint,
  last_number bigint,
  -- Value keys of the first and last value, for display and overlap checks of sequences.
  first_key text,
  last_key text,
  source text not null default 'bought' check (source in ('bought', 'printed')),
  series_id uuid references tag_series (id),
  supplier_note text,
  note text,
  received_on date,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz,
  check (kind = 'list' or (first_number is not null and last_number is not null and digits is not null and first_number <= last_number))
);
create index tag_ranges_format_ix on tag_ranges (format_id) where deleted_at is null;

-- The values of a 'list' range (bought tags that are not sequential, imported from a file).
create table tag_range_values (
  range_id uuid not null references tag_ranges (id) on delete cascade,
  value text not null,
  value_key text not null,
  primary key (range_id, value_key)
);
-- A listed value belongs to one range at most.
create unique index tag_range_values_key_ux on tag_range_values (value_key);

-- Stock values that were never attached and are void (damaged, never used) or lost. A value that was
-- attached is ended in tag_assignments instead.
create table tag_stock_marks (
  value_key text primary key,
  value text not null,
  range_id uuid references tag_ranges (id) on delete set null,
  status text not null check (status in ('void', 'lost')),
  reason text,
  marked_at timestamptz not null default now(),
  marked_by uuid
);

-- Which value is on which record, with the history (E37-01, E37-07). The record's tag field holds a
-- copy of its primary active value; THIS table is the source of truth. The partial unique index
-- below makes a value active on one record at most, across every taggable type, under concurrent writes.
create table tag_assignments (
  id uuid primary key default gen_random_uuid(),
  value text not null,
  value_key text not null,
  record_type text not null,
  record_id uuid not null,
  status text not null default 'active' check (status in ('active', 'replaced', 'void', 'lost', 'ended')),
  -- The record's value shown in its tag field (one per record); others are extra tags (several per record).
  is_primary boolean not null default true,
  -- How the value was given when attached: code, text, typed, handheld (shared/tag-format.ts TagSource), import or system.
  source text,
  format_id uuid,
  assigned_at timestamptz not null default now(),
  assigned_by uuid,
  ended_at timestamptz,
  ended_by uuid,
  -- The assignment that replaced this one.
  replaced_by uuid references tag_assignments (id),
  reason text
);
create unique index tag_assignments_active_value_ux on tag_assignments (value_key) where status = 'active';
create index tag_assignments_value_ix on tag_assignments (value_key);
create index tag_assignments_record_ix on tag_assignments (record_type, record_id);

-- Lookups (E37-10): kept `retention.tag_lookups_days` (default 90), off with `tags.log_lookups`.
-- Never the phone's location. A lookup that found nothing the person may see is not tied to a record.
create table tag_lookups (
  id uuid primary key default gen_random_uuid(),
  value_key text not null,
  person_id uuid,
  at timestamptz not null default now(),
  source text not null check (source in ('app_code', 'app_text', 'app_typed', 'web')),
  -- The outcome kind (shared/asset-tags-api.ts LookupOutcome).
  outcome text,
  record_type text,
  record_id uuid,
  action text
);
create index tag_lookups_record_ix on tag_lookups (record_type, record_id, at desc);
create index tag_lookups_at_ix on tag_lookups (at);
create index tag_lookups_person_ix on tag_lookups (person_id);

-- Label layouts saved by administrators (E37-08). The presets (common Letter and A4 sheets, rolls)
-- are in code (modules/tags/print-layouts.ts); this holds custom ones.
create table tag_label_layouts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('sheet', 'roll')),
  page_width_mm numeric not null,
  page_height_mm numeric not null,
  label_width_mm numeric not null,
  label_height_mm numeric not null,
  columns integer not null default 1,
  rows integer not null default 1,
  margin_top_mm numeric not null default 0,
  margin_left_mm numeric not null default 0,
  gap_x_mm numeric not null default 0,
  gap_y_mm numeric not null default 0,
  -- What prints: { code: 'none' | 'code128' | 'qr' | 'datamatrix', topLine, logo, textHeightMm }.
  options jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

-- When and where each record was last verified (found in a count, E37-09). One row per record.
create table tag_verifications (
  record_type text not null,
  record_id uuid not null,
  verified_at timestamptz not null,
  site_id uuid,
  count_id uuid,
  verified_by uuid,
  primary key (record_type, record_id)
);

-- Inventory counts (E37-09): a record type of its own (`inventory_count`, permission module `tags`).
create table inventory_counts (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  site_id uuid not null,
  -- A room or area within the site, as text.
  area text,
  -- Record types counted; empty = every taggable type.
  record_types jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'finished', 'canceled')),
  started_at timestamptz not null default now(),
  started_by uuid,
  finished_at timestamptz,
  finished_by uuid,
  -- Totals when finished: { expected, found, unexpected, missing }.
  summary jsonb,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index inventory_counts_site_ix on inventory_counts (site_id) where deleted_at is null;

-- What a count expects and what was found. The expected rows are written when the count starts.
create table inventory_count_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references inventory_counts (id) on delete cascade,
  record_type text not null,
  record_id uuid not null,
  expected boolean not null,
  state text not null default 'pending' check (state in ('pending', 'found', 'missing')),
  found_at timestamptz,
  found_by uuid,
  found_value text,
  found_source text,
  -- After finishing: moved here (unexpected), marked missing, or left as it is.
  resolution text check (resolution in ('moved', 'marked_missing', 'left')),
  resolved_at timestamptz,
  resolved_by uuid,
  unique (count_id, record_type, record_id)
);
create index inventory_count_items_record_ix on inventory_count_items (record_type, record_id);
