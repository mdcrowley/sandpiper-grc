-- E43-14: the register of issued controlled paper copies. Each numbered copy of a version is held by a
-- person or kept at a place (a depot binder); when a later version takes effect, or the document is made
-- obsolete, copies of earlier versions are due to be recalled (My work of the document's owner).
create table if not exists document_copies (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references policies(id),
  version_id uuid references policy_versions(id) on delete cascade,
  copy_number int not null,
  holder_user_id uuid,
  holder_name text not null,
  location text,
  issued_on date not null,
  issued_by uuid,
  issued_by_name text,
  recalled_on date,
  recalled_by uuid,
  recalled_by_name text,
  recall_note text,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index if not exists document_copies_number_ux on document_copies (policy_id, copy_number) where deleted_at is null;
create index if not exists document_copies_open_ix on document_copies (policy_id) where deleted_at is null and recalled_on is null;
