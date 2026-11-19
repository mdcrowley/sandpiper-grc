-- E16-36: faster search at volume.
--
-- `search_index.body` holds the text a record is matched on by substring (its searchable fields
-- and its reference, separated by a control character so a match never spans two fields). The
-- search trigger (core/search.ts) fills it beside the vector, so "part of a word" is answered from
-- this one narrow table instead of by reading every row of every record table.
alter table search_index add column if not exists body text;

-- Trigram index for that substring match (ILIKE '%...%'). pg_trgm ships with PostgreSQL (contrib)
-- and with the embedded database; it is a trusted extension, so the database owner may create it.
-- Where it cannot be created the match still works, by reading the table.
do $$
begin
  create extension if not exists pg_trgm;
exception when others then
  raise notice 'pg_trgm is not available (%): substring search is not indexed', sqlerrm;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    execute 'create index if not exists search_index_body_trgm_ix on search_index using gin (body gin_trgm_ops)';
  end if;
end $$;
