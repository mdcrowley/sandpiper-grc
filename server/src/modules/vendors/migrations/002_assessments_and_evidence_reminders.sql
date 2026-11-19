-- Vendor assessment questionnaire: question sets are data, kept by version; answers are kept per vendor.
create table vendor_question_sets (
  id uuid primary key default gen_random_uuid(),
  version int not null unique,
  title text not null,
  questions jsonb not null,          -- [{ key, section, text, guidance, weight }]
  active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid
);

create table vendor_assessments (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id),
  question_set_id uuid not null references vendor_question_sets(id),
  status text not null default 'draft',   -- draft | completed
  assessed_on date,
  answers jsonb not null default '{}',     -- { <question key>: { answer: yes | partial | no | na, note } }
  score numeric,                           -- 0 to 100, set when completed
  notes text,
  evidence_item_id uuid,
  completed_at timestamptz, completed_by uuid,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index vendor_assessments_vendor_ix on vendor_assessments (vendor_id);

-- One row per evidence item and threshold, so each expiry reminder is sent once.
create table evidence_reminders (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references evidence_items(id),
  threshold_days int not null,
  due_on date not null,
  fired_at timestamptz,
  superseded boolean not null default false,
  created_at timestamptz not null default now(),
  unique (evidence_id, threshold_days)
);
