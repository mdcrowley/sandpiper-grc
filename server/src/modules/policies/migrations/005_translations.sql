-- Translations (E41-07): a policy version may carry its text in another language, which staff may
-- read in the portal, on the kiosk or in the app. The version's own text stays the approved original.
create table if not exists policy_version_translations (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references policies(id),
  version_id uuid not null references policy_versions(id) on delete cascade,
  language text not null,                            -- a code of shared/i18n.ts LANGUAGES, never the original's
  title text not null,
  summary text,
  change_summary text,
  body text not null,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (version_id, language)
);
create index if not exists policy_version_translations_policy_ix on policy_version_translations (policy_id);

-- The language the person read when they acknowledged: the original's or a translation's. Empty on
-- acknowledgments recorded before translations existed, and on sign-in sheets (recorded by hand).
alter table policy_acknowledgements add column if not exists language text;
alter table policy_person_acknowledgements add column if not exists language text;
