-- E16-43: requests per API token in each clock minute, shared by every server process on the
-- database (the limit `tokens.rate_per_minute`, the RateLimit headers and `mcp.rate_per_minute`).
-- One row per bucket, key and minute, counted with one upsert per request (core/ratelimit.ts);
-- minutes that have passed are removed by the recurring job `core.request_counts`.
-- Unlogged: the counts are worth nothing after a crash, so they are not written to the WAL.
create unlogged table if not exists request_counts (
  bucket text not null,
  key text not null,
  minute bigint not null, -- whole minutes since 1970-01-01 UTC, by the database's clock
  hits integer not null default 1,
  primary key (bucket, key, minute)
);
