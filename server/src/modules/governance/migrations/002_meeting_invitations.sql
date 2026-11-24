-- Meeting invitations by email (E41-17, governance/invitations.ts): how long a meeting lasts, for the
-- calendar event's end, and when invitations were last sent with the event's sequence number, so a
-- second sending updates the event in people's calendars instead of adding another.
alter table meetings add column if not exists duration_minutes integer;
alter table meetings add column if not exists invited_at timestamptz;
alter table meetings add column if not exists invite_sequence integer not null default 0;
