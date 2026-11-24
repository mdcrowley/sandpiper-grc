-- Call-tree messages with acknowledgment (E41-14): an activation sends a plan's call tree a message
-- by email and text message, and each person acknowledges through a link of their own.

create table activation_callouts (
  id uuid primary key default gen_random_uuid(),
  activation_id uuid not null references emergency_activations(id),
  plan_id uuid,
  message text not null,
  by_email boolean not null default true,
  by_text boolean not null default true,
  expires_at timestamptz not null,
  sent_at timestamptz not null default now(),
  sent_by uuid,
  sent_by_name text,
  created_at timestamptz not null default now()
);
create index activation_callouts_ix on activation_callouts (activation_id, sent_at desc);

-- One row per call tree entry the message was for. Only a hash of each acknowledgment link's secret
-- is kept. Names are copied when the message is sent, so the list reads as it was sent.
create table activation_callout_recipients (
  id uuid primary key default gen_random_uuid(),
  callout_id uuid not null references activation_callouts(id) on delete cascade,
  activation_id uuid not null,
  node_id uuid,
  sort int not null default 0,
  depth int not null default 0,
  role text,
  name text,
  user_id uuid,
  person_id uuid,
  email_log_id uuid,
  text_log_ids jsonb not null default '[]',
  token_hash text unique,
  acknowledged_at timestamptz,
  ack_via text,                                      -- link (the person) or staff (recorded by someone else)
  ack_by uuid,
  ack_by_name text,
  ack_note text,
  created_at timestamptz not null default now()
);
create index activation_callout_recipients_ix on activation_callout_recipients (callout_id, sort);
create index activation_callout_recipients_activation_ix on activation_callout_recipients (activation_id);
