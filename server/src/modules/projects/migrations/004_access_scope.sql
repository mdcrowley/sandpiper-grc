-- E41-01: departments and sites as access scope.

-- Projects: the department becomes a reference to the organization's departments.
alter table projects add column if not exists department_id uuid;
create index if not exists projects_department_ix on projects (department_id);
-- Names not yet in the department list join it, so every value converts.
insert into departments (name)
  select distinct on (lower(btrim(x.department))) btrim(x.department) from projects x
  where nullif(btrim(x.department), '') is not null and length(btrim(x.department)) <= 80
    and not exists (select 1 from departments d where lower(d.name) = lower(btrim(x.department)) and d.deleted_at is null)
  order by lower(btrim(x.department)), btrim(x.department)
on conflict (name) do update set deleted_at = null, updated_at = now();
update projects x set department_id = d.id, department = d.name from departments d
  where x.department_id is null and nullif(btrim(x.department), '') is not null
    and lower(d.name) = lower(btrim(x.department)) and d.deleted_at is null;
-- The department column keeps the department's name (core migration 031).
drop trigger if exists projects_department_name on projects;
create trigger projects_department_name before insert or update of department, department_id on projects
  for each row execute function grc_department_name();
