# Vendor risk lifecycle

Looking after a vendor does not stop when the contract is signed. This page covers what happens after that: an **intake questionnaire** that sets each new vendor's risk tier and the checks it needs before a contract becomes active, **reassessing** each vendor on a cadence set by how critical it is, recording **checks against exclusion lists**, keeping a register of **vendor issues** until each is resolved, and **offboarding** a vendor with a checklist when a contract ends. Sub-recipients of funding awards, which are monitored in a similar way, are described in [Funding and grants](27-funding-and-grants.md#sub-recipients).

All of it is part of **Vendors and contracts**: it is switched off with that part under **Administration > Features**, and it uses the vendor permissions (`vendors.view` to read, `vendors.create` and `vendors.edit` to record and change, `vendors.approve` to sign off an offboarding and to waive a required check, `vendors.administer` to change the settings). The **Security lead** role holds them all; **Agent**, **Compliance officer** and others can read. Lists and record pages work as described in [Getting started](01-getting-started.md).

Open a vendor and its **Intake and checks** tab for its risk tier and required checks, and its **Lifecycle** tab to see everything about one vendor in one place: its reassessment, its exclusion-list checks, its issues and its offboardings. Under **Vendors** in the menu, **Reassessments due**, **Vendor issues** and **Vendor offboarding** list them across every vendor.

## Reassessment on a cadence

Each vendor's **Criticality** sets how often it is reassessed with the security questionnaire (see [Vendor assessments](04-vendors-and-contracts.md#vendor-assessments)). As installed:

| Criticality | Reassessed every |
|---|---|
| Critical | 12 months |
| High | 12 months |
| Medium | 24 months |
| Low | 36 months |

**Next assessment due** is worked out for you: the date of the last completed assessment plus the months for the vendor's criticality. A vendor that has never been assessed is due from the day it was added. A vendor with no criticality, or a criticality with no months set, is never due. The date is worked out again when an assessment is completed and when the vendor's criticality changes, and every night. **Last assessed on** and **Next assessment due** cannot be typed in.

