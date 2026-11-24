-- E41-08: safety and security certification of capital projects.
--
-- A project carries certifiable items (the parts that must be shown safe and secure before they are
-- used: a vehicle type, a signal system, a station, a fare system). Each item has requirements derived
-- from a hazard (safety module) or a threat (a risk in the risks module), or from a standard or design
-- criterion, each verified with evidence. A certificate of readiness is issued once every required
-- item is verified; a gate template may require one. No foreign keys across modules; the items and
-- requirements check their project and item in the application.

create table project_cert_items (
  id uuid primary key default gen_random_uuid(),
  ref text,
  project_id uuid not null,                          -- the project (checked by the application)
  department_id uuid,                                -- the project's department, kept in step (access scope, E41-01)
  name text not null,
  description text,
  category text,
  required boolean not null default true,            -- an open required item stops the certificate
  owner_id uuid,
  status text not null default 'open',               -- open | verified (kept by the application)
  requirements_total int not null default 0,
  requirements_open int not null default 0,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index project_cert_items_project_ix on project_cert_items (project_id) where deleted_at is null;

create table project_cert_requirements (
  id uuid primary key default gen_random_uuid(),
  ref text,
  item_id uuid not null,                             -- the certifiable item (checked by the application)
  project_id uuid not null,                          -- the item's project
  department_id uuid,                                -- the project's department, kept in step
  title text not null,
  requirement text,
  source_type text,                                  -- hazard | risk (the hazard or threat it is derived from)
  source_id text,
  basis text,                                        -- a standard, design criterion or other basis
  verification_method text,
  status text not null default 'open',               -- open | in_progress | verified | not_applicable
  owner_id uuid,
  due_on date,
  evidence_ref text,
  verification_notes text,
  verified_by uuid,
  verified_on date,
  restricted boolean not null default false,         -- follows the hazard or threat it is derived from
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index project_cert_requirements_item_ix on project_cert_requirements (item_id) where deleted_at is null;
create index project_cert_requirements_project_ix on project_cert_requirements (project_id) where deleted_at is null;
create index project_cert_requirements_source_ix on project_cert_requirements (source_type, source_id) where deleted_at is null;

-- Certificates of readiness: at most one in force per project; a withdrawn one is kept.
create table project_certificates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  status text not null default 'issued',             -- issued | withdrawn
  scope text not null,                               -- what it certifies as ready
  conditions text,                                   -- conditions or restrictions, and the open items accepted
  issued_by uuid,
  issued_by_name text not null,
  issued_by_role text,
  issued_on date not null,
  items jsonb not null default '[]',                 -- every item as it stood when issued
  open_items jsonb not null default '[]',            -- items not required that were still open
  withdrawn_at timestamptz,
  withdrawn_by uuid,
  withdrawn_by_name text,
  withdraw_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index project_certificates_in_force_ix on project_certificates (project_id) where status = 'issued';
create index project_certificates_project_ix on project_certificates (project_id, created_at);

-- A gate template may require a certificate of readiness; open gates take the setting from their template.
alter table project_gate_defs add column if not exists requires_certificate boolean not null default false;
alter table project_gates add column if not exists requires_certificate boolean not null default false;
create index project_cert_items_department_ix on project_cert_items (department_id);
create index project_cert_requirements_department_ix on project_cert_requirements (department_id);
