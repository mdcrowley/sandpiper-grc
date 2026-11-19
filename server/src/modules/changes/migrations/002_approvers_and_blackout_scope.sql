-- Approvals routed to named people or roles, the "starting soon" reminder, and blackout
-- periods that apply to chosen systems only or repeat. Additive: existing rows keep working.

-- Who may approve a submitted change, fixed when it is submitted: { "users": [uuid], "roles": [role key] }.
-- Null when the rule names nobody, so anyone with changes.approve (other than the requester) may approve.
alter table changes add column if not exists approver_pool jsonb;
-- The planned start the owner and implementer were last told about, so they are told once per window.
alter table changes add column if not exists start_notified_for timestamptz;

-- The person whose decision this is, when they recorded it themselves in the application.
alter table change_approvals add column if not exists approver_user_id uuid;

-- A blackout period for some systems only (empty = every change), and a repeat.
alter table change_blackouts add column if not exists system_ids jsonb not null default '[]'::jsonb;
-- none | weekly | monthly
alter table change_blackouts add column if not exists repeat text not null default 'none';
alter table change_blackouts add column if not exists repeat_until date;
