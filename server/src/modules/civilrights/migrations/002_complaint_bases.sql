-- Wave 27 (E46-61): a complaint may name several bases. `bases` holds every basis (values of the
-- civil_rights_basis list); `basis` stays as the first of them, for grouping and older clients.
alter table civil_rights_complaints add column if not exists bases jsonb not null default '[]';
update civil_rights_complaints set bases = jsonb_build_array(basis) where basis is not null and bases = '[]'::jsonb;
