# Insurance

The **insurance** part keeps the organization's insurance program in one place: the **policies** it holds (with their limits, deductibles, the conditions it must keep meeting, what each covers, how each premium is split across departments and sites, and when each must be renewed), the **schedule of values** of insured property, the **certificates of insurance** that vendors and contractors provide (checked against what each contract requires, and asked for by email with a personal upload link), and **claims** with their reserves and each payment and recovery.

Open it from **Risk and compliance > Insurance** in the navigation, with the tabs **Policies**, **Certificates**, **Requests**, **Claims**, **Renewals**, **Contract requirements**, **Schedule of values**, **Premium allocation** and **Settings** (tabs that do not fit go under **More**). Lists and record pages work as described in [Getting started](01-getting-started.md).

If your organization does not use it, an administrator can switch **Insurance** off under **Administration > Features** (see [Administration](09-administration.md#features)). Its pages, menu entry, Create entries, the **Insurance** panel on assets, vehicles, sites and systems, the **Insurance** tab of contracts, the vendors' upload links, its reminders, My work and calendar items, and its figures then disappear everywhere. Nothing is deleted: everything returns when the part is switched back on.

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
| **Premium split** and **Measure counted** | How the premium is split across its shares (see [Premium allocation](#premium-allocation)) |

Files (the policy wording, binders, declarations pages) go on the policy's **Evidence files** tab.

### Conditions

The **Conditions** tab lists what the policy requires of the organization: warranties, conditions and, for a cyber policy, its security requirements ("Second factor on all remote access", "Tested offline backups"). Select **Add condition**, name it and, where there is one, choose the **control** of the [control library](26-controls-and-testing.md) that shows it is met.

Each condition shows your own **Assessment** (**Not assessed**, **Met**, **Partly met**, **Not met**) and, for a tracked condition, the **Control result**: the control's latest rating from its tests (**Effective**, **Partly effective**, **Ineffective**), **Not tested yet**, or **Test overdue** when its next test date has passed. A control you cannot open is named "A control you cannot open". Open a condition to change its wording, who owns it and the date it must be met by; conditions not met by that date appear in the owner's **My work**.

### Covered records

The **Covered records** tab lists the assets, vehicles, sites and systems the policy covers. Select **Add record**, choose the kind and the record, and add a note if you like ("Buildings and contents", "Physical damage only"). Each of those records then shows an **Insurance** section (a tab on vehicles and systems) listing the policies that cover it, with their line, status, expiry and deductible. Records you cannot open are counted, not shown.

### Renewing a policy

On a policy being placed or in force, select **Renew**. A new policy is made for the next term, **Being placed**, starting the day after the old one expires and lasting as long, with the same line, carrier, limits, deductibles, sublimits, named insureds, owner, conditions (back to **Not assessed**) and covered records. The old policy's renewal moves to **Gathering information** if it had not started. Record the new policy number and premium as they arrive, and the steps of the renewal on the old policy.

The premium shares are copied too, and worked out again on the new premium. When the new policy is set to **In force**, the old one becomes **Renewed** and its renewal **Bound**. A policy can be renewed once; the new term is renewed in turn.

The policy owner is reminded 90, 60 and 30 days before a policy expires, until its renewal is **Bound** or **Not renewing**, and 14 and 3 days before the renewal application is due and on the day, until it is submitted. Policy expiry and application dates appear in the owner's **My work** and in the compliance calendar.

### Premium allocation

A policy's **Premium allocation** tab splits its premium across **shares**: each share names one **department**, **site**, **asset** or **vehicle**. Select **New premium share** to add one, or **Add covered records** to add a share for every site, asset and vehicle the policy covers. Choose how the premium is split under **How the premium is split** (**Edit**):

- **Equally**: every share takes the same part.
- **By a measure**: each share takes its part in proportion to a number you give it (vehicles, payroll, floor area); **Measure counted** says what the number counts.
- **By insured value**: each share takes its part in proportion to the insured value of this policy's [schedule of values](#schedule-of-values) that belongs to it (the scheduled properties of that department, site, asset or vehicle).
- **By hand**: each share takes the percentage you enter (**Share by hand (%)**); the percentages cannot add up to more than 100%, and what is left is shown as **Not allocated**.

Each share shows its **Share (%)** and the **Premium allocated**, worked out again whenever a share, the premium, the method or the schedule of values changes. Amounts are rounded to cents and add up to the premium exactly (the largest share takes the rounding). The tab also shows the premium, what is allocated and what is not.

The **Premium allocation** tab of the area adds up the premiums of every policy in force by **department**, **site**, **asset** or **vehicle**, with the amount for each line of coverage; filter it by line, and select **Download CSV** (`insurance.export`) for the finance team. It counts every policy, so it is the same for everyone.

### Schedule of values

The **Schedule of values** tab lists the property the program insures (`SOV-` numbers): each building, its contents, equipment or vehicle, with its **Policy**, the **Site**, **Asset** or **Vehicle** it is, its **Department**, **Address or location**, **Occupancy or use**, **Construction**, **Year built** and **Floor area**, and its **Building value**, **Contents value**, **Equipment value** and **Business income value**. The **Total insured value** is worked out from the values. Record the **Valuation basis** (replacement cost, actual cash value, agreed, appraised or book value; your own list) and the day it was **Valued on**, and attach appraisals on its **Evidence files** tab.

The tiles show the total insured value, buildings and contents, equipment and business income, and **Valuation due**: properties not valued in the last three years (or never). Export the list (CSV, Excel or PDF) for the insurer or the risk pool, with the columns you choose. A policy's **Schedule of values** tab lists its own properties; **Add covered records** adds the sites, assets and vehicles the policy covers, so you only fill in their values.

## Certificates of insurance

The **Certificates** tab lists the certificates of insurance received from vendors and contractors. Select **New** (or **Create > Certificate of insurance**). A certificate (`COI-` numbers) has the **Vendor** and the **Contract** whose requirements it answers (the contract's vendor is filled in for you), or the **Insured** by name; the **Line of coverage**, **Insurer**, **Policy number**, **Coverage from** and **Expires**; the **Limit per occurrence** and **Aggregate limit**; whether the organization is **named as additional insured** and has a **waiver of subrogation**; when it was **Received**; its **Status** (**Requested**, **Sent by the vendor, to review**, **Received**, **Accepted**, **Rejected** or **Superseded**); and who **follows it up**. The title is made from the vendor and the line when you leave it empty. Attach the certificate itself on its **Evidence files** tab.

When a newer certificate for the same vendor, contract and line is received, the older ones become **Superseded**.

### Asking a vendor for certificates

The **Requests** tab lists the requests to vendors for their certificates of insurance (`CIR-` numbers). On a contract's **Insurance** tab select **Ask for certificates**, or on the **Requests** tab select **New** (or **Create > Certificate request**, or **Ask a vendor** on the **Certificates** tab). A request has the **Vendor** or the **Contract** (its vendor is filled in), the **Lines of coverage asked for** (those the contract requires when you leave it empty), the address it is **Sent to**, the **Recipient**, the date it is **Needed by**, a **Message** of your own and who **follows it up**.

Select **Send** on the request (the contract's dialog sends it at once). The application emails the vendor, through your own mail server set up under **Administration > Email** (no outside service), a message naming your organization, the vendor, the contract, the lines asked for and the date needed, with a **personal upload link**. The vendor opens the link without an account, sees what the contract requires of each line, and sends each certificate: the file (a PDF or a picture, checked like any upload: type, content, malware scanner, size; at most 10 files and 25 MB a link) with its line of coverage, insurer, policy number, dates, limits, and whether your organization is named as additional insured and there is a waiver of subrogation. When they are done they select **I have sent them all**; the link then stops working and the request becomes **Certificates received**.

Each certificate sent this way arrives on the **Certificates** tab as **Sent by the vendor, to review**, with the file on its **Evidence files** tab and the request named under **From request**; the person following the request up is told. Check the details against the file and set the status to **Accepted** (the certificate is then checked against the contract) or **Rejected**. A certificate waiting for review is not counted as on file.

The link works until it expires (30 days as installed), the request is canceled or requests are switched off. Before it expires the vendor is emailed a reminder with the same link, 7 and 2 days before as installed (**Settings**); **Send a reminder** on the request sends one now, and **Send again** gives the vendor a new link (the earlier one stops working). **Cancel request** stops the link at once. At most five emails a day go out for one request. The request shows when it was sent, when the vendor opened the link, the reminders sent, when the vendor finished and the certificates received.

Requests start **switched off**: an administrator switches them on under **Settings** (confirming their password), since the link lets someone outside the organization send files. Switching them off stops every link at once. Email must be set up for a request to be sent; until then a request is kept as **Not sent yet**.

**About the link.** The link carries a long random secret. Only a fingerprint of it is kept to check it, and the secret itself is kept encrypted with your installation's key so that a reminder can carry the same link; it never appears in the application's pages, the delivery log or the audit log. It is in the part of the address after `#`, which browsers never send to a server, so it is not written to web server logs either. A wrong or expired link answers the same "not valid" message, and too many wrong tries from one address are refused for a while.

### What each contract requires

A contract's own page has an **Insurance** tab (while the insurance part is on and you may see it) listing what the contract requires, the state of each requirement against the certificates on file, those certificates with their check, and the requests sent to the vendor, with **Add requirement**, **Add certificate** and **Ask for certificates**.

The **Contract requirements** tab lists the insurance each contract requires of its vendor: one requirement per line of coverage, with the **Minimum per occurrence**, **Minimum aggregate**, and whether the organization must be **named as additional insured** and have a **waiver of subrogation**. Add one with **New**: choose the contract and the line.

Every certificate received or accepted is checked against the requirements of its contract (or, when it names no contract, of its vendor's contracts) for the same line:

- **Against the contract** on the certificate says **Meets the contract**, **Short of the contract** (with what falls short, for example "Limit per occurrence 1,000,000 is below the required 2,000,000; the organization is not named as additional insured"), **Expired**, or **No requirement on file**. A certificate short of its contract shows a warning at the top of its page, and its **Contract requirements** tab lists what the contract requires.
- **Certificates on file** on the requirement says **Met**, **Shortfall** (with what is missing), **Certificate expired** or **No certificate**.

The check runs whenever a certificate or a requirement changes, and every day, since certificates expire by themselves. The person following a certificate up (or, without one, whoever added it) is reminded 30 days before it expires and on the day, and certificates about to expire appear in their **My work** and in the compliance calendar.

## Claims

The **Claims** tab lists claims under the organization's policies and against it. Select **New** (or **Create > Insurance claim**). A claim (`ICL-` numbers) has a short **Claim** title, the **Policy**, its **Kind** (property damage, vehicle collision or damage, bodily injury, workers' compensation, cyber incident, other liability, crime or theft, other), whether it is **Made** against the organization, by it under its own policy, or by it against another party; its **Status** (**Open**, **Under investigation**, **In litigation**, **Closed**, **Denied**, **Withdrawn**); the **Incident date**, when it was **Reported to the insurer**, the **Claimant**, the insurer's claim number and the adjuster; **What happened**; the **Safety event**, **Security incident**, **Asset**, **Vehicle** or **Site** it arose from; the **Reserve**; when it **Closed**; and who handles it.

### Payments and recoveries

A claim's **Payments** tab lists each payment made on it and each recovery received, one by one: the **Date**, the **Kind** (payment to the claimant, medical payment, repair or replacement, claim expense, deductible or retention paid, other payment; or received from the insurer, recovered from another party, salvage, other recovery; your own list, **Claim payment kinds**), who was **Paid to or received from**, the **Amount**, a **Reference** (check, transfer or remittance number), a note and who recorded it. Select **New claim payment** to add one. The claim's **Paid to date** and **Recovered** are worked out from them, with the **Net cost** (paid less recovered), and change as payments are added, changed or deleted. The payments of a restricted claim are restricted with it. The list can be filtered and exported like any other.

Claims that had totals before payments were listed one by one keep them as one opening row each ("Paid before payments were listed", "Recovered before payments were listed").

A claim is reported to the insurer on the day it is added unless you give the date, and closing it records the day it closed unless you give one.

**Restriction.** Claims often hold personal or security details. Claims of the kinds bodily injury, workers' compensation and cyber incident start **restricted**, as does a claim linked to a security incident or to a restricted safety event: only people with access to restricted records (`security.view`) see them. Only those people may lift the flag or link a security incident. The figures still count every claim, so they are the same for everyone.

## Renewals

The **Renewals** tab is the renewal calendar: month by month, every policy that expires, every renewal application due and every vendor certificate of insurance that expires, starting a month ago, for the next three months to two years. Dates already past are marked **Past**. Each line opens its policy or certificate.

## Figures

The tiles at the top of each tab count every record, restricted claims included, so they are the same for everyone:

- **Policies**: **Policies in force** (with their premium), **Expiring soon** (within 90 days), **Renewal applications overdue**, and **Conditions not met** (not met or partly met, on policies in force or being placed).
- **Certificates**: **Expired** (still on file, coverage ended), **Expire within 30 days**, **Short of the contract**, **Contract requirements not met** (missing, expired or short), and **Sent by vendors, to review** (with the requests still waiting for the vendor).
- **Schedule of values**: the total insured value, buildings and contents, equipment and business income, and **Valuation due**.
- **Claims**: **Open claims**, **Reserves on open claims**, **Paid** and **Recovered** (from the payments listed).

Four monthly figures are offered to indicators, dashboards and figures over time: `insurance.policies_expiring` (policies expiring within 90 days), `insurance.certificates_expired`, `insurance.open_claims` and `insurance.open_reserves`.

## Settings

The **Settings** tab (`insurance.administer`; also under **Administration > Area settings**) sets when owners are reminded: days before a policy expires (90, 60, 30 as installed), before the renewal application is due (14, 3, 0) before a certificate of insurance expires (30, 0), and when a vendor is reminded before a certificate request's link expires (7, 2). Give whole numbers of days separated by commas; each step reminds once per date. **Certificate requests to vendors** switches requests on or off and sets how long a new link works (1 to 90 days). It also links to the insurance lists (lines of coverage, statuses, renewal steps, claim kinds, claim payment kinds, premium split methods, valuation bases and so on) under **Administration > Lists**.

## Loading past records

In data load mode (see [Administration](09-administration.md)), an administrator can load past policies and claims with their own dates and statuses: an expired or renewed policy with its term, a closed claim with its incident and closing dates, its payments and recoveries one by one (or its totals, which become opening rows), premium shares and scheduled properties, past certificate requests with their status, and the person who did the work (a payment records the person the load names). Nothing is worked out from today during a load: a closed claim keeps the closing date given (or none), a claim keeps an empty "reported" date, a certificate keeps an empty "received" date, and a new term does not close the term before it. No reminders are sent for loaded records, and a request cannot be emailed while data load mode is on.

## AI assistants and the API

Policies (`insurance_policy`, `/api/insurance/policies`), policy conditions (`insurance_condition`), certificates (`insurance_certificate`), contract requirements (`insurance_requirement`), claims (`insurance_claim`), claim payments (`insurance_claim_payment`), premium shares (`insurance_premium_share`), scheduled properties (`insurance_schedule_item`) and certificate requests (`insurance_certificate_request`) are ordinary record types: they can be listed, searched, exported and imported like any other, and an AI assistant connected under **AI assistant access** finds and creates them with its record tools. The other routes are `GET /api/insurance/summary`, `GET /api/insurance/renewals`, `GET /api/insurance/policies/:id/conditions`, `GET/POST/DELETE /api/insurance/policies/:id/covered`, `GET /api/insurance/covering`, `POST /api/insurance/policies/:id/renew`, `GET /api/insurance/contracts/:id/check`, `GET /api/insurance/policies/:id/allocation`, `POST /api/insurance/policies/:id/allocation/from-covered`, `GET /api/insurance/allocation`, `GET /api/insurance/schedule/summary`, `POST /api/insurance/policies/:id/schedule/from-covered`, `GET/PUT /api/insurance/certificate-requests/settings`, `POST /api/insurance/certificate-requests/:id/send` and `/remind`, the vendor's routes under `/api/insurance/certificate-upload` (no account; the link's secret in the `X-Upload-Token` header) and `GET/PUT /api/insurance/settings` (see the [integration guide](../api.md)).

## Sample data

The `dev` sample data adds invented policies ("[Sample] Cyber liability" with three security conditions, two tracked by sample controls; "[Sample] Property and equipment" and "[Sample] Auto liability and physical damage" with covered sites and vehicles; "[Sample] General liability" renewing its previous term), three claims (one restricted) with their payments and recoveries one by one, a schedule of values for three sample sites on the property policy (its premium split by insured value) and the auto policy's premium split by vehicles at two sites, and, once sample vendors exist, contract requirements and certificates for two sample contracts (one short of its contract and two expired) and two certificate requests: one the vendor answered, its certificate waiting for review, and one not sent yet. The sample data sends no email.
