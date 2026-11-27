-- Document control (E43): the policies register becomes the register of every controlled document.
-- Numbering, hierarchy, owning department, controlled distribution (who may read), review cycle,
-- obsolete handling, external-document details and the published text for search.
alter table policies add column if not exists doc_number text;
alter table policies add column if not exists parent_id uuid;
alter table policies add column if not exists owning_department_id uuid;
-- Who may read: 'organization' (every signed-in person) or 'restricted' (only the readers listed).
alter table policies add column if not exists access text not null default 'organization';
alter table policies add column if not exists access_departments jsonb not null default '[]';
alter table policies add column if not exists access_roles jsonb not null default '[]';
alter table policies add column if not exists access_groups jsonb not null default '[]';
alter table policies add column if not exists access_users jsonb not null default '[]';
alter table policies add column if not exists review_months int;
alter table policies add column if not exists last_reviewed_on date;
alter table policies add column if not exists retired_on date;
alter table policies add column if not exists retire_reason text;
alter table policies add column if not exists replaced_by_id uuid;
alter table policies add column if not exists ack_required boolean not null default false;
alter table policies add column if not exists publisher text;
alter table policies add column if not exists edition text;
alter table policies add column if not exists published_on date;
alter table policies add column if not exists source_url text;
alter table policies add column if not exists license_note text;
alter table policies add column if not exists framework_id uuid;
alter table policies add column if not exists expires_on date;
-- The published version's plain text (Markdown stripped, or a PDF's extracted text), for search only.
alter table policies add column if not exists search_text text;

-- Existing documents keep behaving as before: readable by everyone who could read them, and still
-- asking their audience to acknowledge.
update policies set ack_required = true
 where audience_everyone or jsonb_array_length(audience_roles) > 0 or jsonb_array_length(audience_departments) > 0
    or jsonb_array_length(audience_positions) > 0;
-- Retired documents take their retirement date from their last change.
update policies set retired_on = updated_at::date where status = 'retired' and retired_on is null;

create unique index if not exists policies_doc_number_ux on policies (lower(doc_number)) where deleted_at is null and doc_number is not null;
create index if not exists policies_parent_ix on policies (parent_id);
create index if not exists policies_owning_department_ix on policies (owning_department_id);
create index if not exists policies_access_ix on policies (access);
create index if not exists policies_access_users_ix on policies using gin (access_users);
create index if not exists policies_access_roles_ix on policies using gin (access_roles);
create index if not exists policies_access_departments_ix on policies using gin (access_departments);
create index if not exists policies_access_groups_ix on policies using gin (access_groups);
