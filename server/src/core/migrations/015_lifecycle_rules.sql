-- E14-31: allowed status changes and required fields, kept as data per record type.
-- A record type with no row here follows its defaults: every move between the values of its
-- status list is allowed and no field is required for any status, which is how every record type
-- behaved before this table existed (so an upgrade changes nothing). The resource engine checks a
-- row's rules on every save a person makes (forms, the API, imports, AI assistants); a module's
-- own lifecycle rules in code still apply on top of them.
create table if not exists lifecycle_rules (
  record_type text primary key,
  field text not null,                              -- the status field the rules are about
  blocked jsonb not null default '[]',              -- [[from, to], ...] moves that are not allowed; from '' = a new record
  required jsonb not null default '{}',             -- { <status>: [field, ...] } filled in before a record may have that status
  who jsonb not null default '{}',                  -- { <status>: { permission: string | null, roles: [role key] } } who may move a record to it
  known jsonb not null default '[]',                -- the statuses of the list when the rules were saved (later ones are "new")
  updated_at timestamptz not null default now(),
  updated_by uuid
);
