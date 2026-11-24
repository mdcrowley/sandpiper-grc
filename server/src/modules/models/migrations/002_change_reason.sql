-- W19 security review of E39.
-- Why a change of a model stopped before it reached every member (the person who saved the model can
-- no longer sign in or edit the area, the area was switched off before the background job ran, the
-- job gave up) or was superseded by a newer change of the same model.
alter table model_changes add column if not exists reason text;

-- A vehicle model removed for good (retention review) takes its equipment list with it, instead of the
-- removal failing on this key.
alter table vehicle_model_equipment drop constraint if exists vehicle_model_equipment_vehicle_model_id_fkey;
alter table vehicle_model_equipment add constraint vehicle_model_equipment_vehicle_model_id_fkey
  foreign key (vehicle_model_id) references vehicle_models(id) on delete cascade;
