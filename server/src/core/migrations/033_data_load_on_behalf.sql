-- E18-71: acting on behalf of someone in data load mode (core/dataload.ts). A load may name the
-- person who wrote or did something (an account, a roster person, or a plain name). The audit log
-- keeps the real actor in actor_id / actor_name and the named person beside it; the list of loaded
-- records keeps the name too, for the Data loads page. Both columns are empty for everything else.
alter table audit_events add column if not exists on_behalf_id uuid;
alter table audit_events add column if not exists on_behalf_name text;
create index if not exists audit_events_on_behalf_ix on audit_events (at) where on_behalf_name is not null;
alter table data_load_records add column if not exists on_behalf_name text;
