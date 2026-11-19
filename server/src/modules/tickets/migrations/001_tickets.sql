-- Service desk: tickets, SLA calendars and policies, problems, knowledge base, catalogue.

create table calendars (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  timezone text not null default 'UTC',
  always_open boolean not null default false,
  -- { "mon": ["08:00","17:00"], ..., "sat": null, "sun": null }
  hours jsonb not null default '{}',
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table calendar_holidays (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references calendars(id),
  day date not null,
  name text not null default '',
  created_at timestamptz not null default now(), created_by uuid,
  unique (calendar_id, day)
);

create table sla_policies (
  id uuid primary key default gen_random_uuid(),
  priority text not null unique,
  respond_minutes int not null,
  resolve_minutes int not null,
  calendar_id uuid not null references calendars(id),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table tickets (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  type text not null default 'incident',
  title text not null,
  description text,
  requester_name text,
  requester_email text,
  requester_department text,
  requester_id uuid,
  affected_user text,
  category text,
  subcategory text,
  catalog_item_id uuid,
  system_id uuid,
  asset_id uuid,
  impact text,
  urgency text,
  priority text,
  priority_overridden boolean not null default false,
  assignment_group text,
  assignee_id uuid,
  status text not null default 'new',
  resolution_code text,
  resolution_notes text,
  channel text,
  with_vendor boolean not null default false,
  vendor_id uuid,
  vendor_ref text,
  vendor_raised_at timestamptz,
  vendor_responded_at timestamptz,
  major_incident boolean not null default false,
  parent_ticket_id uuid,
  problem_id uuid,
  post_incident_review jsonb,
  satisfaction_score int,
  satisfaction_comment text,
  opened_at timestamptz not null default now(),
  response_due_at timestamptz,
  resolve_due_at timestamptz,
  first_responded_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  paused_at timestamptz,
  paused_minutes int not null default 0,
  response_breached boolean not null default false,
  resolve_breached boolean not null default false,
  breach_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index tickets_status_ix on tickets (status) where deleted_at is null;
create index tickets_opened_ix on tickets (opened_at);
create index tickets_assignee_ix on tickets (assignee_id) where deleted_at is null;
create index tickets_parent_ix on tickets (parent_ticket_id) where parent_ticket_id is not null;
create index tickets_resolve_due_ix on tickets (resolve_due_at) where resolved_at is null and not resolve_breached;
create index tickets_response_due_ix on tickets (response_due_at) where first_responded_at is null and not response_breached;

create table problems (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  title text not null,
  description text,
  status text not null default 'open',
  root_cause text,
  workaround text,
  known_error boolean not null default false,
  owner_id uuid,
  knowledge_article_id uuid,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  title text not null,
  body text,
  category text,
  audience text not null default 'agents',
  status text not null default 'draft',
  owner_id uuid,
  review_on date,
  version int not null default 1,
  helpful_yes int not null default 0,
  helpful_no int not null default 0,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table knowledge_article_versions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references knowledge_articles(id),
  version int not null,
  title text not null,
  body text,
  saved_at timestamptz not null default now(),
  saved_by uuid,
  saved_by_name text,
  unique (article_id, version)
);

create table catalog_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  category text,
  active boolean not null default true,
  defaults jsonb,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
