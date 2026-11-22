-- Personal data on data categories (wave 11 contract C2, E34-05): whether a category holds personal
-- data and which kinds (list personal_data_kind). Privacy impact assessments are expected for systems
-- that hold such categories. Hidden while the records area is switched off.
alter table data_categories add column if not exists personal_data boolean not null default false;
alter table data_categories add column if not exists personal_data_kinds jsonb not null default '[]';
