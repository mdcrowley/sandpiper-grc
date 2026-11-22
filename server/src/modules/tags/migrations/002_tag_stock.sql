-- Asset tags (wave 13, E37-03): a sequence range and a series keep the check character they were made
-- with, copied from their format when created, so changing a format later never changes the values a
-- range or series stands for.
alter table tag_ranges add column check_character text not null default 'none' check (check_character in ('none', 'mod10', 'mod11', 'mod36'));
alter table tag_series add column check_character text not null default 'none' check (check_character in ('none', 'mod10', 'mod11', 'mod36'));
create index tag_ranges_series_ix on tag_ranges (series_id) where series_id is not null;
create index tag_assignments_active_record_ix on tag_assignments (record_type, record_id) where status = 'active';
