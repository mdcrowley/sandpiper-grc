-- Required documents, change records on gates, requests from people outside the project team,
-- and the systems a project affects.

-- Who submitted the request (shown its progress without needing to view every project).
alter table projects add column requested_by uuid;
-- Systems the project affects: a list of `system` ids (inventory module; no foreign key across modules).
alter table projects add column systems_affected jsonb not null default '[]';
create index projects_requested_by_ix on projects (requested_by) where deleted_at is null;

-- Templates: documents become [{ name, required }]; a gate may ask for a change record.
alter table project_gate_defs add column wants_change boolean not null default false;
update project_gate_defs set wants_change = true where key = 'go_live';
update project_gate_defs d set required_documents = coalesce((
  select jsonb_agg(case when jsonb_typeof(e) = 'string' then jsonb_build_object('name', e, 'required', true) else e end)
  from jsonb_array_elements(d.required_documents) e), '[]'::jsonb);

-- Gates on projects: documents gain required / waived / attachment_id; optional change record.
alter table project_gates add column wants_change boolean not null default false;
alter table project_gates add column change_id uuid;                 -- changes module
update project_gates set wants_change = true where gate_key = 'go_live';
-- Documents on gates that were already open stay optional, so nothing in flight becomes blocked.
update project_gates g set documents = coalesce((
  select jsonb_agg(e || jsonb_build_object('required', coalesce((e->>'required')::boolean, false)))
  from jsonb_array_elements(g.documents) e), '[]'::jsonb);
