-- E15-13: files on a ticket that the service desk shares with the requester (the portal shows them).
create table ticket_shared_files (
  attachment_id uuid primary key,
  ticket_id uuid not null,
  shared_by uuid,
  shared_by_name text,
  shared_at timestamptz not null default now()
);
create index ticket_shared_files_ticket_ix on ticket_shared_files (ticket_id);

-- E03-21: approval by more than one person, or only for some answers.
-- approver_ids: user ids who may decide (null = anyone with tickets.approve).
-- approval_condition: { "question": "<key>", "answers": ["Yes"] } (null = always, when requires_approval).
alter table catalog_items add column approvals_needed int not null default 1;
alter table catalog_items add column approver_ids jsonb;
alter table catalog_items add column approval_condition jsonb;
-- Copied to the ticket when it is raised, so a later change to the item does not move the goalposts.
alter table tickets add column approvals_needed int;
alter table tickets add column approver_ids jsonb;
-- One row per decision. A person's latest decision counts; an approval given while the request
-- stands rejected overturns the rejection (the overturned rows are kept, marked superseded).
create table ticket_approvals (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null,
  user_id uuid not null,
  user_name text,
  decision text not null,
  note text,
  superseded boolean not null default false,
  decided_at timestamptz not null default now()
);
create index ticket_approvals_ticket_ix on ticket_approvals (ticket_id, decided_at);

-- E15-06: email-to-ticket. Every message read from the mailbox or posted by a mail relay.
create table mail_inbound_log (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  -- pop3 or relay
  source text not null,
  message_id text,
  from_address text,
  from_name text,
  subject text,
  -- created (a new ticket), commented (a reply added), ignored (loop guard, unknown sender ...), refused, failed
  outcome text not null,
  reason text,
  ticket_id uuid,
  attachments int not null default 0,
  size_bytes int
);
create index mail_inbound_log_recent_ix on mail_inbound_log (received_at desc);
create index mail_inbound_log_message_ix on mail_inbound_log (message_id);
create index mail_inbound_log_sender_ix on mail_inbound_log (from_address, received_at);

-- Mailbox messages already read (POP3 unique ids), so a message left on the server is read once.
create table mail_inbound_seen (
  uid text primary key,
  seen_at timestamptz not null default now()
);
