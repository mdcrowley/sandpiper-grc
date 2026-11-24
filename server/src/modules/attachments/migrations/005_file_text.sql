-- E41-16: the text inside attached files (PDF, Word .docx and plain text), read by a background job
-- (text.ts) so that search finds a record by what its files say. One row per file that was looked
-- at, whatever came of it, so a file is read once:
--   status  indexed (text found) | empty (no text, such as a scanned PDF) | skipped (too large) | failed
-- The text follows its file: a removed file's row is deleted at once (trigger below, whichever
-- path removes it: a person, retention, housekeeping), and a file put back is read again.
create table attachment_texts (
  attachment_id uuid primary key references attachments(id) on delete cascade,
  status text not null check (status in ('indexed', 'empty', 'skipped', 'failed')),
  detail text,
  chars integer not null default 0,
  content text,
  vector tsvector,
  extracted_at timestamptz not null default now()
);
create index attachment_texts_vector_ix on attachment_texts using gin (vector);

create or replace function attachment_text_gone() returns trigger language plpgsql as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from attachment_texts where attachment_id = new.id;
  end if;
  return null;
end $$;
create trigger attachment_text_gone after update of deleted_at on attachments
  for each row execute function attachment_text_gone();
