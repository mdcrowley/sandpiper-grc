-- Funders and connected funder reviews (E45-09).
-- 1. Funders become records (`funder`, FDR- numbers) shared by awards, certifications and compliance
--    reviews. The free-text funder name stays as a copy of the funder's name (search, exports and older
--    API clients); each distinct name already typed becomes a funder.
-- 2. A compliance review names the awards it reviews, and the review it carries forward from.
-- 3. A review area names the controls, obligations and documents it relies on (other modules' records:
--    type and id, no foreign key). Evidence for areas and document requests is linked in the evidence
--    library (evidence_links, part 'area:<code>' or 'request:<id>').

create table funders (
  id uuid primary key default gen_random_uuid(),
  ref text,
  name text not null,
  vendor_id uuid,                 -- the same organization in the vendor register, when it is one
  contact_name text,
  contact_email text,
  website text,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index funders_name_ix on funders (lower(name));

alter table funding_awards add column if not exists funder_id uuid references funders(id);
alter table funding_certifications add column if not exists funder_id uuid references funders(id);
alter table compliance_reviews add column if not exists funder_id uuid references funders(id);
alter table compliance_reviews add column if not exists previous_review_id uuid references compliance_reviews(id);

with typed as (
  select btrim(funder_name) as name from funding_awards where nullif(btrim(funder_name), '') is not null
  union all select btrim(funder_name) from funding_certifications where nullif(btrim(funder_name), '') is not null
  union all select btrim(funder_name) from compliance_reviews where nullif(btrim(funder_name), '') is not null
), names as (
  select min(name) as name from typed group by lower(name)
)
insert into funders (ref, name)
select 'FDR-' || lpad((row_number() over (order by lower(name)) + coalesce((select value from counters where key = 'FDR-'), 0))::text, 5, '0'), name
from names;
insert into counters (key, value) select 'FDR-', count(*) from funders
  on conflict (key) do update set value = greatest(counters.value, excluded.value);

update funding_awards x set funder_id = f.id from funders f where x.funder_id is null and lower(btrim(x.funder_name)) = lower(f.name);
update funding_certifications x set funder_id = f.id from funders f where x.funder_id is null and lower(btrim(x.funder_name)) = lower(f.name);
update compliance_reviews x set funder_id = f.id from funders f where x.funder_id is null and lower(btrim(x.funder_name)) = lower(f.name);

create index funding_awards_funder_ix on funding_awards (funder_id);
create index compliance_reviews_funder_ix on compliance_reviews (funder_id);

create table compliance_review_awards (
  review_id uuid not null references compliance_reviews(id),
  award_id uuid not null references funding_awards(id),
  created_at timestamptz not null default now(), created_by uuid,
  primary key (review_id, award_id)
);
create index compliance_review_awards_award_ix on compliance_review_awards (award_id);

create table compliance_review_area_links (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references compliance_reviews(id),
  area_code text not null,
  record_type text not null,      -- control | obligation | policy
  record_id uuid not null,
  created_at timestamptz not null default now(), created_by uuid,
  unique (review_id, area_code, record_type, record_id)
);
