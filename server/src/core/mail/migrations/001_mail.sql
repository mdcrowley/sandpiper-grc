-- Outbound email (E14-04). Applied under the scope "core.mail".

-- One row: how mail leaves the application. Off until an administrator switches it on.
create table mail_config (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  provider text not null default 'smtp',
  host text not null default '',
  port int not null default 587,
  -- none: plain connection (STARTTLS is not attempted); starttls: upgrade required; tls: TLS from the start (usually port 465)
  tls_mode text not null default 'starttls',
  username text not null default '',
  -- Encrypted with the installation's secret key (core/secretbox.ts), context "mail:smtp".
  password_sealed text,
  from_address text not null default '',
  from_name text not null default '',
  reply_to text not null default '',
  -- The address people use to reach the application, for links in messages (https://grc.example.org).
  base_url text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into mail_config (id) values (1);

-- Message templates. Defaults are written by the application; an administrator's edit sets
-- `customised` and is never overwritten. Placeholders look like {{title}}.
create table mail_templates (
  key text primary key,
  name text not null,
  description text not null default '',
  subject text not null,
  text_body text not null,
  html_body text not null default '',
  customised boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Every message the application tried to send.
create table mail_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  job_id uuid,
  template text,
  -- Who asked: test, notification, digest, setup_link, reset_link, or a module key.
  purpose text not null default 'other',
  user_id uuid,
  to_address text not null,
  subject text not null default '',
  -- queued, sent, failed (will retry), dead (gave up), skipped (nothing to send)
  status text not null default 'queued',
  attempts int not null default 0,
  error text,
  provider text,
  message_id text,
  sent_at timestamptz
);
create index mail_log_recent_ix on mail_log (created_at desc);
create index mail_log_job_ix on mail_log (job_id);
