-- Outside reviewers (E41-09): accounts for people outside the organization (an external auditor, a
-- funder's reviewer), each limited to the audit engagements or funder compliance reviews they were
-- invited to, until an end date.

-- An account in this table is an outside reviewer's for good: the server confines it to its
-- reviews and its own sign-in security, whatever roles it is ever given. Rows are never removed.
create table outside_reviewers (
  user_id uuid primary key,
  organization text,
  -- Set when the account was disabled because no review was open to it any more (a new invitation
  -- turns such an account back on; one an administrator disabled stays off).
  ended_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid
);

-- One invitation: one reviewer, one engagement or review, until the end of `expires_on`
-- (the organization's date). Revoking ends it at once.
create table outside_review_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  subject_type text not null,
  subject_id uuid not null,
  expires_on date not null,
  note text,
  revoked_at timestamptz,
  revoked_by uuid,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index outside_review_grants_subject_ix on outside_review_grants (subject_type, subject_id);
create index outside_review_grants_user_ix on outside_review_grants (user_id);
