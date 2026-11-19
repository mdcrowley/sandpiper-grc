-- American English: built-in list labels that still read as first installed take the American
-- spelling. Only labels nobody has changed are touched; the stored values ('cancelled',
-- 'software_licence', 'organisation', 'acknowledgement') stay as they are, because records,
-- reports and integrations refer to them.
update lookups set label = 'Canceled' where value = 'cancelled' and label = 'Cancelled';
update lookups set label = 'Software license' where value = 'software_licence' and label = 'Software licence';
update lookups set label = 'Whole organization or safety' where value = 'organisation' and label = 'Whole organisation or safety';
update lookups set label = 'Most of the organization' where value = 'most' and label = 'Most of the organisation';
update lookups set label = 'Acknowledgments' where value = 'acknowledgement' and label = 'Acknowledgements';
update lookups set label = 'Acknowledgment of approval only' where value = 'acknowledgement' and label = 'Acknowledgement of approval only';
