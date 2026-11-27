# Asset tags

Asset tags keep track of **which tag is stuck on which asset, vehicle, site or system**. A tag may carry printed digits (`004521`), letters and digits (`TA-118342`), a barcode, a QR code, a Data Matrix code, or several of these at once: the application only cares about the **value** the tag carries, which it calls the **Tag number** even when it has letters. People find a tag by typing it, with a handheld barcode scanner, or by pointing the mobile app's camera at it, and then act on the thing it is stuck to: report a problem, update it, count it in an inventory check.

The parts of asset tags:

- **Tag numbers on records**: assets, vehicles, sites and systems carry their tag number, with a history when a tag is replaced.
- **Tag formats** describe what your organization's tags look like, so that a misread is refused.
- **Tag stock** records the tags you bought or printed that are not stuck on anything yet.
- **Printing** makes your own tags on sheets or label rolls.
- **Finding a tag** on the web or in the app opens its **tag card**.
- **Inventory counts** check that what the register says is at a site is really there.

The tag pages are the **Tags** tab of **Assets > Assets** (the tag settings are also **Asset tag formats** on the **Administration** page); inventory counts are its **Counts** tab. Lists and record pages work as described in [Getting started](01-getting-started.md). The application never puts a web address on a tag and never opens anything a tag holds.

## Who can do what

Asset tags have three permissions of their own:

- `tags.view`: see tag history, stock, formats and series, inventory counts and their report.
- `tags.manage`: change formats, stock and series, print tags, and attach, replace and end tags (attaching also needs edit permission on the record).
- `tags.count`: start inventory counts, count toward them, finish or cancel them and decide what to do with their differences.

**Looking up a tag needs no permission of its own**: you see the record only if you may see it anyway. The default **Asset manager** role holds all three; the **Agent** role holds `tags.view` and `tags.count`; **Administrators** hold everything. An administrator can grant them to any role under **Administration > Roles**, where the **Asset tags** row has the extra columns **Manage** and **Count** (see [Administration](09-administration.md)).

## Tag numbers on records

An asset's existing **Tag** field is its tag number (it is also the asset's reference, so an asset that has no bought tag keeps its `AST-` number). Vehicles, sites and systems have a **Tag number** field. Each of these records shows a **Tags** panel (under the summary of an asset or a site, a **Tags** tab on a vehicle or a system) with:

