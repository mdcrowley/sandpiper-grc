-- E18-70: data load mode. Every record created while an administrator works in data load mode
-- (core/dataload.ts) is listed here, so the load can be reviewed and undone: the Data loads page
-- groups the rows by day and record type, and "delete everything this load created" soft-deletes
-- them through the resource engine. A record that is deleted is kept here with `deleted_at`.
create table if not exists data_load_records (
  id bigserial primary key,
  record_type text not null,
  record_id uuid not null,
  loaded_at timestamptz not null default now(),
  loaded_by uuid,
  token_id uuid,
  token_name text,
  deleted_at timestamptz,
  deleted_by uuid,
  unique (record_type, record_id)
);
create index if not exists data_load_records_loaded on data_load_records (loaded_at);
