-- Wave 23 security review (S5): the hashes of acknowledgment links a reminder replaced. Opening a
-- replaced link answers the same "not valid" as any other, but does not count toward the wrong-link
-- limit of the address (only a link that matches nothing ever sent counts), so people opening an
-- older message from one shared address do not lock everyone there out. Dead links only: a hash here
-- acknowledges nothing.
create table activation_callout_replaced_links (
  token_hash text primary key,
  recipient_id uuid not null references activation_callout_recipients(id) on delete cascade,
  replaced_at timestamptz not null default now()
);
create index activation_callout_replaced_links_recipient_ix on activation_callout_replaced_links (recipient_id);
