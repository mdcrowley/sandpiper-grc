-- W23 F5: which translated text was read. An acknowledgment given in a translation records the
-- SHA-256 stamp of that translation's title, summary, change summary and text at the time
-- (translations.ts translationStamp); empty when the original was read, and on acknowledgments
-- recorded before this change.
alter table policy_acknowledgements add column if not exists translation_sha256 text;
alter table policy_person_acknowledgements add column if not exists translation_sha256 text;
