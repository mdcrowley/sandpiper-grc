# Importing and exporting

Every list of records (tickets, systems, vendors, contracts, risks and the rest) can be taken out of the application as a spreadsheet or a PDF, and filled from a CSV or Excel file. The same rules apply as when you work on screen: you only ever export what you may see, and an import creates and changes records exactly as if you had typed them in yourself.

## Exporting a list

1. Open the list and narrow it down as you like: search, **Filters**, sort order and the columns chosen under the column button.
2. Select **Export** in the toolbar and choose a format:
   - **Excel (XLSX)**: a spreadsheet with a bold, frozen header row and a filter on every column. Dates and times are real dates (in the organization's time zone), amounts carry the organization's currency, and numbers are numbers, so the spreadsheet can sort and add them up.
   - **CSV**: plain text that any program can open.
   - **PDF**: a printable table with the list's name, the time it was made, who it was made for and the filters applied, with the header row repeated on every page and page numbers. Where an administrator has set them under **Administration > Organization** (see [Administration](09-administration.md#organization)), the organization's logo is on the first page and its name and address are in the footer of every page. A PDF holds at most 12 columns: with more chosen, the export is refused and asks you to choose fewer or to use Excel or CSV. It prints at most 2,000 rows, fewer when it has many columns (for example 1,333 with 12 columns); a note under the table says when rows were left out. Use Excel or CSV for more.

The export holds every record that matches the search and filters (not just the page on screen), in the order on screen, with the columns on screen, up to 50,000 rows. A longer list stops at 50,000: the file then says so in a line under the table ("Only the first 50,000 rows were exported"), and the audit log records it. Narrow the list with filters and export the rest separately. It needs the export permission for that kind of record (for example **Export** on **Tickets**). Every export is recorded in the audit log.

**Restricted records.** People without security access never receive restricted records in any export. When an export does contain restricted records, it says so: a "Restricted export by … at …" line under the table in Excel and CSV, and the same line at the top of every PDF page with a large faint "RESTRICTED" across it. Do not pass such a file to anyone who may not see those records.

**Accessible PDFs.** Every PDF is tagged for screen readers and meets the PDF/UA standard: see [Accessible PDFs](15-dashboards-and-reports.md#accessible-pdfs).

**Characters in PDFs.** Western European letters print in the application's own font, embedded in the file. Other scripts (for example Greek, Cyrillic, Hebrew, Arabic or Chinese) print with a font the server finds on its machine, and right-to-left text is put in reading order. A character that no available font has prints as `?`; your administrator can name extra fonts (see [Operations](../operations.md#fonts-for-pdf-exports)). Excel and CSV always keep every character.

## A record as a PDF

On a record's page, **PDF** among the buttons at the top downloads a fact sheet: the record's details, its custom fields and tags, and its recent history. It needs the export permission for that kind of record, is recorded in the audit log, and is watermarked when the record is restricted.

## Reports, dashboards and packs

Reports, dashboards and report packs have their own **Export** or **Download** menus with PDF, Excel and print-ready versions. See [Dashboards and reports](15-dashboards-and-reports.md).

## Importing records

People who may create (or change) a kind of record see **Import** in the list's toolbar. The address of the list with `?import=1` added opens the same screen.

### 1. Choose a file

Drop a file on the box or select it to browse. CSV and Excel (`.xlsx`) files are accepted, up to 5 MB and 5,000 rows. The first row with anything in it holds the column names; empty rows are ignored. A CSV may use commas, semicolons, tabs or vertical bars between values. It should be UTF-8 (in Excel: **Save As > CSV UTF-8**). A file that is not UTF-8, such as Excel's older "CSV (Comma delimited)" on Windows, is read as Windows-1252 and a warning says so: check that accented letters look right in the sample and in the check before importing. Older Excel files (`.xls`) cannot be read: save them as `.xlsx` or CSV first.

For a workbook with more than one sheet, choose the **Sheet**. Typed cells are read as they are: dates as dates, numbers as numbers, yes/no as yes/no. A formula gives the value the spreadsheet last worked out. In every CSV file the application makes, the import template included, a cell that a spreadsheet program could read as a formula (starting with `=`, `+`, `-` or `@`, also after spaces or in full-width form) gets a leading apostrophe.

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

**Check the file** goes through every row without keeping anything and shows how many rows would be created, updated, skipped, or have problems. **Rows** lists each skipped row and each problem (choose **All rows** to see the rest), by the row number in the file.

The check really saves every row, exactly as the import would, and then undoes all of it: nothing is kept, recorded in the history or the audit log, or sent to webhooks, notifications or email. So it applies every rule that saving applies: required fields and allowed values, the rules of that kind of record (for example a ticket that is closed needs a resolution code, or a change that is no longer a draft cannot change its type), rules checked only once a record is saved, the database's own rules (such as a value that must be unique), and, for a record that takes its restriction from another one, that you can see that other record. Later rows see earlier ones, so a file that repeats a unique value is caught too. A row that passes the check is saved by the import; the one exception is something that changes between the check and the import, such as another person editing the same record in between. While the check runs, other work on the embedded database waits for it (a few seconds for a large file).

Values are read like this:

- **Lists** (status, priority and so on): the value or its label, in any capitals.
- **People**: user name, email address or name. A name that two people share matches neither.
- **Records** (a system, a vendor, a site...): the reference or the title, among the records you can see.
- **Dates**: `2026-03-14`, `2026/3/14`, `14 Mar 2026` or `3/14/2026` (month first, unless the first number cannot be a month, as in `14/3/2026`). Dates and times are read in the organization's time zone.
- **Numbers and amounts**: thousands separators, a percent sign, brackets for a negative amount, and the organization's currency symbol or code are accepted.
- **Yes/no**: yes, no, true, false, y, n, 1, 0; an `x` (a common check mark in spreadsheets) also counts as yes.

**Values that matched nothing** lists every list value, person or record name in the file that could not be matched. Choose what each one stands for, then select **Check again**.

### 4. Import

**Import** (with the number of rows) creates and updates the rows that passed the check. Rows with problems are left out. Each record goes through the same checks and automatic steps as one made by hand, and its history shows who imported it. The import as a whole is also recorded in the audit log, and appears under **Past imports**.

Restricted kinds of record need security access to import, as they do to create by hand.

The asset import under **Inventory** keeps its own screen with the asset-specific checks (see [Inventory](03-inventory.md)); the generic **Import** works for assets too. Training completions ([Import completions](12-training-and-exercises.md#import-completions)) and vulnerability scan results ([Import findings](13-vulnerabilities.md#import-findings)) also have imports of their own.

## Importing a document package

*Document controllers (people who may administer documents).* A set of controlled documents with their older versions can be loaded in one go from a `.zip` file under **Documents > Import**. The archive holds the files (in any folders) and a file named `manifest.csv` at its top, with one row per **version**:

| Column | Meaning |
|---|---|
| `doc_number` | The document's controlled number, for example `SOP-IT-014`. Rows with the same number are versions of one document. Without a number, rows are grouped by title and the document is numbered by the usual pattern |
| `title`, `document_type`, `department`, `owner`, `parent_number` | The document's title, type (value or label, for example `sop` or `Standard operating procedure`), owning department (name), owner (user name, email or full name) and the number of the document it sits under. The newest row that gives a value wins |
| `access`, `access_departments`, `access_roles` | Who may read it: `organization` (everyone) or `restricted`, and the departments and roles (separated by `;`) that may read a restricted one |
| `version`, `version_label` | The version number (1, 2, 3) and the organization's own label, for example `Rev. C` |
| `status` | `draft`, `in_review`, `approved`, `published` (or `effective`), `superseded` or `withdrawn` (or `obsolete`) |
| `approved_on`, `effective_on`, `superseded_on`, `withdrawn_on` | Dates, as `YYYY-MM-DD` (month/day/year is read too) |
| `approved_by_name`, `approval_body`, `approval_reference`, `change_summary` | Who approved it, the board or committee that adopted it and its resolution number, and what changed |
| `file` | The version's file in the archive: its path, or just its name when that is unique |

1. Upload the `.zip` and select **Check** (a dry run). Every row is checked: the manifest values, that the file is there, that the owner, departments, roles and parent exist, and each Word file is converted to show its warnings. Nothing is saved.
2. Read the result of each row, fix the manifest where needed, and upload it again.
3. Select **Load**. Documents are created, or updated when one with the same number already exists, and their versions are added oldest first. The page shows the progress and then the result of every row.

- **Word files** (`.docx`) become the version's text, with their pictures; the original is kept. Tracked changes are converted as they are (insertions kept, deletions left out) and the row says so.
- **PDF files** are kept as the version itself, and their text is read for search. **Older Word files** (`.doc`) and other types are kept as the original only, with the note "Could not convert" (save them as `.docx` to convert them).
- Office lock files (names starting with `~$`), thumbnail caches (`Thumbs.db`, `.DS_Store`, `desktop.ini`) and `__MACOSX` folders are skipped and counted.
- The original statuses and dates are kept only while [data load mode](09-administration.md#data-load-mode) is on. Without it, documents are created and each document gets its first version as a draft; a row asking for a status says it was saved as a draft, and a second version of the same document is refused until the first is finished. In data load mode nothing is sent (no acknowledgment requests or notifications) and every document loaded is listed under **Administration > Data loads**, where the load can be undone.
- Every row is saved as you, through the same checks as a document made by hand, so you can load only into documents you may read. Starting and finishing an import are recorded in the audit log. An import cut short by a restart of the server is marked as failed; running it again updates the documents already loaded but adds their versions again.
- An AI assistant can load the same kind of package without a manifest ([AI assistants and MCP](21-ai-assistants-and-mcp.md#loading-a-document-package)).
