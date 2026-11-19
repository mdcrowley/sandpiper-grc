-- Vendors answer an assessment themselves (E06-21): a link per draft assessment that works
-- without an account. Only a hash of the link's secret is kept. The vendor's answers are kept
-- here, apart from the assessment, until staff review them and take them over.
create table vendor_assessment_links (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references vendor_assessments(id),
  token_hash text not null unique,
  recipient text,
  expires_at timestamptz not null,
  answers jsonb not null default '{}',     -- { <question key>: { answer, note } } as the vendor gave them
  responder_name text,
  opened_at timestamptz,
  saved_at timestamptz,
  submitted_at timestamptz,
  revoked_at timestamptz, revoked_by uuid,
  created_at timestamptz not null default now(), created_by uuid
);
create index vendor_assessment_links_assessment_ix on vendor_assessment_links (assessment_id);
