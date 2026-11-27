-- Board book and structured minutes (wave 25): agenda items with their papers, presenter, time
-- allotted, open or closed (executive) session and consent agenda; minutes written per agenda item;
-- motions with mover, seconder, votes and a resolution number on the decisions register; minutes
-- approved at a later meeting by a motion, then published.

-- The text put before a committee's resolution numbers ("R-" gives R-2026-01, R-2026-02, ...).
alter table committees add column if not exists resolution_prefix text;

alter table agenda_items add column if not exists session text not null default 'open';   -- open | closed (executive session)
alter table agenda_items add column if not exists consent boolean not null default false;   -- on the consent agenda
alter table agenda_items add column if not exists minutes_allotted integer;                -- time allotted
alter table agenda_items add column if not exists presenter_id uuid;                       -- an account; `presenter` is a typed name
alter table agenda_items add column if not exists discussion text;                         -- the minutes of the item: discussion summary

-- The papers of an agenda item: a file attached to the meeting, a controlled document from the
-- document library (type `policy`), or any other record.
create table if not exists agenda_item_papers (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references agenda_items(id) on delete cascade,
  meeting_id uuid not null references meetings(id),
  kind text not null check (kind in ('file', 'document', 'record')),
  attachment_id uuid,
  record_type text,
  record_id uuid,
  sort int not null default 0,
  created_at timestamptz not null default now(), created_by uuid
);
create index if not exists agenda_item_papers_item_ix on agenda_item_papers (item_id, sort);

-- Minutes approved at a later meeting (the motion that approved them) and published.
alter table meetings add column if not exists minutes_approved_on date;
alter table meetings add column if not exists minutes_approved_meeting_id uuid;
alter table meetings add column if not exists minutes_approved_decision_id uuid;
alter table meetings add column if not exists minutes_published_at timestamptz;
alter table meetings add column if not exists minutes_published_by uuid;
alter table meetings add column if not exists minutes_published_by_name text;

-- A decision taken on a motion: who moved and seconded it (a member, an account or a typed name),
-- the vote (per member, or counts only), and its resolution number.
alter table meeting_decisions add column if not exists motion_text text;
alter table meeting_decisions add column if not exists mover_member_id uuid;
alter table meeting_decisions add column if not exists mover_user_id uuid;
alter table meeting_decisions add column if not exists mover_name text;
alter table meeting_decisions add column if not exists seconder_member_id uuid;
alter table meeting_decisions add column if not exists seconder_user_id uuid;
alter table meeting_decisions add column if not exists seconder_name text;
alter table meeting_decisions add column if not exists vote_mode text;                      -- null (no vote) | members | counts
alter table meeting_decisions add column if not exists votes_for integer;
alter table meeting_decisions add column if not exists votes_against integer;
alter table meeting_decisions add column if not exists votes_abstain integer;
alter table meeting_decisions add column if not exists votes_absent integer;
alter table meeting_decisions add column if not exists vote_summary text;                   -- "For 5, against 1, abstaining 0, absent 1"
alter table meeting_decisions add column if not exists resolution_number text;
alter table meeting_decisions add column if not exists closed_session boolean not null default false;
alter table meeting_decisions add column if not exists consent_agenda boolean not null default false;
alter table meeting_decisions add column if not exists recorded_by uuid;
alter table meeting_decisions add column if not exists recorded_by_name text;

create table if not exists meeting_decision_votes (
  decision_id uuid not null references meeting_decisions(id) on delete cascade,
  member_id uuid not null references committee_members(id),
  vote text not null check (vote in ('for', 'against', 'abstain', 'absent')),
  primary key (decision_id, member_id)
);
