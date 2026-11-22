-- Evidence by link (E36-05): a document kept in the organization's own document store is linked
-- instead of uploaded. A link is an attachments row whose storage_driver is 'link': it has an
-- address and a title, no stored bytes (size 0, no checksum), and is never fetched by the server.
-- `kind` keeps its meaning (file or evidence), so a link can be evidence with the usual dates.
alter table attachments add column link_url text;
alter table attachments add column link_title text;
-- When someone last confirmed the linked document is still there and current, and who.
alter table attachments add column last_checked_on date;
alter table attachments add column checked_by uuid;
-- The check-due date a reminder was last claimed for (claimed before sending, so it goes once).
alter table attachments add column link_reminded_for date;
create index attachments_links_ix on attachments (last_checked_on) where deleted_at is null and storage_driver = 'link';
