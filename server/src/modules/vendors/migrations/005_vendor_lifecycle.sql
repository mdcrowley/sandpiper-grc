-- Vendor risk lifecycle (E35): reassessment cadence by criticality, exclusion-list checks, the
-- vendor issues register, offboarding checklists when a contract ends, and the move of the contract
-- security terms into the shared clause-checklist engine (core table clause_checks, migration 026).
-- Systems, assets, data categories, corrective action plans and users belong to other modules:
-- plain uuid columns, no foreign keys across modules.

alter table vendors add column if not exists owner_id uuid;
alter table vendors add column if not exists last_assessed_on date;         -- the last completed assessment
alter table vendors add column if not exists next_assessment_due date;      -- last assessed + the criticality's months
alter table vendors add column if not exists assessment_reminded_for date;  -- the due date a reminder was claimed for
alter table vendors add column if not exists last_exclusion_check_on date;
alter table vendors add column if not exists exclusion_reminded_for date;   -- the due date a reminder was claimed for

-- Claimed once, in one statement, before an offboarding is started for the contract automatically.
alter table contracts add column if not exists offboarding_started_on date;

-- A check of the vendor against an exclusion list the organization names (no list is built in).
create table vendor_exclusion_checks (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id),
  checked_on date not null,
  list_key text,                    -- lookup exclusion_list
  result text not null,             -- clear | possible_match | match
  reference text,                   -- the search reference or result number as shown by the list
  checked_by uuid,
  note text,
  attachment_id uuid,               -- a file on the vendor holding the result (attachments module)
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index vendor_exclusion_checks_vendor_ix on vendor_exclusion_checks (vendor_id, checked_on desc);

create table vendor_issues (
  id uuid primary key default gen_random_uuid(),
  ref text,
  vendor_id uuid not null references vendors(id),
  contract_id uuid references contracts(id),
  title text not null,
  description text,
  category text,
  severity text,
  raised_on date,
  owner_id uuid,
  status text,
  resolved_on date,
  resolution text,
  cap_id uuid,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index vendor_issues_vendor_ix on vendor_issues (vendor_id);

create table vendor_offboardings (
  id uuid primary key default gen_random_uuid(),
  ref text,
  vendor_id uuid not null references vendors(id),
  contract_id uuid references contracts(id),
  trigger text,                     -- contract_ended | terminated | vendor_exit | manual
  due_on date,
  owner_id uuid,
  status text,                      -- open | in_progress | signed_off | canceled
  signed_off_on date,
  signed_off_by_name text,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index vendor_offboardings_vendor_ix on vendor_offboardings (vendor_id);

create table vendor_offboarding_items (
  id uuid primary key default gen_random_uuid(),
  offboarding_id uuid not null references vendor_offboardings(id),
  kind text not null,               -- account_access | remote_access | data_return | data_destruction | asset_return | other
  record_type text,                 -- the system, asset or data category the item is about
  record_id uuid,
  item text not null,
  status text not null default 'to_do',   -- to_do | done | not_applicable
  done_by uuid,
  done_on date,
  evidence_note text,
  sort integer not null default 0,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index vendor_offboarding_items_ix on vendor_offboarding_items (offboarding_id, sort);
-- Refreshing the items never adds the same record twice for the same kind.
create unique index vendor_offboarding_items_record_ux on vendor_offboarding_items (offboarding_id, kind, record_type, record_id)
  where record_id is not null;
-- The same for template items, by their text.
create unique index vendor_offboarding_items_template_ux on vendor_offboarding_items (offboarding_id, kind, item)
  where record_id is null;

-- The contract security terms move into the shared engine (set security_terms). The old table is
-- kept, no longer written, for one release.
insert into clause_checks (set_key, scope_type, scope_id, sub_key, clause_key, status, clause_text, note, created_at, created_by, updated_at, updated_by)
select 'security_terms', 'contract', contract_id, '', clause_key, status, clause_text, note, created_at, created_by, updated_at, updated_by
from contract_clause_checks
on conflict (set_key, scope_type, scope_id, sub_key, clause_key) do nothing;
