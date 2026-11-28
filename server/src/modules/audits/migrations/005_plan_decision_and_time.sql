-- Wave 26: the audit plan approved by a committee decision (E45-64), and each audit's time budget with
-- the hours worked against it (E45-63).
alter table audit_plans add column if not exists approval_decision_id uuid;
alter table audit_plans add column if not exists approval_reference text;

alter table audits add column if not exists budget_hours numeric;

create table if not exists audit_time_entries (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits(id),
  user_id uuid,
  person_name text not null,
  worked_on date not null,
  hours numeric not null check (hours > 0 and hours <= 24),
  item_id uuid,
  activity text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index if not exists audit_time_entries_audit_ix on audit_time_entries (audit_id) where deleted_at is null;
