-- Asset tags (wave 13, E37-01): sites and systems gain a tag number. The asset's existing `tag`
-- column is its tag value. The column holds a copy of the record's primary active value; the source
-- of truth, and the uniqueness across every taggable type, is `tag_assignments` (modules/tags).
alter table sites add column if not exists tag_number text;
alter table systems add column if not exists tag_number text;
create index if not exists sites_tag_number_ix on sites (tag_number) where deleted_at is null and tag_number is not null;
create index if not exists systems_tag_number_ix on systems (tag_number) where deleted_at is null and tag_number is not null;