- the **current** tag number, how and when it was attached, and by whom;
- **earlier** tag numbers, marked replaced, void, lost or ended (people with `tags.view`);
- **Last verified**: when and at which site the record was last found in an inventory count;
- **Last seen**: when the tag was last looked up, by whom and how (people who may edit the record; see [Last seen and the lookup log](#last-seen-and-the-lookup-log));
- **Attach**, **Replace** and **End** for people who may manage tags.

**A tag number is unique across everything**: the same value cannot be on an asset and a vehicle at once. Tag numbers are compared without spaces, dashes, underscores and invisible characters and without regard to capitals, so `ta-118 342`, `TA_118342` and `TA118342` are the same tag. **Leading zeros always count**: `004521` is not `4521`. One active tag per record is the rule unless an administrator allows several (a long vehicle with a tag at each end, see [Settings](#settings)).

Other identifiers stay as they are (serial number, fleet number, registration, a system's reference) and can be found the same way, but they are not tag numbers.

## Tag formats

Open **Assets > Assets** and the **Tags** tab; the tag pages have their own tabs: **Formats**, **Stock**, **Series**, **Print tags** and **Settings**. On **Formats**, select **New format** to describe one. Tag formats are optional, and none is supplied: they matter most for printed text read by the app's camera, which can misread a character. A format says:

| Setting | Example |
|---|---|
| **Characters** | Digits only, letters and digits, or a pattern (for advanced use) |
| **Prefix** (optional) | `TA-` |
| **Length** of the part after the prefix, check character included (exact, or a range) | 6 |
| **Check character** | None, mod 10 (Luhn, as many bought tags have), mod 11 (the last character may be `X`), or mod 36 |
| **How the tag carries it** | Any, text only, a barcode or 2D code only, or both |
| **Part of a code that is the value** (optional) | A pattern with one marked part, for codes that hold more than the value |
| **Record types** (optional) | Assets only, for example; empty means every kind |

Use **Try a value** to see whether, and why not, a value matches each format: "The check digit does not match", "Too short", and so on. Patterns are limited to a safe subset (no alternatives or look-arounds, at most 120 characters) so that a pattern can never slow the server down; write them in capitals without dashes or spaces, because they are matched against the compared form.

Once any format exists, a value typed on a record or entered with a handheld scanner must match an active format for that kind of record; values read by the app's camera are checked as the camera reads them. Without any format, a barcode or 2D code read by the app is accepted as it is, and printed text read by the camera is only offered for the person to confirm. With formats, a value whose check character does not match is treated as a misread and refused before anything is looked up.

## Tag stock

Open the **Tags** tab of **Assets > Assets**, then **Stock**, and select **Register tags**. Stock records tags your organization owns but has not stuck on anything yet, so that a tag that is simply not attached yet is told apart from a misread:

- **A range of bought tags**: "We received tags 010000 to 010999". Enter the prefix, the number of digits and the first and last number, an optional format, a supplier note and the date received. The range is stored as a range; values are not created one by one.
- **A list of values** for bought tags that are not sequential, imported from a text or CSV file (one value per line, at most 100,000).

In a range, numbers are padded with leading zeros to the number of digits you give, so "TB-010000 to TB-010999" covers `TB-010000`, `TB-010001` and so on. A value that was replaced on a record counts as void in its range.
- **Printed tags** are added to stock by themselves when you print new values from a series (see [Printing your own tags](#printing-your-own-tags)).

A range or list that overlaps existing stock, or a value already on a record, is refused, with the clashing values. Each range shows how many of its tags are **attached**, **available**, **void** and **lost**. Open a range to see its values; choose values that were never attached and mark them **void** (damaged, never used) or **lost**, with a reason, or make them available again. Attaching a value takes it out of the available stock.

## Printing your own tags

Open the **Tags** tab of **Assets > Assets**, then **Series**, and select **Add series** to set up a **series** for tags you print yourself: a name, an optional format, a prefix, the number of digits and the next number. Taking numbers from a series is safe when two people print at once: they never get the same numbers.

Open the **Tags** tab of **Assets > Assets**, then **Print tags** (needs `tags.manage`):

1. Choose what to print: **new tags** from a series and how many, **existing values** (a list), or the tags of records chosen on a list (select rows on the assets, systems or vehicles list and use **Print tags** in the bar that appears).
2. Choose the **layout**: a **sheet** for office printers (presets for common Letter and A4 label sheets, described by their dimensions, or your own rows, columns, margins and gaps) with **Start at label** for a partly used sheet, or a **roll** for label printers (one label per page at the label's exact size). Print an **alignment test page** first on a new sheet type.
3. Choose what each label shows: the value in large type, and optionally a code holding the same value (**Code 128** barcode, **QR code** or **Data Matrix** for small tags; text and a code are the default, so a tag can be read by the camera, a handheld scanner or a person), a line above (for example "Property of" and your organization's name) and the organization's logo.
4. Choose **PDF**, or **ZPL** for thermal label printers (roll layouts, the same fields and sizes), with the printer's resolution (203, 300 or 600 dpi).

The preview shows one label at its real proportions as you change these. Print the alignment test page on plain paper at **actual size** (not "fit to page"), hold it over a sheet of labels against the light, and check the 100 mm rule on it measures 100 mm: if not, the printer is scaling the page. Capital letters are never printed smaller than the minimum text height (5 mm by default, 3 to 25 mm); if a value would not fit legibly on the label, the preview says why and nothing is taken from the series: choose a larger label, a 2D code, or text only. A PNG logo also prints on ZPL labels; a JPEG logo prints on PDF labels only.

At most 1,000 labels are made at once unless an administrator changes the limit. New values printed from a series are registered as stock. Every print is recorded in the audit log (who printed which values). A code on a label holds only the value, never an address.

## Choosing tags that read well

Whether you buy tags or print them, the camera and the people reading them work best with:

- **A plain typeface** in which `0` and `O`, `1` and `I` look different, and text at least 5 mm high (larger for tags read from a distance).
- **High contrast**: dark print on a light, matte background. Gloss and metal reflect light; avoid printing over a logo or a pattern.
- **A code as well as text**. A barcode or 2D code is read exactly; printed text can be misread. Data Matrix and QR codes fit small tags; Code 128 suits long, narrow tags. Leave a clear margin (quiet zone) around a code.
- **A check character** (mod 10 is common on bought tags) and a fixed **prefix and length**, entered as a tag format, so a misread is caught.
- **Durable material** for where the tag goes: polyester or anodized aluminum outdoors and on vehicles, tamper-evident labels where that matters. Put the tag where it can be photographed without moving the equipment.

## Finding a tag on the web

Type or scan a tag number in either place:

- the **Find by tag number** box at the top of the **Assets**, **Sites**, **Systems** and **Vehicles** lists;
- the **global search** (Ctrl+K), which offers "Find tag …" for anything that looks like a tag number.

A **handheld scanner** in keyboard mode works in both: it types the value it read and presses Enter. The **tag card** page then says what the number is:

| You see | Because |
|---|---|
| The record's tag card | The number is on that record now |
| The record, with "This tag was replaced by …" | It is an earlier number of that record: remove the old tag |
| "Tag … is not attached yet", with **Attach** | It is in your tag stock |
| "Tag … is not in your tag stock", with **Attach** | It matches a tag format but was never registered (a bought range not entered yet, for example) |
| One or more records found by another identifier | It is a serial number, fleet number or similar |
| "Nothing found for …" | Nothing you may see carries it |

"Nothing found" is the same whether the number does not exist, is on a record you may not see, or is on a record in a switched-off part of the application (administrators are told when the area is off).

## Finding a tag with the app

In the mobile app, open the **Tag** tab and point the camera at the tag. The app reads any barcode or 2D code and the printed text on the phone, works out the value (most codes are exact; Code 39, Codabar and ITF codes, which carry no check character, are read twice or confirmed by the printed text; text is checked against your tag formats and their check character, and without a format the app asks you to confirm), and opens the tag card. With several tags in view it lists them. The picture never leaves the phone unless you attach it to the record. You can also type the number. The app itself, and how to install it, are described in [The mobile app](39-mobile-app.md).

## The tag card

The tag card shows the record's kind, name, tag number, status, photo, site and location, owner or assignee and a few facts (for an asset its type, make, model and condition; for a vehicle its fleet number, mode and odometer), then recent activity: open tickets, the last inspection and condition assessment, recent changes. Below are the **actions you may take**, worked out by the server from your permissions, the parts that are switched on, the record's status and any legal hold:

- **Report a problem**: a new ticket with the record filled in as the affected asset, system or site (the portal form for requesters), with photos.
- **Report a hazard or close call**: a safety report at the record's site, with the record linked.
- **Edit** and **Quick updates**: change the status, location, assignee or custodian in one step; the change is checked and recorded like any edit.
- **Add photo** or **Add note**; one image attachment can be marked as the record's photo.
- **Record condition** and **Start inspection**, when those parts are on.
- **Count it**, when an inventory count you may count toward expects the record.
- **Replace tag**, for people who may manage tags.
- **Open full record**.

A record under a legal hold shows its hold, and actions that would change it are left out.

## Attaching, replacing and ending tags

Attaching needs `tags.manage` and edit permission on the record:

- **Attach** from the record's **Tags** panel (type or scan the value), or from the tag card of a value in stock or unknown (choose the record, or create a new one).
- **Replace** records a new value for a damaged or lost tag: the old value is marked **replaced** and points at the new one, so finding the old tag still leads to the record, with a notice that it should be removed.
- **End** a value as **void** (damaged), **lost** or **ended** (removed), with a reason.

Editing the record's **Tag number** field directly (on its edit form, in an import or a bulk edit) needs only edit permission on the record, and works like Attach or Replace.

A value already on another record is refused ("Tag … is already in use"), the same whether or not you may see the other record; when two people attach the same value at once, one of them wins. A record under a legal hold cannot have its tag ended or moved. Anonymizing or removing a record at the end of its retention period ends its tags. Every change is in the audit log and the record's history. In the audit log, tag changes are named `tag.attach`, `tag.replace` and `tag.end`; work on formats, stock, series and layouts `tag.format.*`, `tag.range.*`, `tag.series.*` and `tag.layout.*`; printing `tag.print`; a photo taken for a record `tag.photo`; and a finished count `inventory_count.finish`.

## Inventory counts

A count checks that what the register says is at a site is really there. Open **Assets > Assets** and the **Counts** tab.

### Starting a count

Select **Start a count** (or **Create > Inventory count**; needs `tags.count`), fill in the form and select **Start the count**:

1. Choose the **Site**.
2. Optionally enter a **Room or area**: then only records whose **location** contains that text are expected (only assets have a location, so vehicles and the site itself are left out of such a count).
3. Optionally choose **What to count**: assets, sites, vehicles. Choose none to count every kind kept at a site.
4. Optionally give a **Title**; by default it is the site, the area and today's date.

When the count starts, the **expected list** is fixed: every record registered at the site (assets whose site is it, vehicles whose depot or garage is it, and the site itself), except retired and disposed ones. What is added to the site afterward is not expected by this count, and what a count covers cannot be changed later: start a new count instead. Systems have no site, so they are not counted.

### Counting

Open the count. While it is open, the **Tag number** box in the **Count** card takes one tag number after another: type it, or scan it with a handheld scanner, and press Enter (or select **Found**) (the box keeps the focus, so you can scan a shelf in a row). Each answer says what happened:

- **Found**: the record was expected here.
- **Unexpected**: the record is registered somewhere else; it is added to the count as unexpected.
- **Already found**: someone (perhaps you) counted it already. Finding twice is harmless.
- **Not found**: nothing you may see carries that number, or it is a kind of record the count does not cover.

A number is matched like a lookup: its current tag, an earlier (replaced) tag, or another identifier such as a serial number. On the **Items** tab, **Mark found** counts a record whose tag cannot be read. Several people can count the same count at once, on the web and in the app (whose camera has a counting mode that adds each new tag it reads, and which counts with no signal too: finds are kept on the phone and sent once when there is a connection; see [The mobile app](39-mobile-app.md#field-work-inspections-condition-and-counts)); the page refreshes every few seconds. The bar and the tiles show **Expected**, **Found**, **Still to find**, **Missing** and **Unexpected**.

Every record found gets its **last verified** date and place (the count's site), shown in its Tags panel.

### Finishing and the differences

Select **Finish** when you are done: what was not found is marked **missing**, and nobody can count toward the count anymore. (**Cancel the count** closes it without marking anything missing; what was found keeps its last verified date.)

Then, on the **Items** tab, choose items and decide:

- **Move here** (unexpected records): the record's site (or depot) becomes the count's site, and its location the count's area. It is an edit of the record, so you need edit permission on it.
- **Mark missing** (missing records): an asset's or vehicle's status becomes **Missing**.
- **Leave as it is**: the decision is recorded and nothing is changed.

**Raise a ticket** or **Raise an action** turns the **discrepancy summary** (what was found, what is missing, what was out of place, and what was decided) into a ticket linked to the count, or an action whose source is the count ("Inventory count"). This needs permission to create tickets or actions.

A count is a record like any other: it has **Activity** (comments), **Attachments**, **Related** records and **History** (who started, counted, finished and decided).

### The count report

Select **Report** on the **Inventory counts** list. Choose **Verified within** (30 days to 2 years):

- **Open**, **finished** and **canceled** counts.
- **Coverage by site**: for each site, the records kept there, how many were verified in a count within that time, the share, the last finished count and the open counts. These figures count every record, whoever is looking.
- **Not verified**: the records you may see that were never found in a count, or not within that time, never verified first (the first 200, with the total). Choose a **Site** to see one site's.

## Last seen and the lookup log

When **lookup logging** is on (the default), each lookup of a tag (on the tag card page, in the app, or while counting) is logged with when, who and how (the app's camera reading a code or text, typed in the app, or the web). A record's **Last seen** shows the newest one to people who may edit the record. The log never holds the phone's location. A lookup that found nothing you may see is not tied to any record.

The log is kept for 90 days by default, then removed by a daily job; anonymizing a record at the end of its retention period, or removing it for good, removes its log entries and who last verified it.

## Settings

Under **Settings** on the tag pages (the **Tags** tab of **Assets > Assets**, or **Asset tag formats** on the **Administration** page; changing them needs `tags.manage`):

- **Allow several tags on one record**: more than one active tag on a record (off by default).
- **Keep a log of tag lookups**: the lookup log behind "Last seen" (on by default).
- **Days the lookup log is kept**: `retention.tag_lookups_days`, 90 by default.
- **Most labels one print run makes**: `tags.print_limit`, 1,000 by default.

Select **Save** to keep a change.

## Switching asset tags off

An administrator can switch **Asset tags** off under **Administration > Features** (see [Administration](09-administration.md#features)). Tag numbers on vehicles, sites and systems, the Tags panel, the Find by tag number box, tag lookups, formats, stock, printing, inventory counts and their report then disappear everywhere, and tag numbers answer as unknown. The values, stock and counts are kept and return when it is switched back on. The asset's **Tag** field stays, because it is also the asset's reference.
