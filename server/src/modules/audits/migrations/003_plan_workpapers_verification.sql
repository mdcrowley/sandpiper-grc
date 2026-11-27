-- Wave 25 (E45-13 to E45-16): the risk-ranked audit plan, workpapers with preparer and reviewer sign-off, and the
-- auditor's verification of a finding before it closes. Risks, evidence items, corrective action
-- plans and users belong to other modules: plain uuid columns.

-- Risk factors of an audit area that are not worked out from other records, and the score last
-- worked out (kept so the universe list can sort by it; the plan works it out afresh).
alter table audit_areas add column if not exists significance text;
alter table audit_areas add column if not exists change_level text;
alter table audit_areas add column if not exists risk_score numeric;
alter table audit_areas add column if not exists risk_scored_at timestamptz;

-- The annual audit plan: each saved version keeps the ranking it was made from; an approved version
-- is never changed (a later approval supersedes it).
create table if not exists audit_plans (
  id uuid primary key default gen_random_uuid(),
  plan_year integer not null,
  version integer not null,
  status text not null default 'draft',
  entries jsonb not null default '[]',
  settings jsonb not null default '{}',
  note text,
  prepared_by uuid,
  prepared_by_name text,
  prepared_at timestamptz not null default now(),
  approved_by uuid,
  approved_by_name text,
  approved_on date,
  approval_note text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (plan_year, version)
);

-- Workpapers: an audit's checklist items are its program steps. Each answer row gains the test
-- procedure, the sample, a result from the workpaper_result list (evidence library records are linked
-- through that library's own links, part 'step:<item id>'),
-- and the preparer's and reviewer's sign-off. A reviewed step is locked.
alter table checklist_responses add column if not exists procedure text;
alter table checklist_responses add column if not exists sample text;
alter table checklist_responses add column if not exists result text;
alter table checklist_responses add column if not exists prepared_by uuid;
alter table checklist_responses add column if not exists prepared_by_name text;
alter table checklist_responses add column if not exists prepared_at timestamptz;
alter table checklist_responses add column if not exists reviewed_by uuid;
alter table checklist_responses add column if not exists reviewed_by_name text;
alter table checklist_responses add column if not exists reviewed_at timestamptz;

-- Review notes the reviewer raises on a step; the preparer clears each one with a response.
create table if not exists workpaper_review_notes (
  id uuid primary key default gen_random_uuid(),
  parent_type text not null,
  parent_id uuid not null,
  item_id uuid not null,
  note text not null,
  raised_by uuid,
  raised_by_name text,
  raised_at timestamptz not null default now(),
  addressed_to uuid,
  addressed_to_name text,
  response text,
  cleared_by uuid,
  cleared_by_name text,
  cleared_at timestamptz
);
create index if not exists workpaper_review_notes_parent_ix on workpaper_review_notes (parent_type, parent_id, item_id);
create index if not exists workpaper_review_notes_open_ix on workpaper_review_notes (addressed_to) where cleared_at is null;

-- The auditor's verification that a finding was put right: who (never the person who owns the fix),
-- when, a note and the evidence looked at. A finding closes only once verified.
alter table audit_findings add column if not exists verifier_id uuid;
alter table audit_findings add column if not exists verification_due date;
alter table audit_findings add column if not exists verified_on date;
alter table audit_findings add column if not exists verified_by uuid;
alter table audit_findings add column if not exists verified_by_name text;
alter table audit_findings add column if not exists verification_note text;
alter table audit_findings add column if not exists verification_attachment_ids jsonb not null default '[]';
alter table audit_findings add column if not exists verification_evidence_ids jsonb not null default '[]';
create index if not exists audit_findings_verify_ix on audit_findings (verifier_id) where verified_on is null and deleted_at is null;
