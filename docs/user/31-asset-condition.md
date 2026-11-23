# Asset condition

Asset condition helps you keep the organization's vehicles, equipment, facilities and infrastructure in a **state of good repair**. Each **asset class** (a 40-foot bus, a passenger station, a track segment) carries a **useful-life benchmark** in years, and for vehicles in miles as well. The application works out when each vehicle, asset or site reaches the end of its useful life, keeps the newest **condition assessment** on its page, and shows, class by class, how much of the fleet and estate is past its useful life against the **yearly target** your organization set.

Open **Asset condition** from the **Inventory** group in the navigation. The pages share tabs along the top: **Dashboard**, **Asset classes**, **Assessments** and **Aging**. Lists and record pages work as described in [Getting started](01-getting-started.md).

If your organization does not track condition here, an administrator can switch **Asset condition and state of good repair** off under **Administration > Features** (see [Administration](09-administration.md#features)). The pages, the **Condition** sections on vehicles, assets and sites, the condition fields (class, condition, end of useful life, replacement project, kind of site, year built, odometer), the reminders and the calendar entries then disappear. Records and values are kept and return when it is switched back on. While **Fleet and services** is switched off, asset condition carries on for assets and sites, and its pages and reminder settings no longer mention vehicles.

## Who can do what

Asset condition shares the inventory and fleet permissions:

- Asset classes and condition assessments are filed under **assets**: `assets.view` to read them and the dashboard, `assets.create` to add a class or record an assessment, `assets.edit` to change them and set targets, `assets.delete`, `assets.export`, and `assets.approve` to approve a yearly target.
- An assessment of a **vehicle** is shown only to people who may also see vehicles (`fleet.view`), and one of a **site** only to people who may also see sites (`sites.view`). They are still counted in every figure, which is the same for everyone.
- Putting a record in a class, or recording its kind, year built or odometer, is an edit of that record: `assets.edit`, `fleet.edit` or `sites.edit`.

The default **Asset manager** role holds all of the assets, sites and fleet permissions, and can read projects and funding. The **Agent** role can work with assets and sites, and the **Approver** role can approve targets (`assets.approve`). An administrator can grant these permissions to any other role under **Administration > Roles**.

## The dashboard

Open **Asset condition**. Choose the **Year** at the top right: a past year is taken on its last day, this year on today, and a later year is a **projection** with today's records and their useful life as it stands.

- Tiles for **Past useful life** (the share of every classed record in use whose useful life has ended, and how many), **Over target** (classes past their yearly target), **Poor condition** (the share of rated records whose condition is at or below their class's poor rating), **With a replacement project** and **No asset class** (records in use that are not counted yet).
- **Past useful life by class**: a bar per class with its target marked. Select a bar to open the class's members.
- **Trend**: the share past useful life over ten years; starred years are projections.
- **By class**: for each class, the records in use, how many are past useful life (and the share, highlighted when it is over the target), the target (marked **Draft** or **Waiting** until it is approved), poor condition, records not rated yet, average age and how many of those past useful life have a replacement project. Where funding and grants are in use, a **Funded** column counts those linked to a funding award.

Retired vehicles, disposed assets and sites no longer in use are left out of every figure. The figures count every record, whoever is looking.

## Asset classes

Open the **Asset classes** tab. Select **New asset class**, or **Create** then **Asset class**:

1. Enter the **Name**, and choose what it **Rates**: **Vehicle**, **Asset** or **Site**. A class rates one kind of record, and cannot change kind while records belong to it.
2. Choose the **Category**: **Rolling stock**, **Equipment**, **Facilities**, **Infrastructure** or **IT and technology** (an administrator can rename or add categories under **Administration > Lists**).
3. Enter the **Useful life (years)**. For vehicles you may also enter the **Useful life (miles)**.
4. **Poor at or below rating** says which ratings count as poor condition (2 unless changed: **2 - Marginal** and **1 - Poor**).
5. **Assess every (months)** is how often its members should be assessed; leave it empty to use the general setting (24 months).
6. Choose an **Owner**: the person reminded when assessments are due, and whose calendar feed lists them.
7. **Suggested for** lists the values that suggest this class, for example `{"vehicle_mode": ["bus"]}`, `{"asset_type": ["farebox"]}` or `{"site_kind": ["passenger_station"]}`. When a vehicle, asset or site of that mode, type or kind has another class or none, its Condition section names the suggested class.
8. Select **Create asset class**.

The class gets a reference such as `ACL-00001`. Its page has the details and the tabs **Targets by year** and **Members**. A class that is no longer used can be marked not **Active**: it is left out of the dashboard and suggestions, and its members are no longer reminded.

### Facilities and infrastructure

Stations, depots, maintenance facilities, guideway, track segments, substations, bridges and other structures are **sites** with a **Kind of site** and a **Year built**; equipment such as switches and turnouts, traction power and signal equipment, elevators and escalators are **assets** with their own types. Both are rated like vehicles: create a class that rates sites (or assets) and put them in it.

## Putting a record in a class

Vehicles (on their **Condition** tab), assets and sites (under their summary) show a **Condition** section to people who may view assets: the **Asset class**, the latest **Condition** and when it was assessed, the **End of useful life** (marked **Past useful life**, or **Ends within a year**), the **Replacement project**, and the record's assessments, newest first.

Select **Edit condition details** to choose the **Asset class** and the facts the useful life counts from:

- an asset's **In service since** (its **Purchase date** stands in when it is empty);
- a vehicle's **In service since** (its **Model year** stands in), on the vehicle's **Details**, and its **Odometer (miles)**;
- a site's **Year built**, with its **Kind of site** and whether it is still **In use**;
- the **Replacement project**: the project that will replace it.

Then select **Save changes**.

### How the end of useful life is worked out

The end of useful life is the date the record counts from plus the class's useful life in years. For a vehicle whose class also has a useful life in miles, the application also works out the day the vehicle reaches those miles at the rate it has run so far (from its odometer and the day the odometer was last changed, shown as **Read on**); the earlier of the two dates wins. It is worked out again whenever the class's benchmark, the dates or the odometer change, and every night. A record whose class needs a date it does not have shows no end of useful life and is not counted as past it. **Recompute useful life** on a class's **Members** tab does it at once.

## Condition assessments

Select **Record assessment** in a record's Condition section:

1. The **Assessed on** date (today unless changed; not in the future).
2. The **Condition**, on a scale from **5 - Excellent** to **1 - Poor**. An administrator can rename the levels under **Administration > Lists**.
3. The **Method**: **Visual**, **Measured**, **Inspection report** or **Desktop review**.
4. The **Assessor**: you, unless you choose someone else, or a name for an assessor who is not a user. Add any **Notes**.
5. Select **Save assessment**.

The newest assessment is shown on the record (its condition and date); recording an older one, or deleting the newest, keeps the record showing the newest one left. An assessment stays with the record it rates. Its page (reference `CND-00001`) has **Evidence files** for photographs or the inspection report, and **Raise an action** files a corrective action under **Asset condition** (see [Risks, actions and obligations](06-risks-actions-obligations.md)).

The **Assessments** tab lists every assessment you may see, newest first; filter it by kind of record, condition, class, method, assessor or date, and export it.

## Yearly targets

On a class's **Targets by year** tab, enter the **Year**, the **Target (%)** (the most of the class that may be past its useful life that year) and, if you like, a **Decision reference**, then select **Save target**. A new target is a **Draft**. To approve it:

- **Ask for approval** starts the **Asset condition targets** approval workflow (one step, decided by someone who may approve asset records, unless an administrator changes it under **Administration > Approval workflows**; see [Approval workflows](22-approval-workflows.md)). The target shows **Waiting for approval** until it is decided; a rejection makes it a draft again, with the reason in its note.
- **Approve now** (with `assets.approve`) approves it directly, for example after a committee meeting decided it; record the meeting decision as its **Decision reference**.

Changing an approved target's percentage makes it a draft again, and ends an approval still waiting.

## The aging list

Open the **Aging** tab: the vehicles, assets and sites with a class, soonest end of useful life first, with their class, age, condition, next assessment and replacement project. Choose when their useful life ends (**Already ended**, within 1, 2, 5 or 10 years, or any time), the class and the kind of record. Unlike the dashboard it lists only the records you may see. A class's **Members** tab is the same list for one class.

## Replacement projects and funding

A record's **Replacement project** is also shown on its **Related** tab, and on the project's, with the relation `replaced_by`. Where funding and grants are in use, link a vehicle or asset to the funding award behind it from the award's page (see [Funding and grants](27-funding-and-grants.md)); the dashboard counts the records past useful life that are linked to an award.

## Reminders, calendar and figures

- **Reminders**: when a record's next assessment (its last assessment plus the class's interval) is due within **Remind before a condition assessment is due** (30 days unless an administrator changes it under **Administration > Reminders**), or has passed, the class's owner (or, with no owner, everyone who may edit assets) gets one notification per class saying how many are due. Each record and due date is reminded once. Records never assessed are not reminded: find them on the aging list. The general interval is **Time between condition assessments** (24 months). The check runs daily (job `condition.reminders` under **Administration > Background jobs**), and the useful life is worked out again every night (job `condition.recompute`).
- **Calendar feed**: the source **Condition assessments due** lists the next assessments of the classes you own and of the assets you own.
- **Figures for indicators**: **Share past useful life** (`condition.past_useful_life_pct`) and **Share in poor condition** (`condition.poor_condition_pct`), monthly, for computed safety performance indicators and key risk indicators. Like every figure, they count every record.
- **AI assistants** can read the state-of-good-repair summary (figures by class, never names).

## Sample data

The `dev` sample profile loads nine invented classes (40-foot bus, cutaway, light rail vehicle, heavy rail car, passenger station, maintenance facility, track segment, traction power substation and farebox, each labeled "(sample)") with targets for this year and last year, puts every sample vehicle, the sample stations, depots, track segments and substations and the fareboxes in a class, records an assessment for each, and links three sample replacement projects.

## Not available yet

- Maintenance work orders and inspection schedules for vehicles and facilities: they belong in a maintenance management system (not planned).
- Condition history drawn as a chart on a record: the assessments are listed instead.
- Useful life of a class that changes over time: a class has one benchmark, and changing it recomputes every member.
