-- E16-37: schema changes the server could not make itself. With a least-privilege run-time
-- database role (E16-31) the server never changes the schema; when it would need to (a search
-- definition changed, a record table without the custom-field column), it records the need here.
-- The owner's migrate step (at start-up with GRC_DATABASE_MIGRATE_URL, or the migrate command)
-- makes the change from the application's own definitions, never from anything stored in this
-- table, and removes the row once done.
create table if not exists schema_requests (
  kind text not null,                -- 'search' (a search trigger to rebuild) or 'custom_column'
  target text not null,              -- the record type (or '__comments')
  detail text,                       -- what is wanted, for people reading it
  requested_at timestamptz not null default now(),
  primary key (kind, target)
);
