-- Plans (E28-08, E28-09): the element map of a policy whose document type is a plan (for example
-- the safety plan), and its yearly review by several parties in turn.

create table policy_plan_elements (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references policies(id),
  element_key text not null,                         -- plan_element (operator-defined list)
  title text,
  section_ref text,                                  -- where the plan covers it: "Section 3.2"
  owner_id uuid,
  notes text,
  sort int not null default 0,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index policy_plan_elements_policy_ix on policy_plan_elements (policy_id, sort);

create table policy_plan_reviews (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references policies(id),
  version_id uuid,                                   -- the published version reviewed
  review_year int not null,
  outcome text not null default 'in_review',         -- in_review | approved | rejected | canceled
  started_on date not null,
  approved_on date,
  workflow_instance_id uuid,
  note text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index policy_plan_reviews_policy_ix on policy_plan_reviews (policy_id, started_on desc);
-- One review at a time: the row is claimed before the approval workflow starts.
create unique index policy_plan_reviews_running on policy_plan_reviews (policy_id) where outcome = 'in_review';
