-- Audits and inspections (E24): the audit universe, audit engagements, checklist templates and
-- their items, recurring inspection schedules, inspections, checklist answers, findings and the
-- evidence requests auditees answer. Sites, vehicles, assets, systems, users, corrective action
-- plans and hazards belong to other modules: plain uuid columns.

create table audit_areas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  description text,
  cycle_months integer,
  last_audited_on date,
  next_due_on date,
  owner_id uuid,
  risk_level text,
  active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table checklist_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'inspection',
  target_type text,
  description text,
  version integer not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

-- Items are never removed once a checklist has used them: a removed item is marked deleted so
-- earlier answers keep their question.
create table checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references checklist_templates(id),
  section text,
  prompt text not null,
  guidance text,
  sort integer not null default 0,
  critical boolean not null default false,
  photo_required boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index checklist_template_items_template_ix on checklist_template_items (template_id, sort);

create table audits (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  audit_type text,
  area_id uuid,
  plan_year integer,
  scope text,
  criteria text,
  template_id uuid,
  auditee_id uuid,
  lead_auditor_id uuid,
  team_ids jsonb not null default '[]',
  planned_start date,
  planned_end date,
  fieldwork_start date,
  fieldwork_end date,
  status text,
  report_summary text,
  opinion text,
  report_approved_on date,
  report_approved_by_name text,
  closed_on date,
  restricted boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index audits_area_ix on audits (area_id);

create table inspection_schedules (
  id uuid primary key default gen_random_uuid(),
  name text,
  template_id uuid not null,
  target_type text,
  target_id uuid,
  target_label text,
  frequency text not null default 'monthly',
  next_due_on date,
  assignee_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table inspections (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text,
  template_id uuid not null,
  schedule_id uuid,
  target_type text,
  target_id uuid,
  target_label text,
  inspector_id uuid,
  due_on date,
  performed_on date,
  status text,
  result text,
  score_pct numeric,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index inspections_due_ix on inspections (due_on);
create unique index inspections_schedule_due_ux on inspections (schedule_id, due_on) where schedule_id is not null and deleted_at is null;

-- One answer per checklist item on an audit or an inspection.
create table checklist_responses (
  id uuid primary key default gen_random_uuid(),
  parent_type text not null,
  parent_id uuid not null,
  item_id uuid not null references checklist_template_items(id),
  answer text,
  note text,
  attachment_ids jsonb not null default '[]',
  answered_by uuid,
  answered_at timestamptz,
  unique (parent_type, parent_id, item_id)
);

create table audit_findings (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  source_type text not null,
  source_id uuid not null,
  item_id uuid,
  rating text,
  criteria text,
  condition text,
  cause text,
  effect text,
  recommendation text,
  management_response text,
  response_owner_id uuid,
  response_due date,
  responded_on date,
  status text,
  cap_id uuid,
  hazard_id uuid,
  restricted boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index audit_findings_source_ix on audit_findings (source_type, source_id);

create table audit_requests (
  id uuid primary key default gen_random_uuid(),
  ref text,
  audit_id uuid not null,
  source_type text not null default 'audit',
  request text not null,
  owner_id uuid,
  due_on date,
  status text,
  response_note text,
  provided_at timestamptz,
  restricted boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index audit_requests_audit_ix on audit_requests (audit_id);
create index audit_requests_owner_ix on audit_requests (owner_id);
