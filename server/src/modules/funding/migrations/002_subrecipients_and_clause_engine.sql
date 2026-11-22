-- Sub-recipients of funding awards and their monitoring (E35-07, E27-11), and the move of the
-- funder-required contract clauses into the shared clause-checklist engine (core table
-- clause_checks, migration 026; set funder_clauses, sub-key = the award id).
-- Vendors, corrective action plans and users belong to other modules: plain uuid columns.

create table subrecipients (
  id uuid primary key default gen_random_uuid(),
  ref text,
  award_id uuid not null references funding_awards(id),
  name text not null,
  vendor_id uuid,
  amount numeric(14,2),
  risk_level text,
  monitoring_frequency text,        -- funding_report_frequency keys: monthly | quarterly | half_yearly | yearly | once
  last_monitored_on date,
  next_monitoring_due date,
  monitoring_reminded_for date,     -- the due date a reminder was claimed for
  status text,
  owner_id uuid,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index subrecipients_award_ix on subrecipients (award_id);

create table subrecipient_monitoring (
  id uuid primary key default gen_random_uuid(),
  subrecipient_id uuid not null references subrecipients(id),
  monitored_on date not null,
  method text not null,             -- desk_review | site_visit | report_review
  result text not null,             -- satisfactory | findings | unsatisfactory
  findings text,
  cap_id uuid,
  by uuid,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index subrecipient_monitoring_ix on subrecipient_monitoring (subrecipient_id, monitored_on desc);

-- The funder-required clauses move into the shared engine. The old table is kept, no longer
-- written, for one release.
insert into clause_checks (set_key, scope_type, scope_id, sub_key, clause_key, status, note, created_at, created_by, updated_at, updated_by)
select 'funder_clauses', 'contract', contract_id, award_id::text, clause_key, status, note, created_at, created_by, updated_at, updated_by
from contract_funding_clauses
on conflict (set_key, scope_type, scope_id, sub_key, clause_key) do nothing;
