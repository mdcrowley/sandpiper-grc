# Registers

Every organization keeps lists that have no part of their own in the application: lost property found on vehicles and at stations, keys and access cards issued, visitors to a depot, hot-work permits, loaned equipment. An administrator can make each of them a **register**: a new kind of record, defined under **Administration > Registers** without any change to the application.

A register works like the built-in parts. It has a list with search, filters, saved views and exports; record pages with history, comments, related records, tags, watchers, files and a PDF fact sheet; records numbered with their own prefix (for example `LP-00001`); its own fields and statuses; imports from CSV or Excel; reports and dashboards; allowed status changes (lifecycles); approval workflows; legal holds and retention; and its records are found by the search at the top of every page and by an AI assistant connected through MCP. Lists and record pages work as described in [Getting started](01-getting-started.md).

## Opening a register

Each register has its own entry in the navigation, in the group its administrator chose (for example **Lost property** under **Service desk**), and its own entry in the **Create** menu. The **Registers** page (`/registers`) lists every register you may open, with what each is for.

You see a register only when one of your roles lets you view it, and only while it is switched on.

## Working with records

Every record of every register has these fields, and the register's own fields after them:

| Field | What it means |
|---|---|
| **Reference** | Given when the record is made: the register's prefix and the next number. |
| **Title** (or the name the administrator gave it, such as **Item** or **Key**) | What the record is. The only field every record must have. |
| **Status** | Where the record stands. A new record takes the first status of the register's list (**Open** unless the administrator changed the list). |
| **Owner** | The person looking after the record. |
| **Department** and **Site** | Where the record belongs. Roles can be limited to their members' own departments or sites (see below). |
| **Description** | Anything else worth saying. |

Use **New** on the list, or the register's entry in the **Create** menu, to add a record. Import many at once with **Import** on the list (see [Importing and exporting](17-importing-and-exporting.md)); the register's own fields appear in the import's column choices like any other field.

## Defining a register (administrators)

Open **Administration > Registers** and choose **New register**:

| Field | What it means |
|---|---|
| **Register name** | The plural name shown in the navigation and as the list's title, for example "Lost property". |
| **One record is called** | The name of one record, used in the Create menu, on record pages and in messages, for example "Lost property item". |
| **Name in addresses and permissions** | A short name in lower-case letters, numbers and underscores, made from the register name when left empty (for example `lost_property`). It is the register's address (`/registers/lost_property`) and the start of its permissions (`lost_property.view`). It cannot be changed later, and it cannot be a name the application already uses. |
| **Reference prefix** | One to eight capital letters or digits. Records are numbered with it, for example `LP-00001`. No two kinds of record share a prefix. Changing it later numbers new records only. |
| **Name of the main field** | What the title field is called, for example "Item". |
| **Menu group** | The navigation group the register sits in. |
| **Icon** | The icon beside it in the navigation. |
| **Description** | What the register is for, shown on the Registers page and under Administration > Features. |
| **Files on these records are evidence** | The record page's Attachments tab records new files as evidence, with a collection date and an optional expiry date (see [Attachments and notifications](14-attachments-and-notifications.md)). |

The register is ready at once: it appears in the navigation, the Create menu, the search, the report builder and the other administration pages. Only administrators can use it until a role is given its permissions (see below).

The register's page under Administration > Registers shows how many records it holds, lets you change everything but its name in addresses, and links to the pages below.

## Fields, statuses and lifecycle

- **Fields.** A register's own fields are [custom fields](09-administration.md#custom-fields) of its record type: choose **Add or change fields** on the register's page, which opens **Administration > Custom fields** with the register chosen. Text, long text, numbers, amounts, dates, yes or no, a choice from a list (or several), a person, or a link to another record (a vehicle, a site, a system, a record of another register). A field can be required, have help text and sit under a heading on the form.
- **Statuses.** The register's statuses are a list of their own (**Open**, **In progress** and **Closed** to start with), changed under **Administration > Lists** like any other list. New records take the first status still in use.
- **Lifecycle.** Which status changes are allowed, which fields each status needs and who may set it are chosen under **Administration > Lifecycles** (see [Lifecycles](23-lifecycles.md)). A move can also wait for an [approval workflow](22-approval-workflows.md).

## Who may use a register

Each register is a part of the application with permissions of its own: `<name>.view`, `<name>.create`, `<name>.edit`, `<name>.delete` and `<name>.export` (and `.approve` and `.administer`, which a register does not use). Only administrators hold them at first.

The **Who may use it** card on the register's page lists the roles with a check box for viewing, creating, editing, deleting and exporting; **Save permissions** changes the roles (it asks for your password again, as every change to a role does). The same permissions are in the register's row of each role under **Administration > Roles**, where a role's access to the register can also be limited to the records of its members' own departments or sites (**Which records**; see [Administration](09-administration.md#roles-and-permissions)).

Figures such as the counts on a list are the same for everyone who may open the register.

## Switching a register off

Every register has its own switch under **Administration > Features**, listed under its name. While it is off, the register disappears everywhere else: its navigation and Create entries, its pages, its records in search, links, reports, dashboards, notifications and the AI assistant, and its page under Administration > Registers. Nothing is deleted: everything returns when it is switched back on.

## Removing a register

A register that holds no records can be removed: choose **Remove register** from the **More actions** menu on its page (it asks for your password again). Its fields, its lifecycle and the roles' permissions for it are removed with it, and its name is free to use again.

A register that holds records cannot be removed: switch it off instead. Deleted records count too, because deleting a record keeps it in the database (as for every other kind of record).

## On a server with a least-privilege database account

Each register needs a small change to the database when it is defined (a view of its records) and when it is removed. When the application's database account may not change the database (see [Installation](../installation.md#a-least-privilege-database-role)), a new register is saved and listed as **Waiting for the database owner**; it comes into use when `migrate` next runs as the owner account. Removing a register is refused there: switch it off instead.

## Things to know

- A register defined while the application runs gets [approval workflows](22-approval-workflows.md) after the next restart of the server; everything else works at once.
- With more than one server process on the same database, the other processes pick up a new or changed register within a few seconds.
- The register's records are kept with every other record: backups, exports and restores carry them.
