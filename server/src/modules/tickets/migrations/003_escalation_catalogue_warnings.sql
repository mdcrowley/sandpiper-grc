-- E03-13: one warning per clock before the target, so the sweep tells each person once.
alter table tickets add column response_warned boolean not null default false;
alter table tickets add column resolve_warned boolean not null default false;

-- E03-14: escalation rules are data. One row per ticket and rule records that the rule has fired.
create table escalation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- unassigned | no_response | untouched
  condition text not null,
  wait_minutes int not null,
  to_user_id uuid,
  to_group text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table ticket_escalations (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id),
  rule_id uuid not null references escalation_rules(id),
  rule_name text not null,
  escalated_to text not null default '',
  at timestamptz not null default now(),
  unique (ticket_id, rule_id)
);
alter table tickets add column escalated_at timestamptz;

-- E03-15: catalog items carry their own questions, fulfillment tasks and an approval switch;
-- the ticket keeps the answers, its own copy of the tasks and the approval decision.
alter table catalog_items add column questions jsonb;
alter table catalog_items add column tasks jsonb;
alter table catalog_items add column requires_approval boolean not null default false;

alter table tickets add column catalog_answers jsonb;
alter table tickets add column fulfilment_tasks jsonb;
alter table tickets add column approval_status text;
alter table tickets add column approval_by uuid;
alter table tickets add column approval_at timestamptz;
alter table tickets add column approval_note text;
