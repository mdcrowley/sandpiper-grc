# Lifecycles: allowed status changes and required fields

Most kinds of records have a status: a ticket is **New**, **In progress** or **Resolved**, a hazard is **Identified**, **Being mitigated** or **Closed**. A **lifecycle** says, for one kind of record, which status changes are allowed, which fields must be filled in before a record may have a status, and who may change a record to it. An administrator sets these under **Administration > Lifecycles**, without any change to the application.

Out of the box every change is allowed and nothing extra is required, exactly as before lifecycles existed. The application's own rules (for example "a ticket needs a resolution code to be resolved") always apply as well; see [Rules set by the application](#rules-set-by-the-application).

## What people see

When you edit a record whose kind has a lifecycle:

- The **Status** drop-down offers only the statuses the record may change to from the one it has now (and those you may set). A new record offers only the statuses it may start with.
- Fields the chosen status needs are marked as required (with an asterisk). If you save without them, the form says which field is missing, beside the field.
- A change that is not allowed is refused with a message beside the status, for example *Status cannot move from "Identified" to "Closed". It may move to "Being mitigated", "Controlled".*

The same rules apply however a record is saved: the forms, bulk edit in a list, an import from a spreadsheet, the API and AI assistants. A row of an import that breaks a rule is reported with the reason and not saved. Work the application does by itself (scheduled checks, sample data) follows only the application's own rules.

## Setting up a lifecycle (administrators)

Open **Administration > Lifecycles**. The left-hand list shows every kind of record with a status, and for each one whether it uses the defaults (**Every change allowed**), has been **Changed**, or is **Set by the application**. Kinds of records in a part of the application that is switched off under Administration > Features are not listed.

Select a kind of record. The page shows:

- **Moves between statuses**: a picture of the lifecycle. The first box is a new record and the statuses it may start with; then each status, in the order of its list, with where it may go next, the fields it needs and who may set it. A status with nowhere to go is shown as **Final**.
- **Allowed changes**: a table with the current status in each row and the new status in each column. Tick a box to allow that change; clear it to stop it. The first row, **New record**, says which statuses a record may be created with. If a status can no longer be reached by any route from a new record, the page warns you (records that already have it keep it).
- **Required fields and who may set each status**: for each status,
  - **Fields required**: fields that must be filled in before a record may have this status, including your custom fields. They are checked when a record moves to the status (or is created with it), and a record that has the status cannot have one of them emptied. Fields the application fills in by itself are not offered.
  - **Permission needed** and **Or one of these roles**: who may change a record to this status. A person needs the permission *or* one of the roles. Leave both empty to let anyone who may edit the record do it.

Select **Save lifecycle**. **Discard changes** puts back what was saved. Every save is recorded in the audit log (action `lifecycle.update`, with the rules before and after).

### Restoring the defaults

**Restore defaults** removes the rules of that kind of record: every change is allowed again and nothing extra is required. It is recorded in the audit log (`lifecycle.restore`).

### Adding or retiring a status

The statuses themselves are edited under **Administration > Lists** (the page links to the right list).

- A status **added** to the list is allowed from and to every other status until you change it. The Lifecycles list shows how many statuses are **new** since the rules were saved, and the page names them, so you can set their changes and save.
- A status **retired** from the list breaks nothing: records that still have it can be edited and changed to any status, and rules that mention it are no longer used or shown.

## Rules set by the application

Some kinds of records have rules written into the application, for reasons the lifecycle table cannot express: an incident's notification clocks, a change's approvals, a project's gates. The page lists them under **Set by the application** for each kind of record they apply to. Your rules **add** to them and can never allow what they refuse. For example:

- **Tickets**: a resolved status, and a closed one other than Canceled, needs a resolution code; while a catalog request waits for approval only some statuses can be chosen.
- **Assets**: Disposed needs the disposal approval.
- **Risks**: Accepted needs a current risk acceptance.
- **Security incidents**: each status has a stage, which records its time and starts the notification clocks.
- **Vulnerabilities**, **policy exceptions**, **notification tasks**, **vehicles** and **safety events** have their own conditions for some statuses.

For **changes** and **policies** only the application sets the status (through a change's own steps, and through a policy's versions), so their lifecycle is shown for reference and cannot be edited here. For **projects** the page is about the project's **Status** (Active, On hold and so on); its stage moves only through gate decisions.
