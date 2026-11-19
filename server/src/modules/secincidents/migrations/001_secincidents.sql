-- Security incidents: restricted records, kept apart from service desk incidents.

create table security_incidents (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  summary text,
  severity text,
  status text not null default 'reported',
  scenario text,
  discovered_at timestamptz not null default now(),   -- the regulatory clocks start here
  declared_at timestamptz,
  contained_at timestamptz,
  closed_at timestamptz,
  lead_id uuid,
  affected_systems text,
  affected_data text,
  is_cyber_incident boolean not null default true,
  health_data_involved boolean not null default false,
  card_data_involved boolean not null default false,
  personal_info_involved boolean not null default false,
  what_happened text,
  went_well text,
  to_improve text,
  ransom_payment_status text not null default 'not_applicable',
  board_resolution_ref text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index security_incidents_status_ix on security_incidents (status);

-- Incident log: entries can be added, never changed or removed.
create table incident_log_entries (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references security_incidents(id),
  at timestamptz not null default now(),
  author_id uuid,
  author_name text,
  entry text not null,
  kind text not null default 'note',
  created_at timestamptz not null default now()
);
create index incident_log_entries_incident_ix on incident_log_entries (incident_id, at);

create function incident_log_entries_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'incident_log_entries is append-only';
end $$;
create trigger incident_log_entries_no_change before update or delete on incident_log_entries
  for each row execute function incident_log_entries_append_only();

create table incident_roles (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references security_incidents(id),
  role text not null,
  person_name text,
  contact text,
  sort int not null default 0,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index incident_roles_incident_ix on incident_roles (incident_id);

create table incident_evidence (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references security_incidents(id),
  item text not null,
  where_held text,
  collected_by text,
  collected_at timestamptz,
  hash_ref text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index incident_evidence_incident_ix on incident_evidence (incident_id);

-- Standing list of incident roles and contacts (offline kit; copied onto each new incident).
create table incident_contacts (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  role text not null,
  person_name text,
  contact text,
  notes text,
  sort int not null default 0,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

-- Checklist templates by scenario; copied onto an incident when its scenario is set.
create table incident_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  scenario text not null,
  phase text not null,                                 -- containment | recovery
  step text not null,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index incident_checklist_templates_scenario_ix on incident_checklist_templates (scenario, phase, sort);

create table incident_checklist_items (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references security_incidents(id),
  template_id uuid,
  scenario text,
  phase text not null,
  step text not null,
  sort int not null default 0,
  done boolean not null default false,
  done_by uuid,
  done_by_name text,
  done_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index incident_checklist_items_incident_ix on incident_checklist_items (incident_id, phase, sort);

-- Notification rules are data.
create table notification_rules (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  trigger_attribute text not null,                     -- any | is_cyber_incident | health_data_involved | ...
  party text not null,
  deadline_hours numeric,                              -- hours from discovery; null = no fixed deadline yet
  required boolean not null default true,              -- false = recommended
  guidance text,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table notification_tasks (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  incident_id uuid not null,
  rule_id uuid,
  party text not null,
  deadline_hours numeric,
  required boolean not null default true,
  guidance text,
  due_at timestamptz,
  status text not null default 'pending',
  auto_not_required boolean not null default false,    -- closed by the system because the trigger no longer applies
  notified_who text,
  notified_how text,
  notified_at timestamptz,
  reference_received text,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index notification_tasks_incident_ix on notification_tasks (incident_id);
create unique index notification_tasks_incident_rule_uq on notification_tasks (incident_id, rule_id)
  where deleted_at is null and rule_id is not null;
