-- Wave 26 (E45-60, E45-62): recused votes and declarations of interest per agenda item; an agenda
-- posting deadline per committee; and the committee's annual work plan of standing items.

-- A member may be recorded as recused from a vote (they declared an interest and took no part).
alter table meeting_decision_votes drop constraint if exists meeting_decision_votes_vote_check;
alter table meeting_decision_votes add constraint meeting_decision_votes_vote_check check (vote in ('for', 'against', 'abstain', 'absent', 'recused'));
alter table meeting_decisions add column if not exists votes_recused integer;

-- Declarations of interest (conflicts of interest): by a member (or anyone named) about one agenda
-- item, or the whole meeting when no item is named, and what they did about it.
create table if not exists meeting_declarations (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id),
  agenda_item_id uuid references agenda_items(id) on delete cascade,
  member_id uuid references committee_members(id),
  user_id uuid,
  name text not null,
  interest text not null,
  action text not null default 'recused' check (action in ('recused', 'left_room', 'stayed')),
  declared_at timestamptz not null default now(),
  recorded_by uuid,
  recorded_by_name text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index if not exists meeting_declarations_meeting_ix on meeting_declarations (meeting_id) where deleted_at is null;

-- The agenda must be posted (published) this many days before the meeting; the secretary is reminded.
alter table committees add column if not exists agenda_posting_days integer;

-- The annual work plan: standing items the committee takes in given months (or at every meeting).
create table if not exists committee_work_plan (
  id uuid primary key default gen_random_uuid(),
  committee_id uuid not null references committees(id),
  title text not null,
  description text,
  months integer[] not null default '{}',           -- 1 to 12; empty: at every meeting
  presenter text,
  session text not null default 'open',
  sort integer not null default 0,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index if not exists committee_work_plan_ix on committee_work_plan (committee_id) where deleted_at is null;
alter table agenda_items add column if not exists work_plan_item_id uuid;
