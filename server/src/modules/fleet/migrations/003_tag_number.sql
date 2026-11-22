-- Asset tags (wave 13, E37-01): vehicles gain a tag number, a copy of the vehicle's primary active
-- value in `tag_assignments` (modules/tags), which keeps the history and the uniqueness across types.
alter table vehicles add column if not exists tag_number text;
create index if not exists vehicles_tag_number_ix on vehicles (tag_number) where deleted_at is null and tag_number is not null;
