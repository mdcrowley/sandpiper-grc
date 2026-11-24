-- Proof of data wiping at disposal (E41-17): an asset that holds data records how its data was wiped,
-- when, by whom and the wiping certificate's reference before it may be marked disposed
-- (inventory/fields-wiping.ts).
alter table assets add column if not exists data_bearing boolean not null default false;
alter table assets add column if not exists data_wipe_method text;
alter table assets add column if not exists data_wiped_on date;
alter table assets add column if not exists data_wiped_by text;
alter table assets add column if not exists data_wipe_certificate text;
