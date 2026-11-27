-- Document control (E43): version identity and dates, file versions, adoption records, and periodic
-- reviews beside the plans' annual reviews.
alter table policy_versions add column if not exists version_label text;
alter table policy_versions add column if not exists approval_body text;
alter table policy_versions add column if not exists approval_reference text;
alter table policy_versions add column if not exists superseded_on date;
alter table policy_versions add column if not exists withdrawn_on date;
-- markdown: the body is the text; file: the original file is the text (the body may be empty).
alter table policy_versions add column if not exists content_kind text not null default 'markdown';
alter table policy_versions add column if not exists source_attachment_id uuid;
alter table policy_versions add column if not exists rendition_attachment_id uuid;
alter table policy_versions add column if not exists conversion jsonb;
alter table policy_versions add column if not exists body_sha256 text;
-- A minor version (typo, formatting) is published without new acknowledgment requests.
alter table policy_versions add column if not exists minor boolean not null default false;
-- An approved version waiting for its future effective date; the daily job publishes it then.
alter table policy_versions add column if not exists scheduled boolean not null default false;

-- Superseded versions take the date their successor took effect.
update policy_versions v set superseded_on = (
  select min(n.effective_on) from policy_versions n where n.policy_id = v.policy_id and n.version > v.version and n.effective_on is not null)
 where v.status = 'superseded' and v.superseded_on is null;
-- At most one published version per document.
update policy_versions v set status = 'superseded'
 where v.status = 'published' and exists (
   select 1 from policy_versions n where n.policy_id = v.policy_id and n.status = 'published' and n.version > v.version);
create unique index if not exists policy_versions_one_published on policy_versions (policy_id) where status = 'published';
-- A retired document's last published version is withdrawn.
update policy_versions v set status = 'withdrawn', withdrawn_on = p.retired_on
  from policies p where p.id = v.policy_id and p.status = 'retired' and v.status = 'published';

-- Reviews: the plans' annual review (approval workflow) and the periodic review of every document.
alter table policy_plan_reviews add column if not exists kind text not null default 'plan_annual';
alter table policy_plan_reviews add column if not exists result text;            -- no_change | revise | retire
alter table policy_plan_reviews add column if not exists reviewed_by_name text;
alter table policy_plan_reviews add column if not exists reviewed_on date;
drop index if exists policy_plan_reviews_running;
create unique index if not exists policy_plan_reviews_running on policy_plan_reviews (policy_id) where outcome = 'in_review' and kind = 'plan_annual';
