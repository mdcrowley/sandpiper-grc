# People and qualifications

The roster holds everyone on staff, whether or not they have an account: bus and rail operators, maintainers, dispatchers, station agents and office staff. Each person has a position, and each position lists the courses and certifications it requires. From that the application works out who is qualified now, which certifications are about to expire, and which documents each person has been asked to acknowledge. Open **People**, **Positions** and **Departments** in the **People** group. Lists and record pages work as described in [Getting started](01-getting-started.md).

The roster is always on: it is not one of the parts an administrator can switch off, because policies, committees and safety use it. Training, certifications and the qualification matrix belong to training (see [Training and exercises](12-training-and-exercises.md)), and acknowledgments to policies (see [Policies and exceptions](11-policies-and-exceptions.md#staff-on-the-roster)); when one of those is switched off, its tabs and columns on the roster go with it.

## Who can do what

| Permission | Allows |
|---|---|
| `people.view` | See the roster, positions and departments |
| `people.create`, `people.edit`, `people.delete` | Add, change and remove people, positions and departments, and import the roster; `people.delete` also merges departments |
| `people.export` | Export the roster |
| `training.view` together with `people.view` | See the qualification matrix, expiring certifications and a person's training |
| `training.edit` | Set what each position requires |

The **Training coordinator** role holds every people and training permission. **Security lead**, **Safety manager**, **Compliance officer** and **Continuity manager** can see the roster. An administrator can grant the permissions to any other role under **Administration > Roles**.

Names, employee numbers, email addresses, phone numbers, hire dates, accounts and notes on the roster are personal data. When a person's record reaches the end of its retention period and is anonymized (see [Administration](09-administration.md)), these are removed; their training, certifications and acknowledgments stay as figures but no longer name them.

## Positions

Open **People > Positions**. Each position (`POS-` numbers) has a **Name** (unique), a **Code**, a **Description**, whether it is **Safety-sensitive** (shown only while safety management is switched on), and whether it is **Active**, and its **Department**.

### What a position requires

On the position's **Requirements** tab (shown to people who can see training), select **Add requirement**:

1. Under **Kind**, choose **A certification** and the **Certification** type, or **A course** and the **Course**.
2. Leave **Mandatory** checked for something the position cannot do without. Only mandatory requirements decide whether someone is qualified.
3. Enter **Grace days** if a certification that has just expired, or a repeating course that has just fallen due, should still count for a few days.
4. Select **Add requirement**.

The **People** tab lists everyone in the position.

## Departments

Open **People > Departments**. A department has a **Name** (unique), the department it is **Part of** (so a night shift can sit under depot operations), a **Manager** and a **Description**. Its page lists its **People** and the **Departments below** it. Anyone signed in can choose a department on a record, even without access to this list.

People, positions, assets, actions, projects and business processes each point at one department. Earlier versions kept the department of assets, actions, projects and business processes as typed text; on upgrading, each name was matched to the department of that name, and a name that was not yet in the list was added to it, so every record keeps its department. The name still shows in reports and figures grouped by department, and it follows when a department is renamed.

The conversion can leave two departments for one ("IT" and "Information Technology"). Open the one to drop and select **Merge into…**, choose the department to keep, and select **Merge**: everyone and everything in it (accounts, the roster, positions and records) moves to the other department, the departments below it move under that one, and it is removed. Merging needs `people.delete` and is recorded in the audit log.

### Seeing only your own department's or site's records

An administrator can limit a role to the records of its members' own departments or sites, under **Administration > Roles > Which records** (see [Administration](09-administration.md#which-records-a-role-reaches)). A person's departments are the department on their account, their department on the roster and the departments they manage, with every department below those; their sites are their **Work site** on the roster and the sites they manage (a site's **Site manager**), with every site within those (a site's **Part of**). So set each person's department and work site on the roster, and each department's and site's manager, to give a depot manager their depot.

## The roster

Open **People > People**. The title and **New person** come first, then the tiles. They count people who are **Active** and **On leave**, how many are **With an account**, and the **Positions**. The list shows each person's reference (`PER-` numbers), name, employee number, position, department and status; more columns (account, supervisor, work site, hire date, source) are in the column chooser.

### Add a person

1. Select **New person**, or **Create** then **Person**.
2. Enter the **Full name** and, if they use one, a **Preferred name** (the kiosk shows it).
3. Enter the **Employee number** (unique on the roster), **Email** and **Phone**.
4. Choose the **Department**, **Position**, **Work site** and **Supervisor** (another person on the roster).
5. If the person can sign in, choose their **Account**. An account belongs to one person only.
6. Enter the **Hire date** and choose the **Status**: **Active**, **On leave** or **Left**.
7. Select **Create person**.

When no department is chosen the person takes their position's department. A person whose email address is the same as an account's is linked to that account by themselves.

People who leave keep their record with the status **Left**: they are no longer asked to do training or acknowledge documents, and they drop out of the qualification matrix.

### Import the roster from HR

Select **Import** on the roster and follow the import screen (see [Importing and exporting](17-importing-and-exporting.md#importing-records)). Most HR systems can export a CSV with a header row; the columns are matched to **Full name**, **Employee number**, **Email**, **Department**, **Position** and so on.

- To update people already on the roster, choose **Update existing records and create the rest** and pick **Employee number** under **Find existing records by**.
- **Department** may hold the department's name, as HR files usually do. It must be one of the organization's departments.
- **Position** and **Work site** are matched by name.

Imported people show **Imported** as their **Source**. The check before importing runs every rule above, so a duplicate employee number or an unknown department is reported before anything is saved.

### The person's page

The header shows the person's status and, when their position has requirements, whether they are **Qualified** or **Not qualified** now. Below the details:

- **Training and certifications**: the **Qualification** table (each requirement of their position with its state and the date it is in date until), their **Certifications**, and their **Training records**, including training assigned by position.
- **Acknowledgments**: the documents they were asked to acknowledge as a member of the roster, and when and how they did.

## Qualified now

A person is **qualified** when every mandatory requirement of their position is met and in date:

- a course is met by a completion (not **Did not pass**); for a course that repeats, the completion must be no older than the repeat period plus the grace days;
- a certification is met by an **Active** certification of that type that has not expired beyond the grace days.

Each requirement shows as **In date**, **Expiring** (in date but running out within 30 days), **Expired** or **Missing**.

### The qualification matrix

Open **People > Qualifications** (shown only to people who may view both training and the roster). The tiles count who is **Qualified** and **Not qualified** among the people whose position has requirements, and the certifications that have expired or expire within 90 days. Filter by **Position** or **Department**, and **Show** only people who are not qualified. Each row is a person; each column a requirement, with a dash where their position does not need it. Hover a cell for its date. People whose position has no requirements show **No requirements**.

## Certifications

Certifications (`CRT-` numbers) are recorded under **People > Certifications** or from a person's page; see [Training and exercises](12-training-and-exercises.md#qualifications-and-certifications). The certification types (for example **Driver or operator license**, **Medical fitness certificate**, **First aid**, **Track access permit**) are a list an administrator can change under **Administration > Lists** (list **Certification type**). Each type also says how many months a certification of it is valid (**Valid for (months)**: a new certification's expiry date is worked out from its issue date) and who usually issues it (**Usually issued by**: filled in when no issuer is given). Both are shown as columns on the **Lists** page and changed in the type's **Edit** dialog, with its name and color; leave **Valid for (months)** empty for a type that does not expire.

Certifications that expire within 90, 60 and 30 days, or have expired, without a renewal are reminded to the person and their supervisor once at each step. **Expiring** on the certifications list shows them all.

## Training for people without an account

- An assignment rule by **position** gives a course to everyone on the roster in that position, with or without an account (see [Training and exercises](12-training-and-exercises.md#assign-a-course)).
- To record a completion for someone on the roster, give their email address or, in an import, their employee number. The same person is never recorded twice: an account, an email address on the roster and an employee number all lead to the one person.

## Figures for other parts of the application

Two monthly figures are offered to computed safety performance indicators and key risk indicators (see [Safety management](20-safety-management.md)):

| Figure | Meaning |
|---|---|
| **Staff qualified for their position** (`training.compliance_pct`) | Of the people on the roster whose position has mandatory requirements, the percentage qualified at the end of the month |
| **Expired certifications not renewed** (`training.certifications_expired`) | Active certifications expired by the end of the month with no later one of the same type for the same person |

## Not planned: hours of service and fatigue

Hours of service and fatigue records belong in rostering and timekeeping systems and are not kept here. Whether they are managed as required can be followed as an obligation (see [Risks, actions and obligations](06-risks-actions-obligations.md)) and checked in audits.

## Sample data

With the development sample data, the roster holds 120 invented people whose names start with **[Sample]**, across eight positions (bus operator, rail operator, rolling stock maintainer, signal maintainer, supervisor, dispatcher, station agent and office staff) in invented departments. The positions have requirements, a yearly briefing course is assigned by position, about 175 certifications are recorded (some expiring or expired), and two rulebook bulletins have been acknowledged by part of the roster on sign-in sheets and the kiosk.
