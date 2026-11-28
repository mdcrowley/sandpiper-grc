-- Civil rights programs (wave 26): a transit organization's civil-rights and accessibility programs,
-- complaints under them, and business participation goals. Permission module `civilrights`; feature
-- area `civilrights` (off by default). No jurisdiction's law, agency or program is built in: program
-- types, required elements, report types, complaint bases and time limits are the organization's own
-- lists, templates and settings.

-- Templates an administrator keeps: a program's required elements and its monitoring reports.
create table civil_rights_templates (
  id uuid primary key default gen_random_uuid(),
  ref text unique,                                   -- CRT-00001
  name text not null,
  program_type text,                                 -- civil_rights_program_type
  description text,
  elements text,                                     -- one required element per line
  reports text,                                      -- one report per line: "Name | months between reports"
  update_cycle_months int,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table civil_rights_programs (
  id uuid primary key default gen_random_uuid(),
  ref text unique,                                   -- CRP-00001
  name text not null,
  program_type text,                                 -- civil_rights_program_type
  status text not null default 'draft',              -- civil_rights_program_status
  owner_id uuid,
  description text,
  template_id uuid,                                  -- the template its elements and reports came from
  document_id uuid,                                  -- the program document (policies: a controlled document)
  decision_id uuid,                                  -- the board decision adopting it (governance)
  adopted_on date,
  update_cycle_months int,
  last_updated_on date,
  next_update_due date,                              -- worked out from the last update (or adoption) and the cycle
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

-- A program's required elements, public notice locations and language assistance plan items.
create table civil_rights_program_items (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references civil_rights_programs(id),
  kind text not null check (kind in ('element', 'notice', 'language')),
  title text not null,
  detail text,
  status text not null default 'open',               -- civil_rights_item_status
  site_id uuid,                                      -- notices: where it is posted
  language text,                                     -- language items: the language served
  due_on date,
  checked_on date,
  checked_by uuid,
  checked_by_name text,
  note text,
  sort int not null default 0,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now()
);
create index civil_rights_program_items_ix on civil_rights_program_items (program_id, kind, sort);

create table civil_rights_reports (
  id uuid primary key default gen_random_uuid(),
  ref text unique,                                   -- CRR-00001
  title text not null,
  program_id uuid,
  report_type text,                                  -- civil_rights_report_type
  period_label text,
  due_on date,
  every_months int,                                  -- the next report is planned when this one is submitted
  status text not null default 'planned',            -- civil_rights_report_status
  owner_id uuid,
  submitted_on date,
  recipient text,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index civil_rights_reports_due_ix on civil_rights_reports (status, due_on) where deleted_at is null;

-- Every submission of a report (a report may be sent again after it is returned).
create table civil_rights_report_submissions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references civil_rights_reports(id),
  submitted_on date not null,
  submitted_by uuid,
  submitted_by_name text,
  recipient text,
  reference text,
  note text,
  created_at timestamptz not null default now()
);

create table civil_rights_complaints (
  id uuid primary key default gen_random_uuid(),
  ref text unique,                                   -- CRC-00001
  subject text not null,                             -- a short title for lists; never the complainant's name
  received_on date not null,
  channel text,                                      -- civil_rights_channel
  anonymous boolean not null default false,
  complainant_name text,                             -- personal
  complainant_contact text,                          -- personal
  language_needed text,
  basis text,                                        -- civil_rights_basis (the organization's own list)
  program_id uuid,
  service_id uuid, vehicle_id uuid, site_id uuid, employee_id uuid,
  occurred_on date,
  description text,                                  -- personal
  investigator_id uuid,
  status text not null default 'received',           -- civil_rights_complaint_status
  ack_due_on date,                                   -- received_on + civilrights.ack_days
  acknowledged_on date,
  investigation_due_on date,                         -- received_on + civilrights.investigation_days
  findings text,
  findings_on date,
  outcome text,                                      -- civil_rights_outcome
  appeal_received_on date,
  appeal_due_on date,                                -- appeal_received_on + civilrights.appeal_days
  appeal_decision text,
  appeal_decided_on date,
  closed_on date,
  next_due_on date,                                  -- the next open time limit (null once closed)
  confidential boolean not null default true,        -- seen only by named handlers, the investigator and who entered it
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index civil_rights_complaints_due_ix on civil_rights_complaints (next_due_on) where deleted_at is null;

-- Investigation steps and letters sent (the letters' files are attachments on the complaint).
create table civil_rights_complaint_steps (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references civil_rights_complaints(id),
  kind text not null check (kind in ('step', 'letter')),
  title text not null,
  due_on date,
  done_on date,
  done_by uuid,
  done_by_name text,
  note text,                                         -- personal
  sort int not null default 0,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now()
);
create index civil_rights_complaint_steps_ix on civil_rights_complaint_steps (complaint_id, sort);

-- People named to handle confidential complaints (Civil rights > Settings).
create table civil_rights_complaint_viewers (
  user_id uuid primary key,
  added_by uuid,
  added_at timestamptz not null default now()
);

-- Reminders already sent, so each is sent once.
create table civil_rights_reminders (
  key text primary key,
  sent_at timestamptz not null default now()
);

create table civil_rights_goals (
  id uuid primary key default gen_random_uuid(),
  ref text unique,                                   -- CRG-00001
  title text not null,
  program_id uuid,
  period_label text,
  period_start date,
  period_end date,
  goal_pct numeric,
  method_notes text,
  status text not null default 'draft',              -- civil_rights_goal_status
  owner_id uuid,
  shortfall_analysis text,
  good_faith_notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table civil_rights_awards (
  id uuid primary key default gen_random_uuid(),
  ref text unique,                                   -- CRA-00001
  title text not null,
  goal_id uuid,
  contract_id uuid,
  prime_vendor_id uuid,
  awarded_on date,
  award_amount numeric,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index civil_rights_awards_goal_ix on civil_rights_awards (goal_id) where deleted_at is null;

-- The firms taking part in an award, with the amount each is paid or committed and whether it is certified.
create table civil_rights_award_firms (
  id uuid primary key default gen_random_uuid(),
  award_id uuid not null references civil_rights_awards(id),
  vendor_id uuid,
  firm_name text,
  certified boolean not null default false,
  role text,                                         -- prime, subcontractor, supplier (free text)
  amount numeric not null default 0,
  note text,
  sort int not null default 0,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now()
);
create index civil_rights_award_firms_ix on civil_rights_award_firms (award_id, sort);
