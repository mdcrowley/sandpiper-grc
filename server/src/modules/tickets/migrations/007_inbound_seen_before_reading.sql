-- Wave 9 (SP-01): a mailbox message is recorded as seen before it is read, with finished = false,
-- and marked finished once it has been dealt with. A message whose reading never finished (the
-- server stopped or hung on it) is not read again: the next poll logs it as failed and leaves it
-- in the mailbox for a person to look at. Rows from before this change were all finished.
alter table mail_inbound_seen add column if not exists finished boolean not null default true;
