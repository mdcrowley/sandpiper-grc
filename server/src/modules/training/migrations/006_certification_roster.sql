-- Wave 27 (E46-72): a certification carries its holder's position and department from the roster, kept
-- in step when the person moves, so the certification list can be filtered, grouped and exported by
-- position or department. The people module owns both: plain uuid columns, no cross-module keys.
alter table certifications add column if not exists position_id uuid;
alter table certifications add column if not exists department_id uuid;
create index if not exists certifications_position_ix on certifications (position_id) where deleted_at is null;
create index if not exists certifications_department_ix on certifications (department_id) where deleted_at is null;
