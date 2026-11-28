-- Wave 26 (E46): defects raised from inspections, and the follow-up of a missed inspection.

-- Why an inspection was missed, who said so and when; and the inspection that replaced it when it
-- was rescheduled (the missed one stays as it was, so the on-time figures keep it).
alter table inspections add column if not exists missed_reason text;
alter table inspections add column if not exists missed_reason_by uuid;
alter table inspections add column if not exists missed_reason_on date;
alter table inspections add column if not exists rescheduled_to_id uuid;
alter table inspections add column if not exists rescheduled_from_id uuid;

-- A defect found on a vehicle, site or asset: raised by hand or from a checklist item not met, then
-- deferred or repaired, and verified by someone other than the person who repaired it.
create table if not exists defects (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  description text,
  target_type text,
  target_id uuid,
  target_label text,
  inspection_id uuid,
  item_id uuid,
  severity text,
  out_of_service boolean not null default false,
  status text,
  found_on date,
  owner_id uuid,
  deferred_until date,
  deferral_reason text,
  work_order_ref text,
  repaired_on date,
  repaired_by uuid,
  repair_notes text,
  verified_on date,
  verified_by uuid,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index if not exists defects_target_ix on defects (target_type, target_id) where deleted_at is null;
create index if not exists defects_inspection_ix on defects (inspection_id) where deleted_at is null;
-- One defect per checklist item of an inspection, so raising them twice raises nothing new.
create unique index if not exists defects_inspection_item_ux on defects (inspection_id, item_id)
  where inspection_id is not null and item_id is not null and deleted_at is null;
