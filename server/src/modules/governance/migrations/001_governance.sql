-- Committees and meetings (E28): committees with their members by side, meetings with an agenda,
-- a frozen report pack, attendance, minutes and a register of decisions. Permission module `governance`.

create table committees (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  name text not null,
  kind text,                                         -- committee_kind: governing_body, risk, safety, audit, other
  purpose text,
  chair_id uuid,                                     -- a user: the chair approves minutes and decides at meetings
  secretary_id uuid,                                 -- a user: prepares meetings and records decisions
  quorum_rule text not null default 'count',         -- count | percent (of voting members)
  quorum_value numeric,
  meeting_frequency text,                            -- committee_frequency
  joint_labor_management boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table committee_members (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid not null references committees(id),
  user_id uuid,                                      -- an account, when the member has one
  person_id uuid,                                    -- a roster person (type `person`, people module), when loaded
  name text,                                         -- typed only for a member with no account or roster person; otherwise read from them
  side text,                                         -- committee_side: management, labor, independent, not_applicable
  role text not null default 'member',               -- committee_role: chair, member, alternate
  voting boolean not null default true,
  from_on date,
  to_on date,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index committee_members_committee_ix on committee_members (committee_id) where deleted_at is null;

create table meetings (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  committee_id uuid not null references committees(id),
  title text not null,
  scheduled_at timestamptz not null,
  location text,
  status text not null default 'planned',            -- meeting_status
  chair_id uuid,                                     -- copied from the committee when the meeting is planned
  secretary_id uuid,
  pack_snapshot_id uuid,                             -- report_snapshots (reports module), frozen for this meeting
  pack_frozen_at timestamptz,
  minutes text,
  quorum_met boolean,                                -- worked out from attendance
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index meetings_committee_ix on meetings (committee_id, scheduled_at desc) where deleted_at is null;

create table meeting_attendance (
  meeting_id uuid not null references meetings(id),
  member_id uuid not null references committee_members(id),
  present boolean not null default false,
  apology boolean not null default false,
  updated_at timestamptz not null default now(), updated_by uuid,
  primary key (meeting_id, member_id)
);

create table agenda_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id),
  sort int not null default 0,
  title text not null,
  presenter text,
  record_type text,                                  -- the record discussed, if any
  record_id uuid,
  workflow_kind text,                                -- an approval waiting for the chair, put on the agenda
  workflow_instance_id uuid,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index agenda_items_meeting_ix on agenda_items (meeting_id, sort);

create table meeting_decisions (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  meeting_id uuid not null references meetings(id),
  agenda_item_id uuid,
  title text not null,                               -- what was decided
  notes text,
  outcome text not null default 'approved',          -- decision_outcome: approved, rejected, noted, deferred
  record_type text,                                  -- the record decided, if any
  record_id uuid,
  restricted boolean not null default false,         -- taken from the record decided
  applied_to_workflow text,                          -- set when the decision completed a waiting approval step
  applied_at timestamptz,
  applied_by uuid,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index meeting_decisions_meeting_ix on meeting_decisions (meeting_id) where deleted_at is null;
create index meeting_decisions_record_ix on meeting_decisions (record_type, record_id) where deleted_at is null;
