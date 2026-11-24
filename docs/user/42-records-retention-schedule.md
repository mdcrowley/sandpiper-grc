# Records retention schedule

Every organization keeps business records: maintenance work orders for each bus, invoices and payment approvals, investigation files, board minutes. Each kind is kept for a set time and then destroyed, sent to an archive or looked at again. The **retention schedule** lists those kinds of records, called **record series**, with how long each is kept and from which event the time is counted. The **destruction log** records each batch of records that reaches the end of its time: approved first, then carried out and recorded with its certificate, so you can show later what was destroyed, when, how and on whose authority.

This is about your organization's own records, on paper and in its systems. It is not the retention of this application's own data, which an administrator sets under **Administration > Retention** (see [Administration](09-administration.md)). Lists and record pages work as described in [Getting started](01-getting-started.md).

Open the pages from the **Governance** group in the navigation: **Retention schedule** and **Destruction log**.

If your organization does not use them, an administrator can switch **Records retention schedule** off under **Administration > Features** (see [Administration](09-administration.md#features)). The pages, the series and destructions, their calendar entries, My work items and search results then disappear everywhere. Nothing is deleted: everything returns when the part is switched back on. The schedule uses the records permissions, so switching **Records requests and privacy** off hides it too.

## What you need

The schedule and the log use the **records** permissions: `records.view` to read them, `records.create` and `records.edit` to keep series and propose, submit, record and cancel destructions, `records.delete` to delete a series or a proposed destruction, and `records.approve` to approve a destruction. The default **Records and privacy officer** role holds them all; **Compliance officer** can read them.

## Record series

Select **Retention schedule**, then **New** (or **Create > Record series**). A series has:

| Field | What it holds |
|---|---|
| **Title** and **Schedule number** | The name of the series, and your own number for it in the schedule, if you use one |
| **What the records are** | What the series holds, so people know which records belong to it |
| **Category** | Administration, finance, operations, maintenance, safety, personnel, legal or technology (an administrator can change the list) |
| **Kept on** | **Paper**, **Electronic** or **Paper and electronic** |
| **Records owner** and **Department** | Who answers for the series |
| **Where they are kept** and **System holding them** | The file room, off-site store or system; for electronic records, the system from the inventory |
| **Keep for** and **Unit** | How long, in days, months or years (half years are allowed, such as 0.5 years) |
| **Kept permanently** | The records are never destroyed; the period is then left empty |
| **Counted from** | The trigger event: created or received, file or case closed, end of the fiscal or calendar year, superseded, contract or grant ends, employee leaves, asset or vehicle disposed of, or another event described in **About the trigger** |
| **At the end** | **Destroy**, **Transfer to an archive**, or **Review, then decide** |
| **Authority** | The law, rule or policy that sets the period, as your organization cites it. The application has no built-in periods: your organization enters its own |
| **Vital record** and **Holds personal data** | Flags for records needed to keep running after a disaster, and for records about people |
| **Next review** | When the entry should be looked at again. The records owner sees it in **My work** and the compliance calendar when it is due, and it stays there while overdue |

A series without a period is refused unless it is kept permanently. Set **Status** to **Retired** when a series is no longer used; a series with destructions in the log cannot be deleted, only retired.

A series page has a **Destructions** tab listing the destructions of that series, with a **New** button that starts one for it.

## Proposing a destruction

When records of a series reach the end of their time, propose a destruction: from the series' **Destructions** tab, or **Destruction log > New**. Give:

- **Title** and **Record series**.
- **Which records**, **Records from** and **Records to** (the dates the records cover), **Quantity** (such as "12 boxes" or "3,200 files") and **Where they are**.
- **Trigger date**: when the series' trigger event happened for these records, for example the end of the fiscal year they belong to. When it is empty, the **Records to** date is used.
- **Method**: shredding, pulping, incineration, secure deletion, destruction of the storage media, or transfer to an archive.

**May be destroyed from** is worked out from the trigger date and the series' period, and shown on the page with the period in words ("7 years after the end of the fiscal year"). A destruction for a series kept permanently is refused.

## Approval

On the destruction's page, the **Progress** card shows the period, the date the records may go, and where the approval stands.

1. Select **Submit for approval**. The button is available only once the records are past their period and no legal hold applies.
2. The **Records destruction** approval workflow asks its approvers. A new installation has one step: anyone who may approve records work (`records.approve`), other than the person who submitted it. An administrator can add steps (for example the records owner, or counsel) under **Administration > Workflows** (see [Approval workflows](22-approval-workflows.md)).
3. Approved: the status becomes **Approved**, with who approved it and when. Rejected: **Rejected**, with the approver's reason; change what is needed and submit again.

When no Records destruction workflow is active, someone who may approve records work approves it at once by submitting it; anyone else is told that no workflow applies.

Once submitted, a destruction's details are fixed: only its notes can change. If it will not go ahead, select **Cancel the destruction** and give the reason; it stays in the log as **Canceled**.

## Recording that it was carried out

After the records are destroyed or transferred, select **Record as carried out** on the approved destruction and give the date, who carried it out (a person or the destruction service), the method, a witness if there was one, and the reference of the certificate of destruction. Attach the certificate itself under the **Evidence files** tab. The status becomes **Carried out**.

A destruction you submitted shows up in your **My work** once it is approved, until it is recorded as carried out.

A destruction that was submitted, approved or carried out cannot be deleted: the log is kept. Every step is in the destruction's history.

## Legal holds

A record series can be placed under a [legal hold](33-legal-holds.md) like any other record (and so can a single destruction). While a hold is active:

- the destruction cannot be submitted, and a submission is refused with the hold's reference;
- an approval that finishes while the hold is active sends the destruction back to **Proposed**;
- an approved destruction cannot be recorded as carried out.

The **Progress** card says that a legal hold applies; people who may see legal holds also see which. Once the hold is released, submit the destruction again.

## Search and the assistant

Search finds series by their title, schedule number, description, authority and location, and destructions by their title, description, quantity, location and certificate, under the same permissions as the lists. The AI assistant reads them the same way.
