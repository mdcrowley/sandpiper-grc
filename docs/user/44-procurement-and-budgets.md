# Procurement and budgets

**Procurement** keeps the purchasing record of a public transit organization in one place: each **solicitation** from planning to award (the offers received, the evaluation committee and its scores, the award decision, protests and the resulting contract), the **purchase orders** that follow, with their approval and what was received, the vendors' **invoices** matched with the order and what was received, approved and paid, and the **budgets** they are charged to, as adopted and amended, showing budget against committed and spent.

Open it from **Vendors > Procurement** in the navigation. The page has the tabs **Solicitations**, **Purchase orders**, **Invoices**, **Budgets** and, for people who administer procurement, **Settings**. Lists and record pages work as described in [Getting started](01-getting-started.md).

No jurisdiction's rules are built in. The procurement methods, the dollar limit up to which each may be used, the clauses your contracts must carry and the standard evaluation criteria are your organization's own lists and settings (see [Settings](#settings)).

Vendors and contracts stay separate: procurement links to them, and an administrator can switch procurement off without touching them. If your organization does not use it, an administrator can switch **Procurement and budgets** off under **Administration > Features** (see [Administration](09-administration.md#features)). Its pages, menu entry, Overview panel, My work and calendar items then disappear everywhere. Nothing is deleted: everything returns when the part is switched back on.

## What you need

Procurement uses the **procurement** permissions:

| Permission | What it allows |
|---|---|
| `procurement.view` | Read solicitations, purchase orders and budgets, and the figures |
| `procurement.create`, `procurement.edit` | Make and change solicitations, offers, purchase orders and budgets; run evaluations (criteria and committee), record addenda, protests and receipts; enter invoices, send them for approval, record payments and void invoices. People holding `procurement.edit` are the **procurement staff**: they read offers and scores before the award |
| `procurement.approve` | Record the award; approve purchase orders and invoices when no approval workflow applies; record a budget's adoption and amendments (with `procurement.create`) |
| `procurement.delete`, `procurement.export` | Delete records; export lists |
| `procurement.administer` | Change the standard evaluation criteria and the invoice match tolerance under **Settings** |

The **Procurement officer** role (switched off as installed; an administrator enables it under **Administration > Roles**) holds all of them, with reading and changing vendors and contracts, and reading funding awards, projects, assets and documents. The **Approver** role can approve purchase orders and invoices and record awards; the **Compliance officer**, **Project manager**, **Asset manager**, **Executive viewer** and **Auditor** roles can read procurement (the auditor can also export). Use **Sync default grants** on the Roles page to give existing roles these grants.

A member of an **evaluation committee** needs no procurement role: being on the committee lets them declare conflicts of interest and score from their own page (see [Scoring as a committee member](#scoring-as-a-committee-member)).

## Solicitations

Select **Procurement**, then **New solicitation** (or **Create > Solicitation**). A solicitation (`PRC-` numbers) has:

| Field | What it holds |
|---|---|
| **Title** and **Scope of work** | What is being bought |
| **Method** | Micro-purchase, small purchase (quotes), sealed bid, competitive proposals, sole source, cooperative purchase or emergency: your organization's list |
| **Solicitation** | Request for proposals, request for quotes, invitation for bids, request for information, or no solicitation |
| **Estimated value** | The amount expected. A method with a limit cannot be used above it |
| **Independent cost estimate** and **Estimate made on** | Your own estimate, made before the offers are opened |
| **Funding source** | The funding award that pays for it, when the funding area is on (see [Funding and grants](27-funding-and-grants.md)) |
| **Requesting department** and **Buyer** | Who asked for it and who runs it. A new solicitation's buyer is the person who makes it unless you choose someone else |
| **Solicitation document** | The solicitation in the document library, when it is kept there (other files go on the **Attachments** tab) |
| **Issued on**, **Questions due**, **Offers due**, **Planned award** | The schedule. Questions cannot be due before the solicitation is issued, nor offers before questions |
| **Sole-source or emergency justification** | Why a method that needs a written justification is used |
| **Resulting contract** | The contract made from the award |
| **Status** | Planning, issued, under evaluation, awarded, closed or canceled |

A method that needs a written justification (as installed, sole source and emergency) cannot move on from **Planning** until the justification is written.

The record page has the tabs **Offers**, **Evaluation and award**, **Schedule and addenda**, **Required clauses**, **Protests**, **Purchase orders**, **Activity**, **Attachments**, **Related** and **History**.

## Offers

On the **Offers** tab, select **New offer** to record a bid, proposal or quote (`OFR-` numbers): the **Vendor** (a vendor record) or, for a bidder that is not one, the **Bidder** name; when it was **Received**; the **Price offered**; and its **Status** (received, responsive, not responsive, withdrawn, awarded, not selected). Attach the proposal itself to the offer's page. An offer received after **Offers due** is marked **Late** in the ranking.

**Until the award, offers and their prices are read only by procurement staff and the evaluation committee.** Everyone else who may view procurement sees how many offers were received, but not who offered what. No more offers can be recorded once a solicitation is awarded, closed or canceled.

## Evaluation and award

The **Evaluation and award** tab holds the criteria, the committee, the ranked offers and the award.

### Criteria

For a method evaluated by scores (as installed, competitive proposals), select **Set criteria**: each criterion has a **Weight** and a **Top score** (10 unless you change it). **Use the standard criteria** starts from your organization's standard criteria (see [Settings](#settings)). Criteria cannot change once evaluators have started scoring. A method evaluated by price (sealed bid, small purchase) ranks the responsive offers from the lowest price.

### The committee

Select **Add an evaluator** to put a person on the evaluation committee as **Chair**, **Member** or **Advisor** (advisors read the offers but do not score). They are notified, and the evaluation appears in their **My work**. An evaluator who has scored stays on the committee; **Reopen** lets an evaluator change scores they have handed in.

### Scoring as a committee member

A committee member opens the evaluation from **My work** (or from **My evaluations**, at `/procurement/evaluations`):

1. They first **declare whether they have a conflict of interest**. A member who declares one is told the offers are not for them and does not see or score them; the buyer is notified.
2. They score each offer from 0 to the top score of each criterion, with a comment if they wish, and **Save for later** as often as they like.
3. When every offer is scored against every criterion, **Hand in my scores**. Handed-in scores cannot change unless the buyer reopens them.

Each member scores on their own: a member sees only their own scores. The audit log records who saved or handed in scores, never the scores themselves.

### Ranked offers

Procurement staff see the committee, each member's declaration and progress, and the **Ranked offers**: each offer's score out of 100 (for each criterion, the average of the members' scores over the top score, times the weight) and its rank. Before the award, everyone else sees only that the evaluation is in progress and how many members have handed in their scores.

### The award

Someone holding `procurement.approve` selects **Record the award**: the offer awarded, **Why this offer**, the date and the amount (the offer's price unless you give another). The solicitation becomes **Awarded**, the other offers **Not selected**, and the person who recorded it is kept. **From then on, the offers, scores and ranking are readable by everyone who may view procurement.**

### The resulting contract

Once awarded, **Resulting contract** offers **Make the contract** (a draft contract for the awarded vendor with the award amount, which needs permission to create contracts and the awarded offer to name a vendor record) or **Link an existing contract**. The solicitation names the contract, and the contract shows the solicitation under **Related** (see [Vendors and contracts](04-vendors-and-contracts.md)).

## Schedule and addenda

The **Schedule and addenda** tab shows the dates, and the **Addenda** issued after the solicitation: select **Record an addendum** with the date it was issued, what it changes and, if you wish, its document. Addenda are numbered in order.

## Required clauses

The **Required clauses** tab checks the solicitation and the resulting contract against your organization's clause template (the list **Procurement required clause**): for each clause, **Included**, **Missing** or **Not applicable**. As installed the template holds general clauses such as termination, access to records, changes, disputes, exclusion certification, conflict of interest, nondiscrimination, insurance, data protection and the terms a funding source requires; change it to your own.

## Protests

On the **Protests** tab, select **Record a protest**: who protests (and the vendor, if it is one), when it was received and the grounds. **Update** records its status and, when it is upheld or denied, the decision; who decided and when are kept. The buyer is notified of a new protest.

## Purchase orders

Select the **Purchase orders** tab, then **New purchase order** (or **Create > Purchase order**). A purchase order (`PO-` numbers) has what is ordered, the **Vendor** (or the vendor's name when it has no record), the **Order date**, the **Department**, who **Requested** it, the **Solicitation** and **Contract** it comes from, the **Budget line** its lines are charged to unless a line names another, and **Needed by**.

On the **Lines** tab, select **Add a line**: a description, the quantity, the unit price, the budget line and, if you wish, the asset bought or serviced. The order's **Total** is the sum of its lines.

The order then moves through these steps, each from a button on its page:

| Step | What happens |
|---|---|
| **Send for approval** | A draft with at least one line becomes **Awaiting approval**. If an approval workflow for purchase orders applies (see [Approval workflows](22-approval-workflows.md)), it decides; otherwise the people who hold `procurement.approve` are notified |
| **Approve** or **Reject** | Without a workflow, someone holding `procurement.approve` decides, **never the person who requested the order**. Rejecting needs a reason and returns the order to **Draft** |
| **Issue to the vendor** | An approved order becomes **Issued** |
| **Record what was received** | The quantities received of each line, the date and a note (for example the delivery slip). The order becomes **Partly received**, then **Received** when everything is in. Who received it is kept |
| **Close the order** | An issued or received order becomes **Closed**: what was not paid no longer counts as committed |
| **Cancel the order** | With a reason, while nothing has been received or invoiced; a running approval is canceled too |

The status moves only through these steps. Once an order has left **Draft**, its vendor, budget line and lines stay as approved.

The **Invoices** tab shows, for each line of the order, what was ordered, received, invoiced and paid, and the order's invoices (see [Invoices and payments](#invoices-and-payments)). The **Budget** tab shows each budget line the order is charged to: budgeted, committed, spent, this order and what is left after it, with a warning when a line would go over.

## Invoices and payments

When the vendor's invoice arrives, open the order's **Invoices** tab and select **Enter an invoice** (the order must have been issued to the vendor). An invoice (`INV-` numbers) has:

| Field | What it holds |
|---|---|
| **Invoice number** and **Invoice date** | As printed on the vendor's invoice. The same vendor's invoice number cannot be entered twice (spaces and capitals do not matter) unless the first one was voided: this is the usual way an invoice gets paid twice |
| **Received** | When the invoice reached you (today unless you say otherwise) |
| **Payment due** | When it is to be paid; approved invoices appear in the calendar on that day |
| **Lines** | What it bills against each line of the order: a **quantity** (at the order's price unless you give the price or the amount), or, for a service billed as a sum, only an **amount** |

The vendor, department and order come from the purchase order. The invoice's **Amount** is the sum of its lines.

### The three-way match

Each line is checked against the order (the price ordered) and what was received (the quantity and its value), counting what other invoices of the same order (sent for approval, approved or paid) already bill. A line **matches** when, together with those, it bills no more than was received, at no more than the order's price; otherwise the invoice shows **Does not match** with the reason, for example "Line 2: 6 invoiced, 4 received" or "price 55.00 above the order's 50.00". The match is worked out again when goods are received, and when another invoice of the order is sent for approval, returned or voided, so an invoice entered before the delivery matches once it is in.

An administrator can allow a small difference (rounding, freight) under **Settings > Invoice match**: a tolerance in percent, 0 as installed.

### Approval and payment

| Step | What happens |
|---|---|
| **Send for approval** | An entered invoice with at least one line becomes **Awaiting approval**; its lines and number then stay as entered (its notes and due date can still change). If an approval workflow for invoices applies (see [Approval workflows](22-approval-workflows.md)), it decides; otherwise the people who hold `procurement.approve` are notified and see it in **My work** |
| **Approve for payment** or **Return** | Without a workflow, someone holding `procurement.approve` decides, **never the person who entered the invoice**. An invoice that does not match is approved only with a written reason, which is kept on the invoice and in the history. Returning needs a reason and puts the invoice back to **Entered** |
| **Record the payment** | An approved invoice becomes **Paid** with the date paid, the payment reference (check number, transfer or batch reference) and, if you wish, how it was paid. Who recorded it is kept |
| **Void** | With a reason (for example a duplicate, or replaced by a corrected invoice), while it is not paid; a running approval is canceled too |

**Procurement > Invoices** lists every invoice, with filters for its status, match, vendor, order, department and dates.

### What the budget shows

A budget line's **Spent** is what paid invoices charged to it (through the order lines they bill). **Committed** is the part of approved, issued and received orders not yet paid; closing an order releases what was not paid.

## Budgets

Select the **Budgets** tab, then **New budget** (or **Create > Budget**): a name, the **Fiscal year** in your own words ("FY 2027", "2026-27"), when the year starts and ends, and the owner. A new budget is a **Draft**; it becomes **Adopted** and **Amended** through its versions (see [Adoption and amendments](#adoption-and-amendments)), and **Closed** when you set it so. On the budget's **Lines** tab, add its **budget lines** (`BL-` numbers) while it is a draft: what the money is for, **Operating or capital**, the department, the **Account** (your finance system's account or cost code), the amount budgeted, and for a capital line the **Project** it pays for (see [Projects](08-projects.md)) and its funding award.

The budget shows, for the whole budget, for operating and capital, and for each line:

- **Adopted** (once the budget is adopted): each line's amount in the adopted version;
- **Committed**: the part of approved, issued and received purchase orders not yet paid;
- **Spent**: what paid invoices charged to the line;
- **Remaining**: budgeted (the current version) less committed and spent, and the share used.

A budget line's own page lists the purchase orders charged to it, with what was received and paid on each. These figures count every order, so they are the same for everyone; a person whose roles are limited to their departments sees the lines of those departments, and the totals still include the rest.

### Adoption and amendments

A budget is kept as **versions**: the adopted budget, then each amendment in order. The lines always hold the current (latest) version; the earlier amounts are kept. On the budget's **Versions** tab, someone holding `procurement.create` and `procurement.approve`:

1. selects **Record the adoption** once the lines are in: the date it was approved, when it takes effect (the approval date unless you give another), the **approval or board decision** (for example "Board resolution 2027-14"), and if you wish the **committee decision** (when committees and meetings are used: its date and reference fill the approval) and the controlled **document** holding the budget. You may correct an amount as you adopt. The budget becomes **Adopted**;
2. from then on, amounts change and lines are added only with **Record an amendment**: the same approval details, the **reason** (required), the new amount of each line that changes, and any new lines. Amendments take effect in date order, and the budget becomes **Amended**.

Once adopted, a line's amount cannot be edited, no line is added or deleted directly, and Adopted or Amended cannot be chosen as a status by hand (Closed can). The **Versions** tab lists each version with its date, approval, reason, total and change, and a table of every line's amount in every version, with the changes highlighted. A version's own page shows each line before and after it. A recorded version stays as it was (its approval wording, document, reason and notes can be corrected); only the latest version can be deleted, which puts the lines back as they were before it.

## Figures, My work and calendars

- **Procurement** shows open solicitations (and those with offers due in the next 14 days), solicitations waiting for an award, orders awaiting approval, invoices awaiting approval (with how many do not match, how many approved invoices are to be paid and how many are overdue) and the share of the budgets in force (adopted or amended, and today within their year) that is used. The Overview has the same **Procurement** panel for people who may view procurement.
- **My work** lists the evaluations a committee member still has to score, and the purchase orders and invoices the person may approve (the workflow's approvers when a workflow runs).
- The **calendar** and calendar feeds offer **Offers due on solicitations** and **Invoices due for payment** (approved invoices on their due date) (see [Calendar feeds](36-calendar-feeds-work-trackers-and-evidence-links.md#calendar-feeds)).
- Metrics for computed indicators and figures over time: **Open solicitations**, **Purchase orders awaiting approval** and **Budget used** (the last two for the current month only).

## Settings

**Procurement > Settings** (also a card under **Administration > Area settings**) shows:

- **Methods and their limits**: each method, the largest estimated value it may be used for under your rules, whether offers are scored or ranked by price, and whether it needs a written justification. These are edited in **Administration > Lists > Procurement method** (as installed no method has a limit).
- **Standard evaluation criteria**: the criteria a new evaluation can start from (`procurement.administer`).
- **Invoice match**: the tolerance, in percent, by which an invoice may go over the order's price or the value received and still match (0 as installed; at most 25).
- **Lists**: the area's lists (statuses, kinds of solicitation, committee roles, the required clauses template, invoice statuses and payment methods) with a link to edit each.

## Loading history

In data load mode (see [Administration](09-administration.md#data-load-mode)), an administrator can load past procurements and purchase orders as they were: their dates, references (for example `PO-2018-0042`), statuses and the people named with **on behalf of**. A loaded purchase order can have any status, its **Received** quantities and approval details; a loaded evaluation records each member's declaration and scores in their name with the dates given, and an award with its date and the person who made it. Nothing is sent while loading. Lines can be loaded from a file with the import of **Purchase order lines**.

Past **invoices** are loaded the same way: an invoice with its number, dates, reference (for example `INV-2018-0007`), status (a paid one with its approval, payment date, reference and method) and the person who entered it named with **on behalf of**; then its lines (import of **Invoice lines**, each naming the order line). Loaded paid invoices count as spent like any other.

Past **budget versions** are loaded as **Budget versions** records in date order: first the adoption, then each amendment with its approval date, decision, reason and line changes (`changes`: a list of `{ "budget_line_id": …, "amount": … }` for a new amount, `{ "budget_line_id": …, "change": … }` for an increase or decrease, or `{ "title": …, "kind": …, "account": …, "amount": … }` for a new line). The person who recorded each is the one named with **on behalf of**. A closed budget stays closed. Undoing the load puts the lines back as they were.

## AI assistants and the API

Solicitations, offers, purchase orders, purchase order lines, invoices, invoice lines, budgets, budget lines and budget versions are record types like any other, so an AI assistant with access can list and create them (see [AI assistants and MCP](21-ai-assistants-and-mcp.md)), and integrations use `/api/procurements`, `/api/procurement-offers`, `/api/purchase-orders`, `/api/purchase-order-lines`, `/api/purchase-invoices`, `/api/purchase-invoice-lines`, `/api/budgets`, `/api/budget-lines` and `/api/budget-versions`. The evaluation, award, approval, receiving, invoice approval and payment steps have their own routes, listed in the API reference.

## Sample data

The development sample data adds this year's invented budget with operating and capital lines, adopted and then amended once, a solicitation under evaluation with three offers and the standard criteria, an awarded small purchase, purchase orders in draft, awaiting approval, partly received and received, and their invoices: one paid, one awaiting approval and one that does not match.

## Not available yet

- Evaluation committee members outside the organization (without an account) score through the buyer, who records their scores in a data load.
- An invoice is paid in one payment. A part payment is entered as separate invoices, and a credit by voiding the invoice and entering the corrected one.
