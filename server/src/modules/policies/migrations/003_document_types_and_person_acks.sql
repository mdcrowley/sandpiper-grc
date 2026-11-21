-- Document types (E29-08, contract C6): policy, procedure, rulebook section, bulletin, standard,
-- plan (list policy_document_type; each value's meta.review_months is its review cycle).
alter table policies add column if not exists document_type text;
update policies set document_type = 'policy' where document_type is null;
-- Roster audiences (E29-09): positions (people module) whose roster people must acknowledge,
-- and whether the roster is asked at all.
alter table policies add column if not exists audience_positions jsonb not null default '[]';
alter table policies add column if not exists ack_roster boolean not null default false;

-- Acknowledgments by roster people, who may have no account: recorded from a sign-in sheet,
-- on a supervisor's kiosk, or by hand. One row per person per version.
create table if not exists policy_person_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references policies(id),
  version_id uuid not null references policy_versions(id),
  person_id uuid not null,                 -- people module (no foreign key across modules)
  requested_at timestamptz not null default now(),
  due_on date,
  acknowledged_at timestamptz,
  method text,                             -- sign_in_sheet | kiosk | recorded
  recorded_by uuid,                        -- the signed-in user who recorded it
  sheet_attachment_id uuid,                -- the scanned sign-in sheet (attachments module)
  superseded_at timestamptz,
  unique (version_id, person_id)
);
create index if not exists policy_person_acks_policy_ix on policy_person_acknowledgements (policy_id);
create index if not exists policy_person_acks_person_ix on policy_person_acknowledgements (person_id);
