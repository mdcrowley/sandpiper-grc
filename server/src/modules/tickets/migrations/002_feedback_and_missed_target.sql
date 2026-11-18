-- E18-17: one "was this helpful" vote per person per article version.
create table knowledge_article_feedback (
  article_id uuid not null references knowledge_articles(id),
  user_id uuid not null,
  version int not null,
  helpful boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (article_id, user_id, version)
);

-- E18-16: one filterable column for "missed either target", so the dashboard tile and its list agree.
alter table tickets add column target_missed boolean
  generated always as (response_breached or resolve_breached) stored;
