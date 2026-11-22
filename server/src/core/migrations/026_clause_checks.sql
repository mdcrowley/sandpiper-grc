-- One clause-checklist engine (wave 11 contract C4, E35-05 and E27-11): a checklist row records
-- whether one record (the scope, today always a contract) has one clause of a set, optionally per
-- sub-key (the funding award a funder-required clause belongs to). The contract security terms
-- (set `security_terms`) and the funder-required clauses (set `funder_clauses`, sub-key = award id)
-- both live here. The vendors and funding migrations copy their old tables in and keep them,
-- unwritten, for one release. The scope is a plain uuid: no foreign keys across modules.

create table if not exists clause_checks (
  id uuid primary key default gen_random_uuid(),
  set_key text not null,
  scope_type text not null,
  scope_id uuid not null,
  sub_key text not null default '',        -- '' when the set has no sub-key
  clause_key text not null,
  status text,                             -- a value of the set's status list; null = not assessed
  clause_text text,
  note text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz,
  unique (set_key, scope_type, scope_id, sub_key, clause_key)
);
create index if not exists clause_checks_scope_ix on clause_checks (scope_type, scope_id);
create index if not exists clause_checks_set_ix on clause_checks (set_key, clause_key);
