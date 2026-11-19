-- E08-14: an acceptance can be withdrawn. The row is kept; these columns say when, by whom and why.
alter table risk_acceptances add column revoked_on date;
alter table risk_acceptances add column revoked_by uuid;
alter table risk_acceptances add column revoked_reason text;
-- E08-15: when the owner was told that the acceptance is close to expiry (told once).
alter table risk_acceptances add column expiry_reminded_at timestamptz;

-- E08-17: completed reviews. Each keeps the ratings as they stood, so a report can show movement.
alter table risks add column last_reviewed_on date;
alter table risks add column review_reminded_for date;   -- the review date the owner was last reminded about
create table risk_reviews (
  id uuid primary key default gen_random_uuid(),
  risk_id uuid not null references risks(id),
  reviewed_on date not null,
  note text,
  next_review_on date,
  inherent_rating text,
  inherent_score int,
  residual_rating text,
  residual_score int,
  summary_level text,
  status text,
  created_at timestamptz not null default now(), created_by uuid
);
create index risk_reviews_risk_ix on risk_reviews (risk_id, reviewed_on desc, created_at desc);

-- E08-16: one restricted action shared deliberately with one person who lacks security.view.
create table action_shares (
  action_id uuid not null references actions(id),
  user_id uuid not null,
  created_at timestamptz not null default now(), created_by uuid,
  primary key (action_id, user_id)
);
create index action_shares_user_ix on action_shares (user_id);

-- Information-request import: the values last loaded from the file, so a re-run can tell a
-- changed file row from an edit made in the application.
alter table actions add column import_snapshot jsonb;
