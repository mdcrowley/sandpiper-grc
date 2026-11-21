-- Funding and grant compliance (E27): awards and what they fund, yearly certifications with
-- their checklist items, funder compliance reviews (review areas loaded from a file, requests,
-- deficiencies) and the funder-required clauses of funded contracts.
-- Projects, contracts, obligations, corrective action plans and users belong to other modules:
-- plain uuid columns, no foreign keys across modules.

create table funding_awards (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  funder_name text,
  program_name text,
  award_number text,
  status text,
  period_start date,
  period_end date,
  amount numeric(14,2),
  local_share numeric(14,2),
  project_id uuid,
  manager_id uuid,
  reporting_frequency text,
  next_report_due date,
  closeout_due date,
  report_obligation_id uuid,     -- obligations made from the award (E27-04), when that module is there
  closeout_obligation_id uuid,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table funding_certifications (
  id uuid primary key default gen_random_uuid(),
  ref text,
  year integer not null,
  title text not null,
  funder_name text,
  due_on date,
  signer_id uuid,
  status text,
  signed_on date,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index funding_certifications_year_ix on funding_certifications (year);

create table funding_certification_items (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null references funding_certifications(id),
  category text,
  statement text not null,
  applies boolean not null default true,
  responsible_id uuid,
  obligation_id uuid,
  confirmed_by uuid,
  confirmed_on date,
  note text,
  sort integer not null default 0,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index funding_certification_items_cert_ix on funding_certification_items (certification_id, sort);

-- Review areas come from a file the organization loads (the format is in the user guide).
create table review_area_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version text not null default '',
  description text,
  source_file text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (name, version)
);

create table review_area_templates (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references review_area_sets(id),
  code text not null,
  title text not null,
  description text,
  questions jsonb not null default '[]',
  sort integer not null default 0,
  unique (set_id, code)
);

create table compliance_reviews (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  funder_name text,
  set_id uuid references review_area_sets(id),
  period text,
  site_visit_on date,
  lead_id uuid,
  status text,
  closed_on date,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table compliance_review_areas (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references compliance_reviews(id),
  area_code text not null,
  title text not null,
  description text,
  questions jsonb not null default '[]',
  self_assessment text not null default 'not_assessed',
  answers jsonb not null default '[]',
  owner_id uuid,
  notes text,
  sort integer not null default 0,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (review_id, area_code)
);

create table compliance_review_requests (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references compliance_reviews(id),
  area_code text,
  request text not null,
  owner_id uuid,
  due_on date,
  status text not null default 'open',
  response_note text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index compliance_review_requests_review_ix on compliance_review_requests (review_id);

create table review_deficiencies (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  review_id uuid not null references compliance_reviews(id),
  area_code text,
  description text,
  required_action text,
  owner_id uuid,
  due_on date,
  status text,
  cap_id uuid,
  closed_on date,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index review_deficiencies_review_ix on review_deficiencies (review_id);

-- Funder-required clauses of a funded contract, per award (E27-08).
create table contract_funding_clauses (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null,
  award_id uuid not null references funding_awards(id),
  clause_key text not null,
  status text,
  note text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (contract_id, award_id, clause_key)
);
