-- E01-24: list views shared with everyone who can see the list. A person's own saved views stay in
-- user_preferences (`views:<type>`); a shared view is data that other people see, so it is a row of
-- its own, audited when it is added, changed or removed.
create table shared_views (
  id uuid primary key default gen_random_uuid(),
  record_type text not null,
  name text not null,
  view jsonb not null,                             -- { q, sort, dir, filters: { <field>: [values] } }
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create unique index shared_views_name_ix on shared_views (record_type, lower(name));