Give each vendor a **Vendor owner** (on the vendor's details). The owner is reminded when the next assessment is coming due, once for each due date, from the number of days before it set in the settings (30 as installed). A vendor with no owner reminds everyone who may edit vendors.

### Reassessments due

**Vendors > Reassessments due** lists the vendors whose assessment or exclusion-list check falls due in the window you choose (the next 30 or 90 days, the next year, or every vendor), with overdue ones first. Former vendors are left out.

### Settings

People with `vendors.administer` select **Settings** on that page to change:

- the months between assessments for each criticality (leave a box empty for "never due"; a change works every vendor's next date out again),
- how many days before a due date the owner is reminded,
- how often exclusion-list checks are due (12 months as installed),
- whether a recent exclusion-list check is needed **before a contract becomes active** (off as installed; see below).

Every change is recorded in the audit log.

## Exclusion-list checks

Many organizations check, before they contract with a vendor and from time to time afterward, that the vendor is not on a list of parties barred from public contracts or from doing business with them. The application does not connect to any list: you make the check where the list is published and record it here.

On the vendor's **Lifecycle** tab, under **Exclusion-list checks**, select **Record a check** and enter:

- **Checked on** (today unless you checked earlier; never in the future),
- **List checked**: the list your organization uses. The lists are yours to name under **Administration > Lists**, in the list **Exclusion list**; one neutral example, "Government exclusion list (rename to yours)", is there to start with. Rename it, and add one entry for each list you check,
- **Result**: **Clear**, **Possible match** or **Match**,
- **Search reference**: the reference or result number the list showed,
- **Note**: needed for a possible match or a match (what was found and what happens next),
- **Result file**: optionally, a file already on the vendor's **Attachments** tab that holds the result (a saved search or a screenshot); the box shows only when the vendor has files.

Then select **Record the check**.

The checks are kept as history, newest first, and **Last exclusion-list check** on the vendor shows the latest date. A check is **due** every 12 months (a setting); an active vendor that has never been checked is due at once. The owner is reminded as for reassessments. A **possible match** or a **match** notifies the vendor's owner straight away (or everyone who may edit vendors when it has no owner).

### Checks before a contract becomes active

With **Need a recent exclusion-list check before a contract becomes active** on, a person cannot make a contract **Active** (by creating it as active or by changing its status), or move an active contract to another vendor, unless the vendor's latest check is within the months set and is not a **Match**. The contract form says what is missing. Contracts loaded by the system (imports of a contract register, sample data) are not held up.

## Intake and risk tiers

Before a new vendor is relied on, answer its **intake questionnaire**. Your answers set the vendor's **risk tier** by rules your organization writes, and the tier decides which **checks** are needed before any contract with the vendor can become active.

### Fill in the intake

1. Open the vendor and its **Intake and checks** tab.
2. Select **Fill in the intake** (or **Fill in again** to answer afresh later).
3. Choose one answer for each question. While you answer, the box at the bottom shows the risk tier the answers give and the checks that tier needs.
4. Add **Notes** if they help explain the answers, and select **Save the intake**.

Every question must be answered. The vendor's **Risk tier** and **Risk tier set on** are updated (nobody can type them), and the **Risk tier** card shows the tier, when and by whom it was set, and **Why this tier**: each answer that matched a rule and the tier it gives. **All answers** shows the full questionnaire as it was answered. The tier also shows as a chip in the vendor's header (for example "High risk tier"), as a column and filter on the vendors list. Filling in the intake needs `vendors.edit`; the vendor's owner is told when checks are still to do. Earlier intakes are kept and listed under **Earlier intakes**.

### Required checks

The **Required checks** card lists the checks the vendor's tier needs, each **Done**, **Waived**, **Expired** or **Not done**. To record one, select **Record** on its line (or **Record a check**):

- **Check**: one of your organization's checks.
- **Outcome**: **Done**, or **Waived, with a reason**. Waiving needs the permission to approve for vendors (`vendors.approve`, held by the **Security lead** role) and a reason.
- **Done on** (or **Waived on**): today or earlier.
- **Needed again after**: an optional date. After it the check counts as **Expired** and must be done again.
- **Reference** and **Note** (for a waiver, **Reason for the waiver**).

The latest record of each check counts. Every record stays under **Checks recorded**; one recorded in error can be removed with the bin button (a waiver only by someone who may waive). Removing is refused while the vendor is under a legal hold, and every record and removal is in the vendor's history.

### A contract cannot become active until the checks are done

A person cannot make a contract **Active**, by creating it as active or by changing its status, while a check its vendor's tier needs is **Not done** or **Expired**. Moving an active contract to another vendor is checked the same way against the new vendor, so it cannot be used to get around a check that only someone who may approve vendors can waive; the **Vendor** field says what is missing. The contract form names the checks still missing; create the contract as **Draft** meanwhile. A draft contract's page also shows which checks stand in the way, with a link to the vendor's checks. Contracts loaded by the system (imports of a contract register, sample data) are not held up, and a contract already active stays active when a check later expires or the tier rises.

A vendor with no intake has no tier and needs no checks, unless an administrator switches on **Require a completed intake before a contract becomes active**.

### Set up the questionnaire, the tier rules and the checks

Select **Intake questions** on the vendors list. Everyone who views vendors can read the page; changing it needs `vendors.administer`.

- **Questions**: the question, optional help for the person answering, and two to twelve answers to choose from. Use **Add question**, **Add answer** and the bin and × buttons.
- **Tier rules**: each rule names a question, one or more of its answers, and the tier those answers give **at least**. A vendor gets the highest tier of any rule its answers match, or the **Default tier** when none matches.
- **Checks each tier needs**: tick the checks for each tier.

Select **Save the intake questions**. Intakes already completed keep the questions they were answered against and the tier they gave; a vendor gets a new tier only from a new intake. The tiers (ranked in their list order) and the checks themselves are the lists **Vendor risk tier** and **Vendor check** under **Administration > Lists**. The starter questionnaire (data held, access to systems, effect on service and safety, spend) and its rules are only an example to rewrite.

**Before a contract becomes active** holds the switch **Require a completed intake before a contract becomes active** (off at first).

## Vendor issues

A vendor issue is a problem with a vendor that you want tracked to the end: a service failure, a security or billing problem, a compliance gap. Open **Vendors > Vendor issues**, or the vendor's **Lifecycle** tab, and select **New vendor issue**. Enter the **Issue** (its title), the **Vendor**, optionally the **Contract**, a **Category** (service failure, security, billing, compliance, safety or other), a **Severity**, the **Owner** and **What happened**. **Raised on** is today unless you change it. Select **Create vendor issue**. Each issue gets a reference such as `VIS-00001`.

Move the issue through **Open**, **In progress**, **Resolved** and **Closed**. Resolving or closing needs a **Resolution**; **Resolved on** is filled in for you.

When an issue needs more than a quick fix, select **Raise a corrective action plan** on the issue. The plan's source is **Vendor**, its problem statement comes from the issue, and the issue moves to **In progress** and shows the plan (see [Corrective action plans](24-corrective-action-plans.md)). Raising a plan also needs permission to create actions.

## Offboarding

When a vendor leaves, the people who look after systems, assets and data need to take back what the vendor had: accounts, remote access, equipment and the organization's data. An **offboarding** is a checklist for that.

### How an offboarding starts

- **When a contract ends.** Changing a contract's status to **Expired** or **Ended** (or any status an administrator marks as ended) starts an offboarding for that contract, once.
- **When an end date passes.** Every night, a contract whose end date passed in the last 30 days, which does not renew by itself and is still not marked as ended, gets an offboarding too.
- **By hand.** Select **Start offboarding** on a contract page (it shows **Open offboarding** once there is one), or **New vendor offboarding** under **Vendors > Vendor offboarding** or on the vendor's **Lifecycle** tab (for example when a vendor leaves without a contract ending).

Each offboarding gets a reference such as `OFB-00001`, an **Owner** (the contract's owner when it started by itself; they are notified), a **Due** date 30 days ahead, and says why it started.

### The checklist

The checklist is built from the inventory:

- **Accounts and access**: one item for each system with this vendor or contract.
- **Remote access**: one item for each of those systems when the vendor has a **Remote access method** recorded, or when the system says the vendor has remote access (the OT security fields, when they are installed). A vendor with remote access and no systems gets one item for the vendor.
- **Assets returned**: one item for each asset with this vendor or contract that is not disposed of.
- **Data returned or destroyed**: one item for each data category held by those systems.
- **Other**: the items of your own template, under **Administration > Lists** in the list **Vendor offboarding checklist** (as installed: collect badges and keys, change shared passwords the vendor knew, remove the vendor from contact and on-call lists, settle the final invoice).

**Add new items from the inventory** adds items for anything linked since the offboarding started; it never removes items or adds one twice. An item names a record only to people who may see that record.

Select **Update** on an item to mark it **Done** or **Not applicable**, with a note of the evidence (a ticket number, a certificate of destruction, a receipt for returned equipment). **Not applicable** needs a note saying why. Who did it and when is recorded, and every change is in the offboarding's history. The first change moves the offboarding to **In progress**.

### Sign-off

When every item is done or not applicable, sign the offboarding off:

- With no approval workflow for offboarding sign-off, someone with `vendors.approve` selects **Sign off**. Their name and the date are recorded.
- When an administrator has set up an approval workflow of the kind **Vendor offboarding sign-off** (see [Approval workflows](22-approval-workflows.md)), anyone who may edit vendors selects **Ask for sign-off**; the approvers decide, and approval records the approver's name and the date. A rejection leaves the offboarding in progress, with the reason in its history.

A signed-off offboarding cannot be changed or reopened.

## The clause checklist engine

The contract security terms (see [The security-terms checklist](04-vendors-and-contracts.md#the-security-terms-checklist)) and the funder-required clauses (see [Funder-required clauses on contracts](27-funding-and-grants.md#funder-required-clauses-on-contracts)) are kept by one clause-checklist engine. Nothing changes on the screens; what was recorded before was moved across when the application was upgraded.

## Figures and the calendar

The vendor lifecycle offers these figures to dashboards, safety performance indicators and key risk indicators: **Vendor reassessments overdue** and **Open vendor issues** (see [Dashboards and reports](15-dashboards-and-reports.md)). The lifecycle summary that assistants and reports read also counts the vendors whose risk tier still needs checks. Like every figure, they count every vendor, whoever is looking. A vendor owner can add **Vendor reassessments due (vendors I own)** to a personal calendar feed, when calendar feeds are switched on.

## Retention

Anonymizing a vendor at the end of its retention period also clears its contacts' names and details and the names and notes on its exclusion-list checks, required checks and intakes; anonymizing an offboarding clears who completed its items and their notes (see [Administration](09-administration.md)).

## Sample data

The `dev` sample data sets owners on the sample vendors, adds completed assessments that leave three reassessments overdue, twelve exclusion-list checks against the example list (one a possible match, and one vendor overdue for a check), five vendor issues labeled "[Sample]" (one with a corrective action plan), and an ended contract "[Sample] Redbrick legacy backup service" with an offboarding in progress that has system, remote-access and asset items. It also completes the intake for three sample vendors (one in each of the critical, moderate and low tiers), with their required checks: one waived with a reason and one still to do.

## Not available yet

- Checking an exclusion list automatically: the application never calls an outside service. Record each check by hand.
- Removing accounts automatically when an offboarding item is done: the item records that someone did it.
