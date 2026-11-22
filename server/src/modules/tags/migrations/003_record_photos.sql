-- The record's photo (E37-06): one image attachment of an asset, vehicle, site or system marked as
-- the picture shown on its tag card. One row per record; the attachment stays with the attachments
-- module (no foreign key across modules). A removed attachment simply stops being shown: readers
-- join `attachments` with `deleted_at is null`.
create table tag_record_photos (
  record_type text not null,
  record_id uuid not null,
  attachment_id uuid not null,
  set_at timestamptz not null default now(),
  set_by uuid,
  primary key (record_type, record_id)
);
create index tag_record_photos_attachment_ix on tag_record_photos (attachment_id);
