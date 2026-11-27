# Controls and testing

The control library keeps one list of your organization's **controls**: the checks, safeguards and routines that keep risks in hand, such as a second factor on remote access, a backup restore test, a pre-service vehicle check or a weekly track switch inspection. For each control it records what the control **covers** (risks, hazards, framework outcomes, obligations and policies), and it holds the **tests** that show whether the control is designed well and works in practice. Test a control once, and every record it covers benefits.

Open the pages from **Risk and compliance > Controls** in the navigation. The pages share tabs along the top: **Dashboard**, **Controls**, **Tests** and **Coverage**. Lists and record pages work as described in [Getting started](01-getting-started.md).

If your organization does not use the control library, an administrator can switch **Control library and testing** off under **Administration > Features** (see [Administration](09-administration.md#features)). The pages, their reminders and their notifications then disappear. Records are kept and return when it is switched back on.

You need the **controls** permissions: `controls.view` to read, `controls.create`, `controls.edit` and `controls.delete` to keep the library and record tests, `controls.export` to export, and `controls.approve` to review and sign off a test. Raising a corrective action plan from a failed test also needs `actions.create`.

The default **Security lead**, **Compliance officer** and **Audit lead** roles hold all of the controls permissions; the **Auditor** role can read and export them. An administrator can grant them to any other role under **Administration > Roles**.

## The controls dashboard

Open **Controls**, then the **Dashboard** tab. The figures count every control and test and are the same for everyone:

- Tiles for **Controls in use** (and how many are key controls), **Ineffective**, **Tests overdue** (and how many more are due in the next 30 days), **Not tested yet** and **Awaiting review** (and how many tests are planned or in progress). Each tile opens the records behind it.
- **Operating ratings**: how many controls in use rate **Effective**, **Partly effective** or **Ineffective** on their newest reviewed operating test, and how many have not been tested yet. Select a bar to open those controls.
- **Tests reviewed by month**: the last twelve months of reviewed tests, by result.
- **Tests due**: the controls whose next test is due within 30 days or is overdue.
- **What the controls cover**: for each kind of record you can see, how many are covered by a control, and how many rely on an ineffective one.

## The control library

Open **Controls**. Filter by status, domain, type, automation, how often the control operates, key control, ratings, owner or next test date.

### Add a control

1. Select **New control**, or **Create** then **Control**.
2. Enter the **Control** (its name), its **Objective** (what it achieves) and **How it works**.
3. Choose its **Type** (**Preventive**, **Detective** or **Corrective**), **Automation** (**Manual**, **Automated** or **IT-dependent manual**), **How often it operates** (from **Continuous** to **As needed**) and **Domain** (**Cybersecurity**, **Safety**, **Financial**, **Operational** or **Compliance**).
4. Choose the **Owner** (who answers for the control) and **Operated by** (who carries it out). Tick **Key control** for the controls the organization relies on most.
5. Set **Test every (months)** (12 unless changed, from 1 to 120) and, for a control that has not been tested yet, the **Next test due**.
6. Leave the **Status** as **Draft** until the control is in place, then set it to **Active**. A control that is no longer used is **Retired**: it is left out of the coverage view, the figures and the reminders.
7. Select **Create control**.

The control gets a reference such as `CTL-00001`. Its page shows the details, **Ratings and testing**, and the tabs **Coverage**, **Test steps**, **Tests**, **Activity**, **Evidence files**, **Related** and **History**. Files attached to a control are evidence (for example the written procedure or a configuration screenshot).

### Ratings and the test schedule

A control's **Design rating** and **Operating rating** cannot be typed in: they come from its newest reviewed **design** test and its newest reviewed **operating** test. **Last tested** is the date of the newest reviewed test, and the **Next test due** is **Test every (months)** after that. Changing the interval moves the next test date at once. Deleting a reviewed test works the ratings out again from the tests that are left.

### Written test steps

The **Test steps** tab of a control holds the steps a tester follows to test it, in order, so that every tester does it the same way. Select **Add a step**, write **What the tester does** (for example "Pick ten shifts at random from the roster") and, if you like, **What they should find** (for example "Each shift has a signed lockout record"), and select **Save**. Use the arrows to change the order, the pencil to change a step and **×** to remove one. You need `controls.edit`.

Each new test of the control starts with a copy of these steps. Changing the steps later does not change tests already recorded; a test started before a step was added offers a button on its own **Test steps** tab to copy the new steps from the control.

## What a control covers

The **Coverage** tab of a control lists the records it covers: risks, hazards, framework outcomes, obligations, policies and OT security zones ([OT security](32-ot-security.md)). To add one, choose the **Kind of record**, search for the **Record** and select **Add coverage**. Select **×** beside a record to stop covering it; neither record is otherwise changed.

Coverage is a link between the two records, so it also shows on the covered record's **Related** tab, as **covers**.

Only records you may see are listed or offered. Risks, and OT zones marked restricted, are restricted records: someone without security access does not see the risks a control covers, cannot add or remove them, and does not find them in the coverage view; the control's history never names them either (adding or removing coverage of a restricted record is recorded in that record's own history). A kind of record whose area is switched off, or that your role cannot open, is not offered.

### Where controls show

The controls covering a record are also listed on that record's own page, in a **Controls** card with each control's last result, its state (the same states as the coverage view below) and its next test date; the card's heading shows the weakest state:

- a **risk**: on its main page, under the treatment plan;
- a **hazard**: on its main page, under the scoring;
- a **framework outcome**: on its main page, under "Where we are going";
- an **obligation**: on its **Periods** tab, under "Applies to";
- a **policy**: on its **Policy** tab, beside the text, under who must acknowledge it;
- an **OT security zone**: on its page ([OT security](32-ot-security.md)).

The card shows only to people who may see controls, and not at all while the control library is switched off. It lists only controls; to add or remove coverage, open the control's **Coverage** tab.

## Testing a control

Open **Control tests** (or a control's **Tests** tab, which fills in the control for you).

### Plan and record a test

1. Select **New control test**, or **Create** then **Control test**.
2. Choose the **Control** and what the test is of: **Design** (would the control work as described?) or **Operating** (did it work, over a period?).
3. Enter **Planned for**, the **Period from** and **Period to** that an operating test covers, the **Tester** and the **Method** (**Inquiry**, **Observation**, **Inspection of records** or **Reperformance**), and describe the **Population** (everything the sample is drawn from, for example "every remote-access sign-in in the quarter").
4. Select **Create control test**. The test gets a reference such as `CTT-00001` and the status **Planned**; set it to **In progress** when testing starts.

On the **Test steps** tab, give each written step its result, **Passed**, **Failed** or **Not applicable**, and a note on what you found; the note is saved when you leave the box, and the step shows who gave the result and when. A bar shows how many steps have a result and how many failed. A test of a control with no written steps shows none.

On the **Items sampled** tab, list each item the test looked at (a log entry, a ticket, a vehicle check sheet) with its result, **No exception** or **Exception**, and a note. Once there are items, **Items sampled** and **Exceptions found** follow the list. You can also type the two numbers instead; there cannot be more exceptions than items. Attach the evidence (exports, screenshots, signed sheets) on the **Evidence files** tab.

### Finish and sign off

When the testing is done, set the **Result** (**Effective**, **Partly effective** or **Ineffective**), the **Performed on** date (not in the future) and the **Conclusion**, and set the status to **Awaiting review**. A result other than effective needs a conclusion, and every written test step needs its result first.

The status **Reviewed** cannot be chosen by hand. Someone other than the tester, holding `controls.approve`, opens the test and selects **Review and sign off**, adds an optional note and selects **Sign off**. The test is then final: it cannot be changed, and its test steps and sampled items are fixed. The result rolls up to the control's ratings and next test date. The tester (or, when none is named, whoever recorded the test) cannot sign off their own test.

### When a test fails

When a test rated **Ineffective** is signed off:

- every open risk and hazard the control covers is due for review today (its **Next review** or **Review date** is set to today, unless it is already due), and
- the owner of each one is told (or, for a record with no owner, everyone who may edit that kind of record), under the **Controls** notification kind. Only people who may see the record are told.

The test records the day this happened (**Covered records flagged on**).

For a test rated **Ineffective** or **Partly effective**, **Raise a corrective action plan** creates a plan in the action tracker with the test as its source, a problem statement taken from the test, and the control's owner as responsible; it opens the plan so you can add its actions and submit it for approval. Each test has at most one plan raised this way, and the **Corrective action plans** tab lists every plan raised on the test. See [Corrective action plans](24-corrective-action-plans.md).

## The coverage view

Open the **Coverage** tab. It lists every covered record you may see, worst first, with the controls it relies on and its **Weakest control**:

- **Ineffective**: a control's newest reviewed test found it ineffective.
- **Test overdue**: a control's next test date has passed.
- **Not tested**: a control has no reviewed test of its operation yet.
- **Partly effective**: a control's newest reviewed test found exceptions.
- **Effective**: every control it relies on is effective and up to date.

Select the boxes at the top to show only records in those states, and **Kinds of record** to show only risks, hazards and so on. Retired controls are left out. The boxes count every covered record you may see; the list shows 200 at a time, with page numbers under it when there are more.

## Reminders

The owner of each control in use is told when its next test is coming up and again when it is due or overdue (a control with no owner goes to everyone who may edit controls). The lead time is **Remind control owners before a test is due**, 14 days unless an administrator changes it under **Administration > Reminders**. Each due date is announced at most twice; a new due date starts again. The check runs every hour (job `controls.tests_due` under **Administration > Background jobs**).

## Importing a control catalog

No standard's catalog text is shipped: load your own. On the **Controls** list, select **Import**, then **Download a template**: a CSV with a column for every field that can be imported. The useful columns are **Control**, **Objective**, **How it works**, **Type**, **Automation**, **How often it operates**, **Domain**, **Owner**, **Operated by**, **Key control**, **Status**, **Test every (months)** and **Next test due**. Lists accept their value or label (for example `Preventive` or `preventive`), people their user name, email address or name, and **Key control** yes or no. The ratings and last test date are not imported: they come from tests. Control tests can be imported the same way from the **Control tests** list (by the control's reference or name), but not as **Reviewed**. See [Importing and exporting](17-importing-and-exporting.md#importing-records).

### Importing coverage

To load what each control covers from a spreadsheet, open the **Coverage** tab and select **Import coverage** (you need `controls.edit`). The file (CSV or Excel, at most 5 MB and 5,000 rows) has one row for each control and a record it covers, with these columns:

- **Control**: the control's reference, such as `CTL-00012`, or its exact title;
- **Kind of record**: Risk, Hazard, Framework outcome, Obligation, Policy or OT security zone. It may be left out when the record is given by its reference;
- **Record**: the record's reference, such as `HAZ-00031`, or its exact title.

**Download a template** in the dialog gives a file with these headers. Select **Check the file**: the check lists every row with what it would do, **Will be added**, **Already there** or **Not imported** with the reason (no such control, a kind of record that is not offered, no such record, or a title that more than one record has). Then select **Add** (it names how many links) to add them. Coverage is only ever added: rows already there are left as they are, and nothing missing from the file is removed. Only records you may see can be matched; a restricted record you may not see reads exactly like one that does not exist. Each link added is in the control's history (or, for a restricted record, in that record's own history), and the import as a whole in the audit log.

## Figures for indicators

The control library offers two monthly figures that computed safety performance indicators and key risk indicators can use: **Control tests overdue** (`controls.tests_overdue`: controls in use whose next test was overdue at the end of the month) and **Ineffective controls** (`controls.ineffective`: controls in use whose newest reviewed design or operating test by the end of the month was ineffective). Like every figure, they count every control and are the same for everyone.

## Sample data

The `dev` seed profile loads twenty invented controls (marked "Invented sample control"), thirty tests over the past year (three of them ineffective, each with a corrective action plan when the action tracker is installed), written test steps for the pre-service vehicle check and the backup restore test, and coverage of the sample risks, hazards, framework outcomes, obligations and policies that match them.

## Not available yet

- Sampling from a population automatically.
