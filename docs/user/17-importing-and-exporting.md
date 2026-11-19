# Importing and exporting

Every list of records (tickets, systems, vendors, contracts, risks and the rest) can be taken out of the application as a spreadsheet or a PDF, and filled from a CSV or Excel file. The same rules apply as when you work on screen: you only ever export what you may see, and an import creates and changes records exactly as if you had typed them in yourself.

## Exporting a list

1. Open the list and narrow it down as you like: search, **Filters**, sort order and the columns chosen under the column button.
2. Select **Export** in the toolbar and choose a format:
   - **Excel (XLSX)**: a spreadsheet with a bold, frozen header row and a filter on every column. Dates and times are real dates (in the organisation's time zone), amounts carry the organisation's currency, and numbers are numbers, so the spreadsheet can sort and add them up.
   - **CSV**: plain text that any program can open.
   - **PDF**: a printable table with the list's name, the time it was made, who it was made for and the filters applied, with the header row repeated on every page and page numbers. A PDF prints at most 2,000 rows; use Excel for more.

The export holds every record that matches the search and filters (not just the page on screen), in the order on screen, with the columns on screen. It needs the export permission for that kind of record (for example **Tickets: export**). Every export is recorded in the audit log.

**Restricted records.** People without security access never receive restricted records in any export. When an export does contain restricted records, it says so: a "Restricted export by … at …" line under the table in Excel and CSV, and the same line at the top of every PDF page with a large faint "RESTRICTED" across it. Do not pass such a file to anyone who may not see those records.

**Characters in PDFs.** PDFs use standard fonts that cover Western European letters. Any other character (for example Greek, Cyrillic, Arabic or Chinese text) prints as `?`. Use Excel or CSV for such text.

## A record as a PDF

On a record's page, **PDF** among the buttons at the top downloads a fact sheet: the record's details, its custom fields and tags, and its recent history. It needs the export permission for that kind of record, is recorded in the audit log, and is watermarked when the record is restricted.

## Reports, dashboards and packs

Reports, dashboards and report packs have their own **Export** or **Download** menus with PDF, Excel and print-ready versions. See [Dashboards and reports](15-dashboards-and-reports.md).

## Importing records

People who may create (or change) a kind of record see **Import** in the list's toolbar. The address of the list with `?import=1` added opens the same screen.

### 1. Choose a file

Drop a file on the box or select it to browse. CSV and Excel (`.xlsx`) files are accepted, up to 5 MB and 5,000 rows. The first row with anything in it holds the column names; empty rows are ignored. A CSV may use commas, semicolons, tabs or vertical bars between values. Older Excel files (`.xls`) cannot be read: save them as `.xlsx` or CSV first.

For a workbook with more than one sheet, choose the **Sheet**. Typed cells are read as they are: dates as dates, numbers as numbers, yes/no as yes/no. A formula gives the value the spreadsheet last worked out.

**Download a template** gives a CSV with one column per field that can be imported. An Excel export of the same list can also be imported again.

**Past imports** lists the last imports of this kind of record: when, by whom, which file and what happened.

### 2. Match columns

Each column of the file is matched to a field by its name (the field's label or its internal name). Check each one under **Fills the field**, or choose **Do not import** to leave a column out. **ID** and **Reference** can be chosen to find existing records; they are never written.

Then choose **What to do**:

- **Create new records**: every row becomes a new record. Under **Skip rows that match existing records by**, choose a field (for example the reference or the name) to skip rows that already exist, or **Do not check for duplicates**.
- **Update existing records only**: each row changes the record it matches by **Find existing records by**; rows that match nothing are skipped. Needs the edit permission.
- **Update existing records and create the rest**: needs both the create and edit permissions.

Matching ignores capital letters. A row that repeats the key of an earlier row in the same file is skipped. Empty cells leave a field as it is: an import never clears a value.

### 3. Check

**Check the file** goes through every row without saving anything and shows how many rows would be created, updated, skipped, or have problems. **Rows** lists each skipped row and each problem (choose **All rows** to see the rest), by the row number in the file.

Values are read like this:

- **Lists** (status, priority and so on): the value or its label, in any capitals.
- **People**: user name, email address or name. A name that two people share matches neither.
- **Records** (a system, a vendor, a site...): the reference or the title, among the records you can see.
- **Dates**: `2026-03-14`, `2026/3/14`, `14 Mar 2026` or `3/14/2026` (month first, unless the first number cannot be a month, as in `14/3/2026`). Dates and times are read in the organisation's time zone.
- **Numbers and amounts**: thousands separators, a percent sign, brackets for a negative amount, and the organisation's currency symbol or code are accepted.
- **Yes/no**: yes, no, true, false, y, n, 1, 0.

**Values that matched nothing** lists every list value, person or record name in the file that could not be matched. Choose what each one stands for, then select **Check again**.

### 4. Import

**Import** (with the number of rows) creates and updates the rows that passed the check. Rows with problems are left out. Each record goes through the same checks and automatic steps as one made by hand, and its history shows who imported it. The import as a whole is also recorded in the audit log, and appears under **Past imports**.

Restricted kinds of record need security access to import, as they do to create by hand.

The asset import under **Inventory** keeps its own screen with the asset-specific checks (see [Inventory](03-inventory.md)); the generic **Import** works for assets too.
