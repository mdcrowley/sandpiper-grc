# Records requests and privacy

The records and privacy pages track **requests for records** and **requests about people's own personal data** against a deadline you set, the records that answer each request with any exemption, and **privacy impact assessments** of the systems that hold personal data. Open them from the **Governance** group in the navigation: **Records requests** and **Privacy**. The pages share tabs along the top: **Requests**, **Privacy coverage** and **Privacy assessments**. Lists and record pages work as described in [Getting started](01-getting-started.md).

If your organization does not use them, an administrator can switch **Records requests and privacy** off under **Administration > Features** (see [Administration](09-administration.md#features)). The pages, their reminders, the "Records request" and "Privacy assessment" sources in the action tracker, the personal-data fields on data categories and the records notifications then disappear. Records are kept and return when it is switched back on. [Legal holds](33-legal-holds.md) are not part of it and keep working.

You need these permissions:

- **records**: `records.view` to read requests, `records.create` and `records.edit` to log and work them, `records.delete` and `records.export`, and `records.administer` to set the deadlines and send the reminders by hand.
- **privacy**: `privacy.view` to read assessments and requests about personal data, `privacy.create` and `privacy.edit` to write assessments, and `privacy.approve` to approve them.

The default **Records and privacy officer** role holds both; **Compliance officer** can read them, and **Security lead** and **Auditor** can read privacy. An administrator can grant them to any other role under **Administration > Roles**.

No law is built in. The deadlines, the kinds of request, the exemptions and the screening questions are your own settings and lists, and the **legal basis** of an assessment is written as recorded.

## Requests

Open **Records requests**. The line above the list counts the open requests, those due soon and those overdue. Filter by kind, status, owner and dates.

### Log a request

1. Select **New records request**, or **Create** then **Records request**.
2. Enter a short **Subject** (shown in lists; leave the requester's name out of it), and choose the **Kind**: **Records request**, **Personal-data access**, **Personal-data correction**, **Personal-data deletion** or **Other**. Administrators can change the kinds under **Administration > Lists** (list **Records request kind**).
3. Enter the day it was **Received on** (today when left empty), the **Requester**, their contact and address, whether their **Identity verified**, **What was asked for**, and the **Owner** who works it.
4. Select **Create records request**. It gets a reference such as `RRQ-00001`, and its **Due** date is worked out from the deadlines (below).

Requests about someone's own personal data (the three **Personal-data** kinds) are seen only by people who also hold `privacy.view`, in lists, search, links, exports and everywhere else. Counts and charts include them for everyone, without their details.

### Deadlines

Holders of `records.administer` select **Deadlines** on the list to set:

- **Default days to answer**: 20 unless you change it. Set your own: no jurisdiction's deadline is built in.
- Days for each kind of request, when one kind has its own deadline (empty uses the default).
- **Count working days only**: Monday to Friday. Public holidays are not known, so extend a request when one falls in its period.
- **Due soon when this share of the time is left**: 0.25 unless you change it.
- **Remind of privacy reviews (days before)**: 30 unless you change it.

New requests use the settings; the due dates of existing requests stay as they were.

### Clock

The **Clock** tab shows the request's due date and whether it is **On time**, **Due soon** (the last part of the time to answer, as set above) or **Overdue**, with the days left. Once answered it says **Answered on time** or **Answered late**. Lists of open requests put the overdue ones first.

The request's owner (or, with no owner, everyone who may edit requests) is told once when a request becomes due soon and once when it becomes overdue. People can switch these off under the **Records requests and privacy** kind of their notification preferences.

**Extend…** sets a new due date with a **Reason**. The first due date, the new one and the reason stay on the request and in its history, and the reminders start again for the new date.

### Responsive records

The **Responsive records** tab lists the records that answer the request. **Add a record** chooses the kind of record and the record; only records you can see can be added. For each, record how much was **Disclosed** (**Disclosed in full**, **Disclosed in part** or **Withheld**), any **Exemption** (your own list **Records request exemption** under **Administration > Lists**; the examples are personal privacy, security-sensitive, legal advice, ongoing investigation and commercial confidence) and a **Note**. **Change** and **Remove** edit the list. The record's own **Related** tab shows the request as "responsive to".

Documents themselves are not redacted here: record the exemption on the record and redact the copy you release in your document tool.

**Preserve…** places the responsive records you can see under a [legal hold](33-legal-holds.md), an existing one or a new one for the matter you name, so they cannot be deleted or anonymized while the request is open. It needs permission to edit legal holds.

### Response and closing

The **Response** tab holds the date **Responded on**, the **Response summary** and any **Fee**. **Close the request…** chooses the outcome (**Closed**, **Responded**, **Withdrawn** or **Refused**) and needs a response summary. A closed request stops its clock.

The **Actions** tab, where the action tracker is installed, raises follow-up actions filed under "Records request".

## Privacy coverage

Open **Privacy**. It lists every system that holds a data category marked as personal data, with those categories, its newest assessment and whether it has an **approved assessment in date** (**Current**) or not (**No current assessment**). The line above counts every such system, including any you cannot see.

To mark a data category as personal data, open it under **Inventory > Data categories** and edit **Personal data**: check **Holds personal data** and choose the **Kinds of personal data** (contact details, identity documents, account and payment, travel history and location, video images, health or eligibility, employment, other). Link the category to the systems that hold it on the system's page. A system's page has a **Privacy** tab listing its assessments.

## Privacy impact assessments

Open **Privacy assessments** for the list, or the **Privacy** tab of a system.

1. Select **New privacy impact assessment**, enter a **Title**, choose the **System** and the **Owner**, and how often to **Review every (months)** (24 unless you change it), then select **Create privacy impact assessment**.
2. On the assessment's page, describe the **Purpose of the processing**, the **Legal basis (as recorded)**, **Necessity and proportionality**, **Retention**, **Sharing and transfers**, the **Risks to people** and the **Mitigations**, and rate the **Residual risk**.
3. On **Questions**, answer the screening questions (your own list, **Privacy impact assessment question**, under **Administration > Lists**), then select **Save answers**.
4. On **Data categories**, check the system's categories the assessment covers.
5. On **Approval**, select **Submit for approval**. The assessment needs its system, purpose, risks and residual risk.

The **Privacy impact assessment** approval workflow decides it (a new installation has one, decided by anyone holding `privacy.approve`; see [Approval workflows](22-approval-workflows.md)). Approval records who approved it and when and sets the **Next review** date; rejection returns it to **Draft**. With no workflow set up, someone holding `privacy.approve` who submits it approves it at once.

An approved assessment becomes **Needs update** when the system's data categories change after approval: review it and submit it again. The owner is reminded before the next review date (see Deadlines above). The **Actions** tab raises actions filed under "Privacy assessment".

## Sample data

The sample data (development profile) holds six invented requests (one overdue, one extended, one closed with an exemption), personal-data flags on the sample data categories and three assessments (one approved, one in review and one due for review), each labeled "(sample)".
