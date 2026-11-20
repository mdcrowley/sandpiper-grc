-- Contact details for urgent alerts by text message (E09-25). Applied under the scope "core.mail".
--
-- Personal data: each person reads and changes their own; administrators read and change anyone's.
-- `mobile` is the number given to the organization's own text-message system (through the
-- text-message webhook); `sms_address` is an email-to-text address (many carriers and
-- enterprise messaging systems offer one, such as 5550100@text.example.net).
create table user_alert_contacts (
  user_id uuid primary key,
  mobile text not null default '',
  sms_address text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid
);
