-- E15: the self-service portal.
-- A catalogue item appears in the portal only when it is marked for it.
alter table catalog_items add column portal boolean not null default false;

-- The person affected, when that is a signed-in user (the portal shows them the ticket too).
alter table tickets add column affected_user_id uuid;

-- A satisfaction answer given by the requester in the portal: once given, nobody overwrites it.
alter table tickets add column satisfaction_by_requester boolean not null default false;
alter table tickets add column satisfaction_at timestamptz;

-- How often the requester reopened the ticket from the portal.
alter table tickets add column reopened_count int not null default 0;

create index if not exists tickets_requester_id_idx on tickets (requester_id) where deleted_at is null;
create index if not exists tickets_affected_user_id_idx on tickets (affected_user_id) where deleted_at is null;
