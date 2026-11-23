-- Retrying pushes that failed for a while only (E38-14, wave 15): when the next attempt for this
-- phone is due (null: none waiting) and how many retries of the current series have been made. A run
-- claims a waiting retry by clearing retry_at with a conditional update, so it is sent once.
alter table push_registrations add column retry_at timestamptz;
alter table push_registrations add column retry_attempts int not null default 0;
create index push_registrations_retry_ix on push_registrations (retry_at) where retry_at is not null;
