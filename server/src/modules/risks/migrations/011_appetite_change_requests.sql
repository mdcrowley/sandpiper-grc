-- Wave 27 (E46-53): a change of the risk appetite asked for through an approval workflow. The request
-- holds the proposed appetite of one category; approval records it as the category's next version
-- (risk_appetite_versions), with the approver, the date of approval, the workflow as the approving body
-- and the request's number as the reference.
create table if not exists risk_appetite_changes (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text,
  category text not null,
  statement text,
  max_rating text,
  max_score int,
  remove_appetite boolean not null default false,
  reason text,
  status text,
  requested_by uuid,
  decided_on date,
  decided_by_name text,
  decision_note text,
  version int,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index if not exists risk_appetite_changes_waiting_ix on risk_appetite_changes (category) where deleted_at is null and status = 'awaiting_approval';
