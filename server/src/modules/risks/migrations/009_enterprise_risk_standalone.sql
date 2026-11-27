-- E45-01: enterprise risk stands on its own, apart from security incidents.

-- A risk is restricted one by one (it was a restricted type as a whole). Risks restricted this way
-- need `security.view` as well as `risks.view`; the others need `risks.view` only. Cybersecurity
-- risks (and risks with no category, which were scored as cyber risks) stay restricted, so nobody
-- sees a cyber risk after the upgrade that could not see it before; an administrator can lift the
-- flag on any risk.
alter table risks add column if not exists restricted boolean not null default false;
update risks set restricted = true where coalesce(category, 'cyber') = 'cyber';
create index if not exists risks_restricted_ix on risks (restricted) where restricted;

-- The target risk: where the treatment plan should bring the risk, and by when.
alter table risks add column if not exists target_likelihood int;
alter table risks add column if not exists target_impact int;
alter table risks add column if not exists target_rating text;
alter table risks add column if not exists target_score int;
alter table risks add column if not exists target_on date;

-- Key risk indicators take their restriction from their risk (an indicator with no risk is not restricted).
alter table key_risk_indicators add column if not exists restricted boolean not null default false;
update key_risk_indicators k set restricted = true
  where exists (select 1 from risks r where r.id = k.risk_id and r.restricted);

-- The risk appetite is versioned: each change is a new version with who approved it, when, in which
-- body (for example the board or a risk committee), who recorded it and why. Earlier versions are kept.
alter table risk_appetite add column if not exists approval_body text;
alter table risk_appetite add column if not exists version int not null default 1;
alter table risk_appetite add column if not exists reason text;

create table if not exists risk_appetite_versions (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  version int not null,
  statement text,
  max_rating text,
  max_score int,
  approved_on date,
  approved_by_name text,
  approval_body text,
  reference text,
  removed boolean not null default false,
  reason text,
  recorded_at timestamptz not null default now(),
  recorded_by uuid,
  unique (category, version)
);

-- The appetite in force before this version becomes version 1 of each category.
insert into risk_appetite_versions (category, version, statement, max_rating, max_score, approved_on, approved_by_name, reference, reason, recorded_at, recorded_by)
  select a.category, 1, a.statement, a.max_rating, a.max_score, a.approved_on, a.approved_by_name, a.reference,
         'Recorded before appetite versions were kept', a.updated_at, a.updated_by
  from risk_appetite a
on conflict (category, version) do nothing;
