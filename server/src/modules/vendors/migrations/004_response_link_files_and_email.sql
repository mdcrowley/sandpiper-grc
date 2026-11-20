-- Vendor response links, continued. Files the vendor sends through the link (E06-22) are stored
-- by the attachments module, in a holding area tied to the link (record type
-- 'vendor_response_link', record id = the link), until staff take them over onto the vendor or
-- discard them. The application can email the link (E06-23): the address and the time are kept,
-- never the link itself; a reminder goes once, before the link expires, without the link.
alter table vendor_assessment_links add column emailed_to text;
alter table vendor_assessment_links add column emailed_at timestamptz;
alter table vendor_assessment_links add column reminded_at timestamptz;
