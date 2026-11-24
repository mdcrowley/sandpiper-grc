-- E41-01: departments and sites as access scope.

-- A role's grants for a permission module may be scoped to its members' departments or sites:
-- { "<module>": "department" | "site" } (core/scope.ts). Empty: every grant reaches every record.
alter table roles add column if not exists scopes jsonb not null default '{}';

-- Departments become a record type (the people module's `department`): a department may sit under
-- another one, and has a manager, who is scoped to it and every department below it.
alter table departments add column if not exists parent_id uuid;
alter table departments add column if not exists manager_id uuid;
alter table departments add column if not exists description text;
create index if not exists departments_parent_ix on departments (parent_id) where deleted_at is null;
create index if not exists departments_manager_ix on departments (manager_id) where deleted_at is null;
create index if not exists users_department_ix on users (department_id) where deleted_at is null;

-- Record types that kept their department as text (assets, actions, projects, business processes)
-- now point at a department (`department_id`). Their `department` column stays, holding the
-- department's name for the reports, summaries and searches that read it; this trigger keeps it
-- right however the row is written. A name written on its own (an older client) is matched to the
-- department of that name, when there is one.
create or replace function grc_department_name() returns trigger language plpgsql as $$
declare
  found_id uuid;
  found_name text;
begin
  if new.department_id is not null then
    select name into found_name from departments where id = new.department_id;
    new.department := found_name;
  elsif tg_op = 'UPDATE' and old.department_id is not null and new.department is not distinct from old.department then
    -- The department was cleared.
    new.department := null;
  elsif nullif(btrim(coalesce(new.department, '')), '') is not null
        and (tg_op = 'INSERT' or new.department is distinct from old.department) then
    select id, name into found_id, found_name from departments
      where lower(name) = lower(btrim(new.department)) and deleted_at is null order by created_at limit 1;
    if found_id is not null then
      new.department_id := found_id;
      new.department := found_name;
    end if;
  end if;
  return new;
end $$;

-- A renamed department: the name kept on records that point at it follows.
create or replace function grc_department_renamed() returns trigger language plpgsql as $$
declare
  t record;
begin
  if new.name is distinct from old.name then
    for t in
      select c.table_name from information_schema.columns c
      where c.table_schema = current_schema() and c.column_name = 'department'
        and exists (select 1 from information_schema.columns c2 where c2.table_schema = c.table_schema
                      and c2.table_name = c.table_name and c2.column_name = 'department_id')
        and exists (select 1 from information_schema.tables t2 where t2.table_schema = c.table_schema
                      and t2.table_name = c.table_name and t2.table_type = 'BASE TABLE')
    loop
      execute format('update %I set department = $1 where department_id = $2', t.table_name) using new.name, new.id;
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists departments_renamed on departments;
create trigger departments_renamed after update of name on departments
  for each row execute function grc_department_renamed();
