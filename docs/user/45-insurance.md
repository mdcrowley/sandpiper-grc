# Insurance

The **insurance** part keeps the organization's insurance program in one place: the **policies** it holds (with their limits, deductibles, the conditions it must keep meeting, what each covers and when each must be renewed), the **certificates of insurance** that vendors and contractors provide (checked against what each contract requires), and **claims** with their reserves, payments and recoveries.

Open it from **Risk and compliance > Insurance** in the navigation, with the tabs **Policies**, **Certificates**, **Claims**, **Renewals**, **Contract requirements** and **Settings**. Lists and record pages work as described in [Getting started](01-getting-started.md).

If your organization does not use it, an administrator can switch **Insurance** off under **Administration > Features** (see [Administration](09-administration.md#features)). Its pages, menu entry, Create entries, the **Insurance** panel on assets, vehicles, sites and systems, its reminders, My work and calendar items, and its figures then disappear everywhere. Nothing is deleted: everything returns when the part is switched back on.

## What you need

The part uses the **insurance** permissions: `insurance.view` to read policies, certificates and claims, `insurance.create` and `insurance.edit` to add and change them (and to start a renewal), `insurance.delete` to delete them, `insurance.export` to export lists, and `insurance.administer` for the settings.

Administrators hold them. The default role **Risk and insurance coordinator** holds every insurance permission, reads vendors, contracts, controls, the inventory, vehicles and the risk register, and works on actions; it ships switched off: an administrator enables it under **Administration > Roles** (see [Administration](09-administration.md#roles-and-permissions)) or gives the insurance permissions to another role, such as the Risk manager.

## Policies

Select **Insurance**, then **New** (or **Create > Insurance policy**). A policy (`IPL-` numbers) has:

| Field | What it holds |
|---|---|
| **Policy** | A short name: "Cyber liability 2027" |
| **Line of coverage** | Property, general liability, auto liability, auto physical damage, workers' compensation, cyber, public officials and errors and omissions, crime and fidelity, pollution, excess or umbrella liability, professional liability or other. The list can be changed (see [Settings](#settings)) |
| **Status** | **Being placed**, **In force**, **Expired**, **Renewed** or **Canceled** |
| **Placed with** | An **insurance company**, a **risk pool** or a **self-insured program** |
| **Carrier or pool (vendor)** and **Carrier or pool** | The insurer or pool: choose it from the vendors when you keep it there, or give its name |
| **Broker or agent**, **Policy number** | As on the policy |
| **Effective** and **Expires** | The first and last day of the term |
| **Premium** | For the whole term |
| **Limit per occurrence**, **Aggregate limit** | The limits; the aggregate cannot be below the limit per occurrence |
| **Deductible**, **Self-insured retention** | What the organization pays first |
| **Sublimits** | One per line, for example "Business interruption: 250,000" |
| **Named insureds** | The organizations and bodies named on the policy |
| **Owner** | The person who looks after the policy and its renewal, and is reminded. A new policy belongs to the person who adds it unless you choose someone else |
| **Department** | Where it belongs. People whose roles are limited to their departments see only those departments' policies |
| **Renewal** and **Renewal application due** | Where the renewal stands: **Not started**, **Gathering information**, **Application submitted**, **Quotes received**, **Bound** or **Not renewing**, and when the renewal application is due (before the policy expires) |
| **Renews** | The policy of the term before |

Files (the policy wording, binders, declarations pages) go on the policy's **Evidence files** tab.

### Conditions

The **Conditions** tab lists what the policy requires of the organization: warranties, conditions and, for a cyber policy, its security requirements ("Second factor on all remote access", "Tested offline backups"). Select **Add condition**, name it and, where there is one, choose the **control** of the [control library](26-controls-and-testing.md) that shows it is met.

Each condition shows your own **Assessment** (**Not assessed**, **Met**, **Partly met**, **Not met**) and, for a tracked condition, the **Control result**: the control's latest rating from its tests (**Effective**, **Partly effective**, **Ineffective**), **Not tested yet**, or **Test overdue** when its next test date has passed. A control you cannot open is named "A control you cannot open". Open a condition to change its wording, who owns it and the date it must be met by; conditions not met by that date appear in the owner's **My work**.

### Covered records

The **Covered records** tab lists the assets, vehicles, sites and systems the policy covers. Select **Add record**, choose the kind and the record, and add a note if you like ("Buildings and contents", "Physical damage only"). Each of those records then shows an **Insurance** section (a tab on vehicles and systems) listing the policies that cover it, with their line, status, expiry and deductible. Records you cannot open are counted, not shown.

### Renewing a policy

On a policy being placed or in force, select **Renew**. A new policy is made for the next term, **Being placed**, starting the day after the old one expires and lasting as long, with the same line, carrier, limits, deductibles, sublimits, named insureds, owner, conditions (back to **Not assessed**) and covered records. The old policy's renewal moves to **Gathering information** if it had not started. Record the new policy number and premium as they arrive, and the steps of the renewal on the old policy.

When the new policy is set to **In force**, the old one becomes **Renewed** and its renewal **Bound**. A policy can be renewed once; the new term is renewed in turn.

The policy owner is reminded 90, 60 and 30 days before a policy expires, until its renewal is **Bound** or **Not renewing**, and 14 and 3 days before the renewal application is due and on the day, until it is submitted. Policy expiry and application dates appear in the owner's **My work** and in the compliance calendar.

## Certificates of insurance

The **Certificates** tab lists the certificates of insurance received from vendors and contractors. Select **New** (or **Create > Certificate of insurance**). A certificate (`COI-` numbers) has the **Vendor** and the **Contract** whose requirements it answers (the contract's vendor is filled in for you), or the **Insured** by name; the **Line of coverage**, **Insurer**, **Policy number**, **Coverage from** and **Expires**; the **Limit per occurrence** and **Aggregate limit**; whether the organization is **named as additional insured** and has a **waiver of subrogation**; when it was **Received**; its **Status** (**Requested**, **Received**, **Accepted**, **Rejected** or **Superseded**); and who **follows it up**. The title is made from the vendor and the line when you leave it empty. Attach the certificate itself on its **Evidence files** tab.

When a newer certificate for the same vendor, contract and line is received, the older ones become **Superseded**.

### What each contract requires

The **Contract requirements** tab lists the insurance each contract requires of its vendor: one requirement per line of coverage, with the **Minimum per occurrence**, **Minimum aggregate**, and whether the organization must be **named as additional insured** and have a **waiver of subrogation**. Add one with **New**: choose the contract and the line.

Every certificate received or accepted is checked against the requirements of its contract (or, when it names no contract, of its vendor's contracts) for the same line:

- **Against the contract** on the certificate says **Meets the contract**, **Short of the contract** (with what falls short, for example "Limit per occurrence 1,000,000 is below the required 2,000,000; the organization is not named as additional insured"), **Expired**, or **No requirement on file**. A certificate short of its contract shows a warning at the top of its page, and its **Contract requirements** tab lists what the contract requires.
- **Certificates on file** on the requirement says **Met**, **Shortfall** (with what is missing), **Certificate expired** or **No certificate**.

The check runs whenever a certificate or a requirement changes, and every day, since certificates expire by themselves. The person following a certificate up (or, without one, whoever added it) is reminded 30 days before it expires and on the day, and certificates about to expire appear in their **My work** and in the compliance calendar.

## Claims

The **Claims** tab lists claims under the organization's policies and against it. Select **New** (or **Create > Insurance claim**). A claim (`ICL-` numbers) has a short **Claim** title, the **Policy**, its **Kind** (property damage, vehicle collision or damage, bodily injury, workers' compensation, cyber incident, other liability, crime or theft, other), whether it is **Made** against the organization, by it under its own policy, or by it against another party; its **Status** (**Open**, **Under investigation**, **In litigation**, **Closed**, **Denied**, **Withdrawn**); the **Incident date**, when it was **Reported to the insurer**, the **Claimant**, the insurer's claim number and the adjuster; **What happened**; the **Safety event**, **Security incident**, **Asset**, **Vehicle** or **Site** it arose from; the **Reserve**, what has been **Paid to date** and **Recovered**; when it **Closed**; and who handles it.

A claim is reported to the insurer on the day it is added unless you give the date, and closing it records the day it closed unless you give one.

**Restriction.** Claims often hold personal or security details. Claims of the kinds bodily injury, workers' compensation and cyber incident start **restricted**, as does a claim linked to a security incident or to a restricted safety event: only people with access to restricted records (`security.view`) see them. Only those people may lift the flag or link a security incident. The figures still count every claim, so they are the same for everyone.

## Renewals

The **Renewals** tab is the renewal calendar: month by month, every policy that expires, every renewal application due and every vendor certificate of insurance that expires, starting a month ago, for the next three months to two years. Dates already past are marked **Past**. Each line opens its policy or certificate.

## Figures

The tiles at the top of each tab count every record, restricted claims included, so they are the same for everyone:

- **Policies**: **Policies in force** (with their premium), **Expiring soon** (within 90 days), **Renewal applications overdue**, and **Conditions not met** (not met or partly met, on policies in force or being placed).
- **Certificates**: **Expired** (still on file, coverage ended), **Expire within 30 days**, **Short of the contract**, and **Contract requirements not met** (missing, expired or short).
- **Claims**: **Open claims**, **Reserves on open claims**, **Paid** and **Recovered**.

Four monthly figures are offered to indicators, dashboards and figures over time: `insurance.policies_expiring` (policies expiring within 90 days), `insurance.certificates_expired`, `insurance.open_claims` and `insurance.open_reserves`.

## Settings

The **Settings** tab (`insurance.administer`; also under **Administration > Area settings**) sets when owners are reminded: days before a policy expires (90, 60, 30 as installed), before the renewal application is due (14, 3, 0) and before a certificate of insurance expires (30, 0). Give whole numbers of days separated by commas; each step reminds once per date. It also links to the insurance lists (lines of coverage, statuses, renewal steps, claim kinds and so on) under **Administration > Lists**.

## Loading past records

In data load mode (see [Administration](09-administration.md)), an administrator can load past policies and claims with their own dates and statuses: an expired or renewed policy with its term, a closed claim with its incident and closing dates, payments and recoveries, and the person who did the work. Nothing is worked out from today during a load: a closed claim keeps the closing date given (or none), a claim keeps an empty "reported" date, a certificate keeps an empty "received" date, and a new term does not close the term before it. No reminders are sent for loaded records.

## AI assistants and the API

Policies (`insurance_policy`, `/api/insurance/policies`), policy conditions (`insurance_condition`), certificates (`insurance_certificate`), contract requirements (`insurance_requirement`) and claims (`insurance_claim`) are ordinary record types: they can be listed, searched, exported and imported like any other, and an AI assistant connected under **AI assistant access** finds and creates them with its record tools. The other routes are `GET /api/insurance/summary`, `GET /api/insurance/renewals`, `GET /api/insurance/policies/:id/conditions`, `GET/POST/DELETE /api/insurance/policies/:id/covered`, `GET /api/insurance/covering`, `POST /api/insurance/policies/:id/renew`, `GET /api/insurance/contracts/:id/check` and `GET/PUT /api/insurance/settings` (see the [integration guide](../api.md)).

## Sample data

The `dev` sample data adds invented policies ("[Sample] Cyber liability" with three security conditions, two tracked by sample controls; "[Sample] Property and equipment" and "[Sample] Auto liability and physical damage" with covered sites and vehicles; "[Sample] General liability" renewing its previous term), three claims (one restricted) and, once sample vendors exist, contract requirements and certificates for two sample contracts, one short of its contract and two expired.

## Not available yet

- Claim payments one by one (today the totals paid and recovered are kept, and their changes are in the history).
- The insurance requirement of a contract on the contract's own page (today on the certificate's **Contract requirements** tab and the **Contract requirements** list).
- Allocating premiums to departments or sites, and a schedule of values for property insurance.
- Requesting a certificate from a vendor by email from the application.
