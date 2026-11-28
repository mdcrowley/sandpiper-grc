-- Wave 26 (E46): retiring a vehicle needs an approval, as disposing of an asset does. The request
-- history is kept in vehicle_retirement_requests; the vehicle carries the approval and the disposal record.
alter table vehicles add column if not exists retirement_request_status text;
alter table vehicles add column if not exists retirement_approved_by text;
alter table vehicles add column if not exists retirement_approved_on date;
alter table vehicles add column if not exists retirement_method text;
alter table vehicles add column if not exists retirement_proceeds numeric;
alter table vehicles add column if not exists retirement_funder_ref text;
alter table vehicles add column if not exists retired_on date;

create table if not exists vehicle_retirement_requests (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id),
  status text not null default 'pending',  -- pending | approved | refused | withdrawn
  reason text,
  method text,
  expected_proceeds numeric,
  funder_ref text,
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_comment text,
  decided_on_behalf_of_name text
);
create index if not exists vehicle_retirement_requests_vehicle_ix on vehicle_retirement_requests (vehicle_id, requested_at desc);
create unique index if not exists vehicle_retirement_requests_pending_ux on vehicle_retirement_requests (vehicle_id) where status = 'pending';
