# Evidence library

Compliance work keeps asking for the same documents: the procurement procedure supports a control, answers a funder's review area, meets an obligation and satisfies an audit request. The **evidence library** files each piece of evidence once, as an **evidence record**, and links it to every record it supports. When the evidence is renewed, every record that uses it has the new copy, and its owner is reminded before it lapses.

Open the library from **Risk and compliance > Evidence library** in the navigation, with the tabs **Library** and **Expiring**. Lists and record pages work as described in [Getting started](01-getting-started.md).

Vendor evidence (insurance certificates, security reports and other documents a vendor provides) keeps its own pages under **Vendors > Evidence** (see [Vendors and contracts](04-vendors-and-contracts.md)). An evidence record of the library can still be linked to a vendor evidence item, like any other record.

If your organization does not use it, an administrator can switch **Evidence library** off under **Administration > Features** (see [Administration](09-administration.md#features)). The pages, the **Evidence** panels on other records, the evidence of funder review areas and document requests, the reminders, and the library's My work and calendar items then disappear everywhere. Nothing is deleted: everything returns when the part is switched back on.

## What you need

The library uses the **evidence** permissions: `evidence.view` to read the library and the evidence other records use, `evidence.create` and `evidence.edit` to file and change evidence records, `evidence.delete` to delete them, and `evidence.export` to export the list.

Linking evidence to a record changes what that record shows as its evidence, so it also needs permission to **edit that record** (for example `controls.edit` to link evidence to a control). One exception: the person a funder's document request is assigned to may answer it with files and evidence, without permission to edit funding records (see [Funding and grants](27-funding-and-grants.md#document-requests)).

## Evidence records

Select **Evidence library**, then **New** (or **Create > Evidence record**). An evidence record (`EVD-` numbers) has:

| Field | What it holds |
|---|---|
| **Title** | What the evidence is, as it should appear in lists: "Procurement procedure with price analysis step" |
| **What it shows** | What the evidence demonstrates |
| **Owner** | The person who keeps it current and is reminded before it lapses. A new record belongs to the person who files it unless you choose someone else |
| **Department** | The department it belongs to. People whose roles are limited to their departments see only the evidence of those departments |
| **Source** | **Files** (attached on the record's **Evidence files** tab), **A link to where it is kept** (the **Link**, an https or http address), or **A document of the document library** (the **Document**, a controlled document, see [Document library](11-policies-and-exceptions.md)) |
| **Period covered from** and **to** | The period the evidence is about, for example a financial year |
| **Collected on** | When it was collected or received |
| **Valid until** | When it must be renewed. Leave it empty for evidence that does not lapse |
| **Restricted** | Only people with security access (`security.view`) see it |
| **Notes** | Anything else |

A link needs its address and a document needs the document; **Valid until** cannot be before **Collected on**, and the period cannot end before it starts.

Files are attached on the **Evidence files** tab of the record, as on any record (see [Files and links](01-getting-started.md)). An evidence record can hold several files, such as a report and its appendix.

The header shows whether the evidence is **Valid**, **Lapses soon** (within the reminder window, 30 days as installed), **Lapsed** or has **No expiry**.

## Using evidence for records

An evidence record is linked to the records it supports, each link with a **relation**: **Supports**, **Shows it is met**, **Answers the request** or **For reference**, and an optional note (such as the page or section that answers it). Evidence is usually linked to controls, control tests, obligations and their periods, audits, audit evidence requests and findings, funder compliance reviews (their areas and document requests), review deficiencies, corrective action plans and actions, framework outcomes, documents, risks and vendor evidence items.

From the evidence record:

1. Open the **Used by** tab and select **Use for a record**.
2. Choose the **Kind of record** (only the kinds you may edit are offered) and the record.
3. Choose **How it relates**, add a note if you like, and select **Link**.

From another record, open its **Evidence** tab. Every record page of a kind evidence is linked to has one (controls, control tests, obligations, audits, audit evidence requests and findings, corrective action plans, actions, framework outcomes, documents, risks, vendor evidence items, funding awards and certifications, procurements, purchase orders and invoices, insurance policies, certificates and conditions), shown while the library is on and you may view it; parts of records (an obligation's periods, a funder review's areas and document requests, an audit's workpaper steps) have the same panel where they are shown. It offers:

- **Use existing evidence**: pick an evidence record already in the library. Nothing is uploaded again.
- **Upload a file**: the file is filed once as a new evidence record (with the title and **Valid until** you give, owned by you) and linked at once. This needs `evidence.create` as well.

**Remove** on a link stops using the evidence there; the evidence record stays in the library and in the other records that use it. A link on a workpaper step that a reviewer has signed cannot be added or removed: the step is locked (see [Audits and inspections](25-audits-and-inspections.md#workpapers)). Linking and removing are recorded in the history of both the evidence record and the other record.

The **Used by** tab lists every record that uses the evidence. Records you may not see are not listed but counted ("Also used by 2 records you cannot open"), and the same goes the other way: a record's **Evidence** panel counts evidence you may not open (restricted, or outside your departments) without showing it. The counts are the same for everyone.

## Expiring evidence

The **Expiring** tab is the one **Expiring evidence** page, opened on the evidence library (its **Source** filter also shows vendor evidence and evidence files; see [Attachments and notifications](14-attachments-and-notifications.md#expiring-evidence)). It lists evidence that has lapsed or lapses within the reminder window, the soonest first. To renew evidence, collect a current copy, attach it to the evidence record (or change its link) and change **Valid until**: every record that uses it then has the new copy.

The owner (or, without an owner, the person who filed it) is reminded in the application, and by email when it is set up, 30 days and 7 days before **Valid until** and on the day, once for each step and date. Changing **Valid until** starts the reminders again for the new date. An administrator changes the steps under **Administration > Reminders** (setting `evidence.reminder_days`, see [Administration](09-administration.md)). Evidence to renew also appears in the owner's **My work** and in the compliance calendar on its **Valid until** date.

Files attached to an evidence record can carry an expiry date of their own; those remind the record's owner as evidence files do on any record.

## Figures

The tiles at the top of the library count every evidence record, so they are the same for everyone: **Evidence records** (and how many uses by other records), **Lapse soon**, **Lapsed** and **Used by nothing** (evidence not linked to any record yet). **Lapse soon** opens the **Expiring** tab and **Lapsed** the lapsed records you may see.

## AI assistants and the API

Evidence records are an ordinary record type (`evidence_record`, `/api/evidence-library`), so they can be listed, searched, exported and imported like any other, and an AI assistant connected under **AI assistant access** finds them with its record tools. Links are made with `POST /api/evidence-links` and read with `GET /api/evidence-links?record_type=&record_id=`; `POST /api/evidence-library/upload` files a finished upload as a new evidence record (see the [integration guide](../api.md)).

## Sample data

The `dev` sample data adds four invented evidence records ("[Sample] Procurement procedure with price analysis step", "[Sample] Funded equipment inventory export" which lapses soon, "[Sample] Independent financial audit report" which has lapsed, and the restricted "[Sample] Quarterly access review sign-off"), linked to the sample controls and obligations and to the areas of the sample funder compliance review.

## Not available yet

- Finding a file already in the library by its content when you upload it again (today, choose **Use existing evidence**).
- An evidence request list shared with an outside party (the audit evidence requests and funder document requests do this for their own records).
- Outside reviewers do not see library evidence linked to the audit or review they were invited to.
- An AI assistant finds evidence records but cannot link them to other records yet.
