-- OT and rail-systems security fields on systems and assets (E33-01, wave 11 contract C2). The
-- field definitions are in inventory/fields-ot.ts; the zone is a record of the `ot` module, so
-- `zone_id` is a plain uuid column. Additive.
alter table systems add column if not exists ot_system boolean not null default false;
alter table systems add column if not exists control_level text;
alter table systems add column if not exists safety_related boolean not null default false;
alter table systems add column if not exists vendor_remote_access text;
alter table systems add column if not exists remote_access_path text;
alter table systems add column if not exists patchability text;
alter table systems add column if not exists field_location text;
alter table systems add column if not exists zone_id uuid;
create index if not exists systems_zone_ix on systems (zone_id) where zone_id is not null;

alter table assets add column if not exists ot_asset boolean not null default false;
alter table assets add column if not exists control_level text;
alter table assets add column if not exists safety_related boolean not null default false;
alter table assets add column if not exists firmware_version text;
alter table assets add column if not exists zone_id uuid;
create index if not exists assets_zone_ix on assets (zone_id) where zone_id is not null;
