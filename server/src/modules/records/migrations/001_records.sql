-- Records requests and privacy (E34-03 to E34-05). Permission modules `records` (requests) and
-- `privacy` (personal-data requests and privacy impact assessments); feature area `records`.
-- Deadlines are settings (records.request_due_days): no jurisdiction's deadline is built in.

create table records_requests (
  id uuid primary key default gen_random_uuid(),
  ref text unique,                                   -- RRQ-00001
  subject text not null,                             -- a short title for lists; never the requester's name
  kind text not null,                                -- records_request_kind; meta.personal marks personal-data kinds
  requester_name text,                               -- personal
  requester_contact text,                            -- personal
  requester_address text,                            -- personal
  received_on date not null,
  due_on date,                                       -- received_on + the days set for the kind (working days optional)
  extended_due_on date,
  extension_reason text,
  identity_verified boolean not null default false,
  description text,
  owner_id uuid,
  status text not null default 'received',           -- records_request_status
  responded_on date,
  closed_on date,
  response_summary text,
  fee numeric,
  alerted_amber_at timestamptz,                      -- claimed before the owner is told (once per due date)
  alerted_red_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index records_requests_open_ix on records_requests (status, due_on) where deleted_at is null;

-- The records that answer a request, each with its exemption and how much of it was disclosed.
-- Mirrored as record links (relation `responsive_to`) so the record's Related tab shows the request.
create table records_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references records_requests(id),
  record_type text not null,
  record_id uuid not null,
  exemption text,                                    -- records_exemption (operator-defined)
  disclosed text,                                    -- records_disclosure: full, partial, withheld
  note text,
  added_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, record_type, record_id)
);

create table privacy_assessments (
  id uuid primary key default gen_random_uuid(),
  ref text unique,                                   -- PIA-00001
  title text not null,
  system_id uuid,                                    -- the system assessed (inventory)
  owner_id uuid,
  data_category_ids jsonb not null default '[]',
  purpose text,
  legal_basis text,                                  -- as recorded; no built-in list of any jurisdiction's grounds
  necessity text,
  retention text,
  sharing text,
  risks text,
  mitigations text,
  residual_risk text,                                -- privacy_risk_level
  answers jsonb not null default '{}',               -- privacy_question value -> answer
  status text not null default 'draft',              -- privacy_assessment_status
  approved_on date,
  approved_by_name text,
  approved_category_ids jsonb,                       -- the system's data categories when it was approved
  review_months int not null default 24,
  next_review_on date,
  review_reminded_for date,                          -- the review date a reminder was claimed for
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index privacy_assessments_system_ix on privacy_assessments (system_id) where deleted_at is null;
