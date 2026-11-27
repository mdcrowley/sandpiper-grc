-- Evidence library (E45-06): evidence records filed once and linked to many records (controls, control
-- tests, obligations and their periods, audit requests and findings, funder review areas and document
-- requests, corrective action plans, framework outcomes). Files are attachments of the evidence record
-- (attachments module); a link or a controlled document of the document library can be the source
-- instead. Other modules' records are named by type and id: no foreign keys across modules.

create table evidence_records (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  description text,
  owner_id uuid,
  department_id uuid,
  source text,                    -- evidence_source: file | link | document
  url text,                       -- source = link: where the evidence is kept
  document_id uuid,               -- source = document: a document of the document library (policy)
  period_start date,              -- the period the evidence covers
  period_end date,
  collected_on date,
  valid_until date,               -- the evidence must be renewed by then
  reminded_for date,              -- the valid_until date the reminders were last claimed for
  restricted boolean not null default false,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index evidence_records_valid_until_ix on evidence_records (valid_until) where deleted_at is null;
create index evidence_records_owner_ix on evidence_records (owner_id) where deleted_at is null;
create index evidence_records_department_ix on evidence_records (department_id);

-- One evidence record used by one record, or by one part of it: `part` is '' for the record itself,
-- or a key such as 'area:FM' (a funder review area), 'request:<uuid>' (a document request) or
-- 'period:<uuid>' (an obligation period). `relation` is a value of the list evidence_relation.
create table evidence_links (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references evidence_records(id) on delete cascade,
  record_type text not null,
  record_id uuid not null,
  part text not null default '',
  relation text not null default 'supports',
  note text,
  created_at timestamptz not null default now(), created_by uuid,
  unique (evidence_id, record_type, record_id, part)
);
create index evidence_links_record_ix on evidence_links (record_type, record_id, part);
