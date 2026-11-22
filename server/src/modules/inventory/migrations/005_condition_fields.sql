-- Asset condition (E32, wave 11 contract C2): the class, latest condition rating, useful-life end
-- and replacement project of assets and sites. The condition module keeps the rating, date and
-- useful-life end up to date; they are read-only on the record. Assets gain an in-service date
-- (the purchase date stands in when it is empty); sites gain their kind, the year they were built
-- and whether they are still in use (a site no longer in use is left out of the percentages).

alter table assets add column asset_class_id uuid;
alter table assets add column condition_rating text;
alter table assets add column condition_assessed_on date;
alter table assets add column useful_life_end date;
alter table assets add column replacement_project_id uuid;
alter table assets add column in_service_date date;
create index assets_asset_class_ix on assets (asset_class_id) where deleted_at is null;

alter table sites add column asset_class_id uuid;
alter table sites add column site_kind text;
alter table sites add column built_year integer;
alter table sites add column in_use boolean not null default true;
alter table sites add column condition_rating text;
alter table sites add column condition_assessed_on date;
alter table sites add column useful_life_end date;
alter table sites add column replacement_project_id uuid;
create index sites_asset_class_ix on sites (asset_class_id) where deleted_at is null;
