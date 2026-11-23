-- E16-41: substring search without lowercasing every row on every query.
--
-- Part of a word is matched on `search_index.body` (migration 009). With `body ILIKE '%x%'` the
-- database lowercases the whole text of every row it tests, and it expects an ILIKE pattern to match
-- far more rows than it does, so it read the whole search index for every search, even for a word
-- in a handful of records (about 150 ms at 87,000 records on two processors).
--
-- `body_lc` is the same text, lowercased once when it is written. `body_lc LIKE lower('%x%')` matches
-- exactly the rows `body ILIKE '%x%'` does (in a UTF-8 database ILIKE is defined as LIKE on both sides
-- lowercased), is estimated well, and is answered through the trigram index.
alter table search_index add column if not exists body_lc text generated always as (lower(body)) stored;

-- The trigram index moves from `body` to `body_lc` (same name; nothing searches `body` with ILIKE any
-- more). Where pg_trgm is not available the match still works, by reading the table.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_trgm') then
    execute 'drop index if exists search_index_body_trgm_ix';
    execute 'create index search_index_body_trgm_ix on search_index using gin (body_lc gin_trgm_ops)';
  end if;
end $$;

analyze search_index;
