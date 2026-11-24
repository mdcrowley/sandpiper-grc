-- Wave 23 security review (S1): a file's reading is recorded before the reader starts, so a file
-- that stops the reader (or takes the server down with it) is tried once more and then marked
-- failed, never read again automatically (text.ts).
--   status  reading: an attempt started and has not finished (or was stopped and waits for its one retry)
--   attempts  how many times reading this file was started
alter table attachment_texts drop constraint if exists attachment_texts_status_check;
alter table attachment_texts add constraint attachment_texts_status_check
  check (status in ('indexed', 'empty', 'skipped', 'failed', 'reading'));
alter table attachment_texts add column attempts integer not null default 0;
