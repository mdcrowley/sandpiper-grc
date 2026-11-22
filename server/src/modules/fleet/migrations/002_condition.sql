-- Asset condition (E32, wave 11 contract C2): a vehicle's class, odometer, latest condition rating,
-- useful-life end and replacement project. The condition module keeps the rating, date and
-- useful-life end up to date; they are read-only on the record.

alter table vehicles add column asset_class_id uuid;
alter table vehicles add column odometer_miles numeric;
-- The day the odometer was last changed: with the in-service date it gives the rate the vehicle runs at.
alter table vehicles add column odometer_read_on date;
alter table vehicles add column condition_rating text;
alter table vehicles add column condition_assessed_on date;
alter table vehicles add column useful_life_end date;
alter table vehicles add column replacement_project_id uuid;
create index vehicles_asset_class_ix on vehicles (asset_class_id) where deleted_at is null;
