# Risks, actions and obligations

This page covers the risk register, the action tracker, the obligations register and regulatory changes. The **Risk register** (with the tabs **Register**, **Reviews**, **Indicators**, **Report** and, for people who administer risks, **Scales** and **Appetite**), **Obligations** (with the **Regulatory changes** tab) and **Action tracker** (with the **Corrective action plans** tab) are in the **Risk and compliance** group of the menu; **My actions** is a tab of **My work**, and the scales and appetite are also on the **Administration** page.

An administrator can switch the risk register and obligations off under **Administration > Features** (see [Administration](09-administration.md#features)); the action tracker always stays on. Records are kept and return when they are switched back on.

- The **Risk register** records what could go wrong, how serious it is and what is being done about it.
- The **Action tracker** is the single to-do list for follow-up work arising anywhere in the application.
- **Obligations** lists the things your organization is required to do, how often, how each is met and when it is next due, with a history of each period attested.
- **Regulatory changes** records new or changed requirements, what they mean for the organization and how they are put into effect.

## Who can see risks

Risks are **restricted records**. A person sees the risk register only if their roles give them both of these permissions:

- **View** on **Risks**
- **View** on **Security incidents and restricted records**

Without both, risks do not appear anywhere for that person: not in the register, the heat map, counts, search results, related-record links, reports or exports. The register carries the line "Restricted: visible only to people with access to security records" as a reminder.

Key risk indicators and the risk appetite follow the same rule: they need both permissions too.

Asking for a risk to be accepted needs **Edit** on **Risks**; deciding a request, recording an acceptance by hand or revoking one needs **Approve** on **Risks**. Editing the risk scales and the risk appetite needs **Administer** on **Risks**. Roles are managed by an administrator; see [Administration](09-administration.md).

Obligations and regulatory changes are not restricted. An action is restricted when the record it was raised from is: an action raised from a risk, a security incident or any other restricted record is hidden from people without **View** on **Security incidents and restricted records**, including its owner. It still counts in the action tracker's tiles, which are the same for everyone, so a tile can be higher than the list you see. Such an action can be shared with one named person; see "Sharing a restricted action" below. Other actions are visible to anyone with **View** on **Actions**. You cannot raise an action on, or move one to, a record you cannot see.

## The risk register

Open **Risk and compliance > Risk register**. From top to bottom the page has:

- a **summary strip**: **Open risks** (with how many are above the risk appetite), the number at the two highest common levels (**Critical** and **High**), **Reviews due** and **Acceptances to renew**. Select a tile to go to the matching list;
- the **Heat map** card, with the ranked risks beside it;
- the list of risks.

Tabs under the title open **Register**, **Reviews**, **Report** and, for administrators of risks, **Scales** and **Appetite**. **Print** and **New risk** are at the top. The **Critical** and **High** tiles count risks at that common level across every scale. A scale may call the level something else: the tile then says so, for example "Includes Extreme on the heat map".

### The two scales

A risk is scored on a scale: a grid of likelihood against impact, where each cell gives a rating. Two scales are supplied, and the risk's **Category** decides which one is used.

| Scale | Used for categories | Down the side | Along the bottom | Ratings, lowest to highest |
|---|---|---|---|---|
| **Cyber and enterprise risk (5 by 5)** | Cybersecurity, Enterprise, Third party, Compliance | Likelihood: Rare, Unlikely, Possible, Likely, Almost certain | Impact: Insignificant, Minor, Moderate, Major, Severe | Low, Medium, High, Extreme |
| **Safety hazard matrix (4 by 5)** | Safety | Likelihood: Improbable, Remote, Occasional, Probable, Frequent | Severity: Negligible, Marginal, Critical, Catastrophic | Low, Medium, Serious, High |

On the 5 by 5 scale each level counts from 1 to 5 and the rating comes from likelihood multiplied by impact: 1 to 4 is Low, 5 to 9 is Medium, 10 to 19 is High, and 20 or 25 is Extreme.

The **safety hazard matrix** is the four-severity by five-likelihood matrix used in transit safety management. Use it for hazards to passengers, staff and the public that technology can cause or worsen, for example a door controller that fails locked or a signal priority link that drops at a busy junction. It does not use multiplication; each cell is set individually:

| Likelihood | Negligible | Marginal | Critical | Catastrophic |
|---|---|---|---|---|
| Frequent | Medium | Serious | High | High |
| Probable | Medium | Serious | High | High |
| Occasional | Low | Medium | Serious | High |
| Remote | Low | Medium | Medium | Serious |
| Improbable | Low | Medium | Medium | Medium |

Hover over a level name on the heat map to read what it means, for example "Likely: Expected about once a year". An administrator can change both scales, or add more; see "Editing the risk scales" below.

So that risks on different scales can be counted together, every rating also maps to one of four **common levels**:

| Common level | 5 by 5 rating | Safety hazard rating |
|---|---|---|
| Low | Low | Low |
| Medium | Medium | Medium |
| High | High | Serious |
| Critical | Extreme | High |

### Inherent and residual risk

Each risk can be scored twice:

- **Inherent risk** is the risk before existing controls: how bad it would be if nothing were in place.
- **Residual risk** is the risk with existing controls in place: where you stand today.

The difference between the two shows how much your controls are doing. The register is sorted by residual risk, highest first.

### Reading the heat map

The **Heat map** card shows one scale at a time as a grid, with the worst likelihood at the top and the worst impact (or severity) on the right. The level names run down the side and along the bottom. Each cell is colored by the rating it gives, shows that rating's name in its top corner, and shows in large figures the number of risks in it. Cells with risks in them have a solid edge; empty cells are paler. The legend under the grid gives each rating's color and total, and **Not yet scored** counts risks on that scale with no score for the view you chose.

The controls at the top of the card:

1. **Scale**: choose **Cyber and enterprise risk**, **Safety hazard matrix** or **All scales** (with more than two scales, a drop-down list). The line above the grid names the scale and gives its description. A scale that belongs to a part switched off under **Administration > Features** (the safety hazard matrix while safety management is off) is not offered; a new risk in a category scored on it uses the cyber and enterprise scale.
2. **Residual** or **Inherent**: which score to plot.
3. **Show movement**: draws an arrow from each risk's inherent cell to its residual cell, so you can see where controls move risks. One arrow is drawn for each pair of cells, however many risks make that move. Risks whose two scores fall in the same cell have no arrow.
4. **Include closed risks**: closed risks are left out unless you switch this on. In the ranked list they then carry their **Closed** status.

**All scales** puts the risks of every scale on one five-by-five grid at the common levels (**Low**, **Medium**, **High**, **Critical**). Each scale's levels are spread from its lowest to its highest: the lowest level of every scale is **Lowest**, the highest is **Highest**, and the four severities of the safety hazard matrix fall at **Lowest**, **Low**, **High** and **Highest**. A cell with risks in it is colored by the most severe common level among them; an empty cell by the most severe common level any scale gives that part of its grid. The legend counts each risk at its own common level, so its totals match the **Critical** and **High** tiles above. The ranked list shows common levels too. It is a picture of where risks sit across the organization; to read a risk's exact rating, use its own scale. There is no appetite ring on this view, since each category's appetite is set on its own scale. **All scales** is offered when more than one scale is in use.

When a risk appetite is set for a category scored on the scale, a cell holding a risk that is above its own category's appetite has a **dashed ring** (the legend reads "Holds a risk above its category's appetite"). Where several categories with different appetites share a scale, the same cell can hold a risk above its appetite and another within its own, so the ring always agrees with the **Appetite** column of the risks in the cell; an empty cell never has one.

Beside the grid, **Highest residual risks** (or **Highest inherent risks**) ranks the scored risks on that scale, highest first, with the inherent and residual ratings and the owner. The first eight are listed; the rest are in the list below.

Everything you choose on the heat map is kept in the page address, so you can bookmark a view or send the link to a colleague who can see risks.

You can move around the grid with the arrow keys and choose a cell with Enter or Space.

### Drilling down from a cell

1. Select a cell that has a number in it. Empty cells cannot be selected. The other cells fade.
2. The ranked list is replaced by the risks in that cell, and the list of risks below shows only those risks, under a line such as "Showing 2 risks at Unlikely by Moderate (residual, Cyber and enterprise risk (5 by 5))".
3. Select the same cell again, or **Show all risks**, to return to the full list.

Changing the scale, the residual or inherent choice or **Include closed risks** clears the drill-down.

### Printing the register for a board pack

Select **Print**. The printout keeps the colors of the heat map, leaves out the menus and buttons, and shows the summary strip and the heat map as set on screen (scale, residual or inherent, movement, chosen cell) with its ranked list. The full list of risks is left out. For a fuller board report, use the **Risk report** (below).

### The list of risks

The list shows **Reference**, **Title**, **Category**, **Inherent**, **Residual**, **Appetite** ("Above appetite" in red, "Within", or a dash when no appetite is set for the category), **Treatment**, **Status**, **Owner**, **Due** and **Next review**; **Last reviewed** and **Parent risk** can be added from the column options. You can:

- search by title, description, cause, consequence or affected systems;
- filter by **Category**, **Summary level** (the common level), **Above appetite**, **Status**, **Treatment**, **Owner**, **Parent risk**, **Due** and **Next review**;
- sort by selecting a column heading;
- save a search and filter combination as a view;
- check several risks and change their **Owner**, **Treatment**, **Category**, **Next review** or **Due** date together;
- download the rows as a CSV file (needs **Export** on **Risks**).

## Adding a risk

1. On the risk register, select **New risk**. You can also use **Create > Risk** at the top of any page.
2. Enter a **Title** that names the event plainly, for example "CAD/AVL outage during peak service".
3. Choose the **Category**. This decides the scale. If the risk belongs under a wider enterprise risk, choose it as the **Parent risk** (see "Parent risks and the roll-up" below).
4. Fill in what you know of **Description**, **Cause**, **Consequence**, **Affected systems and data** and **Existing controls**.
5. Choose a **Treatment** and, if known, the **Owner**, **Due** date and **Next review** date.
6. Save. The risk is given a reference beginning `RSK-` and a status of **Open**, and its page opens.

The new risk is not scored yet. Score it next.

## The risk page

A risk's page tells its story from top to bottom. The header shows the inherent and residual ratings ("Inherent: Extreme → Residual: High") and the treatment.

1. **The risk**: the **Cause**, the **Event** (the risk's title and description) and the **Consequence**, then the category, owner and the systems and data affected. Select **Edit details** to change any of these, the existing controls, treatment, status, owner, due date or next review.
2. **Assessment**: the inherent risk, the existing controls and the residual risk, each with its rating, and a small copy of the scale's matrix marking where the risk sits: **I** for inherent, **R** for residual.
3. **Treatment plan**: the treatment, status and due date (with the days left), and the risk's **Actions**.
4. **Acceptance**: whether the risk is accepted, until when, the executive-approval rule, and a request waiting for approval. While acceptance has been asked for, the approval panel under the header shows its steps and decisions.
5. **Review**: the next review date, the last review and the reviews so far.
6. **Rolls up under** (the parent risk) or **Risks under this one** (each with its residual rating, appetite and status), when the risk has either.
7. **Key risk indicators**: the risk's indicators with their latest value and level.

The **Appetite** line on **The risk** card says whether the risk is above its category's appetite; the header shows **Above appetite** when it is.

Below these are the **Activity**, **Attachments**, **Related** and **History** tabs.

## Scoring a risk

1. On the **Assessment** card, select **Change scores**.
2. Under **Inherent risk**, choose a **Likelihood** and an **Impact** (called **Severity** on the safety hazard matrix). Each choice shows its meaning.
3. Under **Residual risk**, do the same, this time allowing for the existing controls.
4. The rating and the small matrix change as you choose, so you can see the result before saving.
5. Select **Save scores**, or **Cancel** to leave the scores as they were.

Rules to know:

- Give both likelihood and impact for a pair, or leave both as **Not scored**. One without the other is refused.
- Ratings are worked out from the scale and cannot be typed in.
- You may score only the inherent risk and leave the residual risk for later. Until the residual risk is scored, the inherent rating is used for the common level and for the acceptance rule.
- If you change a risk's category to one that uses the other scale, check the scores again: the levels have different names and meanings.

## Treatment and status

**Treatment** records what you intend to do about the risk.

| Treatment | Meaning |
|---|---|
| **Mitigate** | Reduce the likelihood or the impact with further controls. |
| **Accept** | Live with the risk as it stands, with a recorded approval. |
| **Transfer** | Pass the risk to another party, for example by insurance or contract. |
| **Avoid** | Stop the activity that causes the risk. |

**Status** records where the risk is: **Open**, **In treatment**, **Accepted**, **Needs review** or **Closed**. **Needs review** is set by the application when an acceptance expires (see "Expiry" below).

To change either, select **Edit details**, change the field and save. You cannot set the status to **Accepted** this way unless the risk already has an acceptance that is current; ask for acceptance (or record it) instead, as described next.

The **Actions** list on the **Treatment plan** card holds the work that carries out the treatment; see "Actions on a record" below.

## Asking for acceptance

An acceptance is a recorded decision to live with a risk for a limited time. It is given through the **Risk acceptance** approval workflow (see [Approval workflows](22-approval-workflows.md)), so it gets due times, escalation, stand-ins and the **Approvals** page like every other approval. You need **Edit** on **Risks**, and the risk must be scored.

1. On the risk's **Acceptance** card, read the note at the top: it says whether the executive-approval rule applies to this risk, and why.
2. Select **Ask for acceptance** (or **Ask to renew** when one already stands).
3. Enter **Expires on** (after today) and the **Rationale**: why the risk should be accepted. Both are required.
4. Select **Ask for acceptance**.

The approvers are told, and the approval panel at the top of the risk shows each step, who decides it and their decisions. The **Acceptance** card says the acceptance has been asked for and is waiting. You cannot decide your own request.

The ready-made **Risk acceptance** workflow has two steps:

1. **Risk approver**: anyone who holds **Approve** on **Risks**.
2. **Executive approver**: only when the executive-approval rule applies to the risk (the risk's read-only field **Acceptance needs an executive** is set); out of the box also anyone who holds **Approve** on **Risks**, except the person who decided the first step: the two steps always need two different people. An administrator should name your executives in this step under **Administration > Approval workflows**.

Because risks are restricted records, only approvers (and stand-ins) who may see restricted records are ever asked; an approver must also hold **Approve** on **Risks**. An administrator can change the steps, the approvers, due times and escalation without any change to the application.

- **Approved**: the acceptance is recorded with the last approver as **Approved by** (with "on behalf of" when a stand-in decided), today as **Approved on**, the expiry and rationale you gave, and the workflow's name as the **Reference**. When the executive step applied the acceptance is labeled **Executive approval**. The risk's status becomes **Accepted** and its treatment becomes **Accept**, made by the application: a lifecycle rule about who may set **Accepted** by hand does not stop it.
- **Rejected**: nothing changes on the risk. The reason is shown in the approval panel and written to the risk's history, and the card says the last request was rejected. You can ask again.
- If the expiry date asked for has passed by the time the request is approved, no acceptance is recorded; the approval panel says so. Ask again with a later date.

If no **Risk acceptance** workflow is active, asking is refused with a message; an approver can still record an acceptance by hand.

## Recording an acceptance by hand

When the acceptance was decided outside the application (for example at a risk committee), someone with **Approve** on **Risks** records it directly. Recording one also ends a request still waiting for approval.

1. On the risk's **Acceptance** card, read the note at the top: it says whether the executive-approval rule applies to this risk, and why.
2. Select **Record by hand** (or **Renew by hand** when one already stands).
3. Enter the **Approver name** and **Approver title**. If the executive-approval rule does not apply you may leave the name empty, and you are recorded as the approver.
4. Enter **Approved on**, or leave it empty for today.
5. Enter **Expires on**. This is required and must be after the approval date.
6. Enter a **Reference** for the approval, for example a memo, email or resolution number.
7. Enter the **Rationale**: why the risk is being accepted. This is required.
8. Select **Record acceptance**.

The risk's status becomes **Accepted** and its treatment becomes **Accept**. The acceptance is written to the risk's history.

### The executive-approval rule

Each scale has a threshold rating. A risk rated at or above the threshold can be accepted only with a named executive approver. The note at the top of the **Acceptance** card explains the rule for the risk in front of you, for example "This risk is rated High, which is at or above the threshold (High) for its scale".

| Scale | Executive approval is needed when the rating is |
|---|---|
| Cyber and enterprise risk (5 by 5) | High or Extreme |
| Safety hazard matrix (4 by 5) | Serious or High |

When the rule applies to an acceptance recorded by hand, **Approver name**, **Approver title** and **Reference** are all required, and the acceptance is refused without them; through the workflow, the **Executive approver** step applies instead. The acceptance is then labeled **Executive approval**. The rating tested is the residual rating, or the inherent rating if the residual risk has not been scored. An administrator can change the threshold on the **Risk scales** page.

An acceptance recorded by hand records who approved; it does not ask the approver to sign in and confirm, so keep the memo or email the reference points to. An acceptance through the workflow is decided by the approvers themselves, signed in.

### Expiry

Every acceptance has an expiry date. The **Acceptance** card shows the acceptance that stands as **Current acceptance**, with a countdown ("21 days until it expires") and a bar showing how much of its time has gone, and a label:

- **Valid until** (green): more than 60 days remain.
- **Expires in N days** (amber): 60 days or fewer remain.
- **Expired** (red): the expiry date has passed.

Older acceptances are listed under **N earlier acceptances**; select it to show them, each labeled **Revoked**, **Replaced by a later acceptance** or with its expiry.

The application checks every few hours:

- When an acceptance comes within 30 days of expiry, the risk's owner is sent a notification, once. An administrator changes the 30 days under **Administration** > **Reminders**.
- When an accepted risk's acceptance has expired, the risk's status changes to **Needs review**, the change is recorded in its history as a system event, and the owner is notified (people with **Approve** on **Risks** are told when the risk has no owner).

Review the risk, then either renew the acceptance (the status returns to **Accepted**) or change its treatment and status.

### Revoking an acceptance

When circumstances change you can withdraw an acceptance. You need **Approve** on **Risks**.

1. On the **Acceptance** card, under the current acceptance, select **Revoke acceptance**.
2. Enter the **Reason**. This is required.
3. Enter **Revoked on**, or leave it empty for today. It cannot be in the future or before the approval date.
4. Select **Revoke acceptance**.

The acceptance is never deleted: it stays on record, labeled **Revoked**, with the date, who revoked it and why. The risk goes back to **Open** unless an earlier acceptance still stands, the change is written to the risk's history, and the risk's owner is notified.

## Risk reviews

Each risk has a **Next review** date. When it arrives the risk's owner is notified once, and the risk appears on the **Risk reviews** page.

To complete a review:

1. Check the scores, controls and treatment and change what needs changing.
2. On the risk's **Review** card, select **Complete review**.
3. Under **What the review found**, add a note if you wish, for example "controls still working, no change".
4. Check the **Next review** date. It is suggested from the gap between the last review and the review date it set (the same interval again), or 90 days.
5. Select **Complete review**.

Today is recorded as the review date, the ratings are kept as they stand now (the **Risk report** compares later ratings with them), and the next review date is set. The **Review** card lists the reviews so far with the rating at each.

### The Risk reviews page

Open **Risk and compliance > Risk register** and the **Reviews** tab. It has two worklists, looking ahead **30 days**, **60 days** or **90 days**:

- **Acceptances to renew**: acceptances that have expired, or will expire within the window, with the approver, the days left and a **Renew** button that opens the risk (**Open** for people without **Approve** on **Risks**).
- **Reviews due**: open risks whose review date has passed or falls within the window, with **Complete review** on each row.

The tiles at the top count **Acceptances expired**, **Acceptances expiring**, **Reviews overdue** and **Reviews coming up**.

## The risk report

Open **Risk and compliance > Risk register** and the **Report** tab, or select **Risk report** on the register. It is laid out for a board pack:

- tiles for **Open risks** (with how many are not yet scored, or how many have only an inherent score and no residual score), the number at the highest common level in use, **Increased** since the last review, **Accepted** and **Reviews overdue**;
- **Open risks by level**: a bar of open risks at each common level;
- **Top 10 risks** (fewer when there are fewer): reference and title, category, status, owner, inherent and residual ratings, the movement **Since last review** ("Up from Medium", "Down from Extreme", "No change" or "Not yet reviewed"), the treatment and the open and overdue actions;
- **Movement since the last review**: the risks rated higher (**Increased**) and lower (**Reduced**) than at their last completed review;
- **Risk appetite**: for each category with an appetite, the statement, the highest acceptable rating, the open risks and how many are above it;
- **Enterprise risks and the risks under them** (when parent risks are used): each parent risk, its rating, the open risks under it, the worst of them and how many are above the appetite;
- **Acceptances expiring**: acceptances that have expired or expire within 90 days.

Select **Print or save as PDF** to print it, or to save it as a PDF from the print dialog. Movement is measured against the rating recorded when a review was completed, so complete reviews regularly for the report to be useful.

## Editing the risk scales

Open **Risk and compliance > Risk register** and the **Scales** tab, or **Risk scales** on the **Administration** page (needs **Administer** on **Risks**). Choose the scale at the top. The page has these cards:

- **Name and axes**: the **Name**, **Description**, **Name of the likelihood axis** and **Name of the impact axis** (for example Impact or Severity).
- **Levels**: a table for each axis with each level's **Value**, **Label** and **What it means**. A higher value is more likely, or worse. Use **Add level** and the trash icon to add and remove levels; each axis needs at least two.
- **Ratings**: each rating's **Label**, **Key**, **Color**, **Order** (least to most severe) and **Common level**.
- **Matrix**: a grid with a rating picker in each cell, colored as on the heat map.
- **Acceptance threshold**: **Executive approval is needed from** a chosen rating and above, or never.

As you edit, the bar at the bottom says what saving would do, for example how many risks would be re-rated, and warns when a level you removed is still used by a risk (save is then refused: re-score those risks first). Select **Save scale** to save, or **Discard changes**. Saving re-rates every risk on the scale and is written to the audit log.

The safety hazard matrix can also be changed by a safety administrator under **Safety and emergency management > Safety dashboard**, **Settings** tab (its level names and the rating of each cell; see [Safety management](20-safety-management.md#change-the-hazard-matrix)), which works even while **Risks and obligations** is switched off. Saving there re-rates the risks on that scale too, and saving the hazard matrix here re-rates the hazards too.

**Add scale** creates a new scale as a copy of the one shown: give its **Name** and **Key** (lower-case letters, numbers and underscores; it cannot be changed later). To use a new scale, an administrator points a risk category at it in **Administration > Lists** (the `risk_category` list).

## Risk appetite

The risk appetite says, for each risk category, how much risk the organization is willing to accept. Open **Risk and compliance > Risk register** and the **Appetite** tab, or **Risk appetite** on the **Administration** page (needs **Administer** on **Risks** and **View** on **Security incidents and restricted records**). Each category has a card, named with the scale its risks are scored on:

| Field | What to put in it |
|---|---|
| **Appetite statement** | In plain words, how much of this kind of risk is acceptable. |
| **Highest acceptable rating** | A rating of the category's scale, or **No limit**. A risk whose residual rating (or inherent rating, while it has no residual score) is above it is **above appetite**. |
| **Highest acceptable score** | Optional: a risk whose score is above it is above appetite too. |
| **Approved on**, **Approved by**, **Reference** | Who set the appetite and when, for example the board and the number of its resolution. |

The card's header shows how many open risks the category has and how many are above appetite; select either to open the list. Select **Save appetite** to save every card; every risk is checked against the new appetite at once, and the change is written to the audit log. Clearing every field of a card removes that category's appetite. Closed risks are never above appetite.

A risk is checked every time it is saved, and once a day. Above appetite shows as a red **Above appetite** badge in the register's **Appetite** column, in the risk's header and on its page, as a dashed ring on the heat map, and in the risk report.

## Parent risks and the roll-up

A department or system risk can roll up under a wider enterprise risk. Choose the enterprise risk as the **Parent risk** when you add the risk or with **Edit details**. A parent risk cannot itself have a parent, and a risk with risks under it cannot be put under another, so the hierarchy is two levels deep.

The parent's page lists **Risks under this one**; each child's page says what it **Rolls up under**. The **Risk report** has a section **Enterprise risks and the risks under them**, with the worst open risk under each and how many are above appetite. Filter the register by **Parent risk** to see one parent's risks in the list.

## Key risk indicators

A key risk indicator (KRI) is a monthly figure that warns early when a risk is growing: phishing test clicks, unplanned downtime, overdue actions. Open **Risk and compliance > Risk register** and the **Indicators** tab. Indicators are restricted like risks.

The tiles count the **Active indicators** and those **At red** and **At amber**. The list shows each indicator's risk, its **Latest value** and month, its **Level** (green, amber or red), whether its value is **Computed** or **Entered by hand**, the owner and the status.

To add an indicator:

1. Select **New key risk indicator**, or use **Create > Key risk indicator**.
2. Give the **Indicator** a name, say **What it measures**, and choose its **Risk**.
3. Choose the **Unit** (count, percent or number) and the **Direction**: **Higher is worse** (red at or above the red threshold) or **Lower is worse** (red at or below it).
4. Enter the **Amber at** and **Red at** thresholds, the **Frequency** and the **Owner**, and save. The indicator is given a reference beginning `KRI-`.

On the indicator's **Values** tab:

- **Monthly values** lists each month's value, its level against the thresholds as they are now, the note and who entered it.
- **Enter a value** (indicators entered by hand) takes the **Month** (YYYY-MM; entering a month again corrects it), the **Value** and an optional **Note**. A month that has not started cannot be entered.
- **Where the value comes from**: keep **Entered by hand each month**, or choose a figure the application works out from its own records (for example overdue actions or overdue corrective action plans; the list shows only those of parts that are switched on). A computed indicator is filled in every day, for this month and last month, and cannot be entered by hand.

When an indicator's latest value reaches **red**, its risk's **Next review** is brought forward to today (unless it is already due), and the risk's owner and the indicator's owner are notified once for that month.

## The action tracker

Open **Risk and compliance > Action tracker**. It is built for the weekly review: every open action, from risks, assessments, incidents, audits, exercises, information requests, projects, changes, vulnerabilities, policies, training, vendors, problems, safety events and hazards, and anything else, in one place.

### Tiles and groups

Four tiles show the number of actions that are **Open**, **Overdue** (open, not yet finished and past the due date), **Due this week** (due between today and Sunday) and **Unassigned** (no owner). While any action is **Awaiting verification**, a fifth tile counts those. Select a tile to show only those actions; select it again, or the button such as "Overdue: clear", to go back.

Choose how to group the open actions:

| Grouping | Groups |
|---|---|
| **By due week** (the starting view) | **Overdue** first, then **This week**, **Next week**, each later week ("Week of …"), and **No due date**. |
| **By owner** | One group per person, and **Unassigned**. The people with the most overdue work come first. |
| **By source** | One group per source, such as Risk, Audit or Vendor. |
| **List** | A plain list of every action, open or not, with search, filters, sorting, saved views, column options and export. |

Select a group's name to fold it away or open it again. Overdue actions have a red edge and say how many days overdue they are; actions due within a week say "Today", "Tomorrow" or "In N days". **Search open actions** narrows every group.

### Working through the list

Each row lets you act without leaving the page (needs **Edit** on **Actions**):

- select the round check to mark the action **Done**; select it again to reopen it;
- select the owner's name to give the action to someone else (people are notified when an action is assigned to them);
- change the **Status** with its drop-down;
- select the title to open the action, or **Open risk** (or the matching record) to go to where it came from.

**Quick add**: type a title in **Add an action and press Enter**, optionally choose a **Due date**, and press Enter or select **Add**. Press **N** anywhere on the page to jump to that box. If your administrator has made a custom field on actions required, it appears under the box once you start typing and must be filled in; other custom fields are filled in on the action's page.

### Changing several actions at once

1. Check the actions to change (the checkbox in a group's heading selects the whole group).
2. In the bar that appears, choose the **Field to change**: **Status**, **Priority**, **Owner** or **Due date**.
3. Choose the new value. For **Owner** and **Due date** you can leave it empty to clear the field.
4. Select **Apply** (or **Clear owner** / **Clear date**). Each action is saved and audited separately; any that cannot be changed are reported.

Select **Clear selection** to clear them all. The **List** grouping has its own bulk change for **Status**, **Priority**, **Owner**, **Due** and **Source**.

### What an action holds

| Field | Notes |
|---|---|
| **Title**, **Description** | What has to be done. |
| **Status** | **Open**, **In progress**, **Blocked**, **Awaiting verification**, **Done** or **Canceled**. An action that needs verification goes to **Awaiting verification** when it is marked done, and is done only once its verification is recorded (see [Corrective action plans](24-corrective-action-plans.md#verification-of-effectiveness)). |
| **Priority** | **High**, **Medium** or **Low**. New actions start as Medium. |
| **Owner** | The person responsible. An action with no owner shows as Unassigned. |
| **Due** | The date it should be finished. |
| **Completed** | Filled in with today's date when the status becomes Done (or Awaiting verification), and cleared if the action is reopened. |
| **Corrective action plan** | The plan the action belongs to, if any. |
| **Needs verification**, **Verifier**, **Verification due** | Whether someone must check that the action worked before it counts as done, who, and by when. On by default for actions in a corrective action plan. |
| **Closure evidence** | What shows the action was done. Required, as text or an attachment, for the sources an administrator lists. |
| **Source** | Where the action came from: Risk, Assessment, Incident, Audit, Exercise, Information request, Project, Change, Vulnerability, Policy, Training, Vendor, Problem, Safety or Other. A source whose part is switched off under **Administration > Features** is not offered. An action raised on a record is filed under that record's kind unless you choose otherwise. |
| **Department**, **Site**, **External reference**, **Notes** | Optional. The department is one of the organization's departments (**People and training > People**, **Departments** tab). An action raised on a hazard, a safety event or an inspection of a site takes that site unless you choose another; people whose role is limited to their departments or sites see the actions of theirs (see [Administration](09-administration.md#which-records-a-role-reaches)). |

Each action has a reference beginning `ACT-`. Its page shows the due date with the days left, the owner, the priority, where it arose from and the plan it belongs to, and the **Verification**, **Extensions** (asking for a later due date), **Activity**, **Attachments**, **Related** and **History** tabs. Grouping actions into a plan with a root cause, approval and verification is described in [Corrective action plans](24-corrective-action-plans.md).

### Adding an action

1. On the action tracker, select **New action**, or use **Create > Action**.
2. Enter the **Title** and any **Description**.
3. Choose the **Priority**, **Owner** and **Due** date.
4. Choose the **Source** and add a **Department** or **Notes** if useful.
5. Save.

### Actions on a record

A risk's **Treatment plan** card, and the pages of other records that offer it (for example security incidents, vulnerabilities, vendors, projects, tickets, problems, framework outcomes, safety events and hazards), have an **Actions** list for the work arising from that record. It shows how many are finished, flags overdue ones, and lets you:

- type a title in **Add an action and press Enter**, with an optional **Due date**, to add one at once;
- select **Add action** to add one with a priority, owner, due date and department;
- check an action done, reassign it or change its status in place;
- select **Action tracker** to see every action.

The action is tied to the record: its own page says "Arose from risk record" with a link back. An action raised on a restricted record is itself restricted.

### My actions

Open **My work > Actions**, or select **My actions** on the action tracker. It lists the open actions you own, most urgent first, in **Overdue**, **Due this week**, **Later** and **No due date**, with tiles counting them; **Finished, awaiting verification** holds yours that wait for a check, and **To verify** the actions that name you as their verifier. Type in **Add an action for yourself and press Enter** to add one that is yours. **Recently finished** shows the last five you completed, and **Shared with you** lists restricted actions shared with you by name.

### Notifications about actions

- When an action is assigned to someone else, they are notified ("Action assigned to you"). You are not notified about actions you give yourself.
- Owners of actions that are overdue or due within three days are told once a day by the notifications digest; see the notifications page of this guide.
- Nobody is told the title of a restricted action they cannot see.

### Sharing a restricted action

An action raised from a restricted record is hidden from people without access to security records, even if they own it. To let one such person work on it:

1. Open the action (you need access to security records) and select the **Sharing** tab.
2. Under **Share with**, find the person, or select **Choose the owner**.
3. Select **Share**.

That person is notified that a restricted action has been shared with them, and sees the action under **Shared with you** on **My actions**: its title, description, due date, priority and notes. They can change its status (including checking it done) and its notes and nothing else, and they never see the record it arose from. The lifecycle rules for actions (**Administration > Lifecycles**) apply to them as to anyone: who may set a status, the fields a status needs, and a status change that waits for an approval workflow. Select the cross beside a name to stop sharing. Sharing and unsharing are written to the action's history.

## Information requests

If your organization profile includes an `information_requests.psv` file, the seed command loads each row as an action with the source **Information request**. Running the seed command again adds new rows and brings changed rows up to date, field by field. A field you have edited in the application keeps your edit, and a request you have deleted is not brought back.

## The obligations register

Open **Risk and compliance > Obligations**. An obligation is something the organization must do because of a law, a regulation, a contract, a funding condition or an insurance policy. None are supplied with the application: they are loaded from your organization's profile when the application is set up, or entered by hand.

The tiles at the top count all **Obligations**, those **Not met** and **Partly met**, those **Overdue** (next due date passed) and those **Due in 30 days**. Select a tile to filter the list. The list is sorted by **Next due**, soonest first, and each date carries a countdown: "18 days left" (amber within 30 days, green beyond), or "Overdue by 5 days" in red.

| Field | What to put in it |
|---|---|
| **Obligation** | A short name for the requirement. |
| **Source** | Where it comes from, for example the name of the agreement or policy and the clause. |
| **Type** | **Law or regulation**, **License or permit**, **Contract**, **Funding condition**, **Standard or certification**, **Internal policy** or **Other**. An administrator can change the list (`obligation_type`). |
| **Frequency** | How often it recurs: **Once**, **Monthly**, **Quarterly**, **Every six months**, **Yearly**, **Every 2 years** or **Every 3 years**. |
| **Requirement** | What exactly must be done. |
| **Owner** | The person responsible for meeting it. |
| **How it is met** | The process or control that satisfies it. |
| **Evidence** | Where proof can be found, if not in the attached files. |
| **Next due** | The next date something must be done or reviewed. |
| **Status** | **Not assessed**, **Met**, **Partly met** or **Not met**. New obligations start as Not assessed; attesting a period sets it. |

**Applies to** (on the **Periods** tab) names what the obligation covers: services, sites, modes or departments. Type a name and select **Add**; select the cross beside a name to remove it. Obligations made by other parts of the application (for example a funding award's reporting conditions) may name a record there, shown as a link.

To add an obligation:

1. Select **New obligation**, or use **Create > Obligation**.
2. Fill in the fields above and save. The obligation is given a reference beginning `OBL-`.

An obligation's page shows its status, next due date with countdown, frequency, the date it was last attested and its owner at the top. To change it, select **Edit** on the **Details** card.

### Periods and attestation

A recurring obligation is met (or not) period by period. The **Periods** tab lists each period with its dates, due date, result (**Met**, **Partly met**, **Not met**, or **To attest**, red once past due), who attested it and when, and the note and evidence. Above the list, **Next period to attest** gives the period that ends on the next due date: it starts the day after the same date one frequency earlier (for a quarterly obligation due December 16, September 17 to December 16).

To attest a period:

1. Select **Attest a period** (or **Attest** on a period already listed).
2. For a new period, check the **Period starts**, **Period ends** and **Due** dates, which are filled in for the next period.
3. Choose whether it was **Met**, **Partly met** or **Not met**. Partly met and not met need a **Note**: what was not met, and what is being done about it.
4. Say where the **Evidence** is, and select **Attest**.

Attesting the latest period sets the obligation's **Status** to the result and moves **Next due** on by one frequency (only ever forward, so correcting a period with **Correct** does not move it twice). The attestation is written to the obligation's history. Attesting needs **Edit** on **Obligations**. Without a frequency the next due date stays as it is; set it by hand.

The owner is reminded once when the next due date is 30 days away, and once more when it is reached; an obligation without an owner goes to everyone who may edit obligations. For a recurring obligation the reminder asks for the period ending on that date to be attested; attesting it moves the date on, which starts the reminders for the next period. A period added by hand that is still to be attested, with another due date, is reminded about the same way. Setting a new **Next due** starts the reminders again for that date. An administrator changes the 30 days under **Administration** > **Reminders**.

### Evidence files

The **Evidence** tab on an obligation holds the files that prove it is met: a signed form, a report, a certificate. Drag files onto it or select **Choose files**.

The list shows **Type** and **Frequency** beside the status; **Applies to**, **Source** and **Last attested** can be added from the column options. It can be searched, filtered by **Status**, **Type**, **Frequency**, **Owner** and **Next due**, sorted, saved as a view, changed in bulk (**Status**, **Type**, **Frequency**, **Owner**, **Next due**) and exported. Use the **Related** tab on an obligation to link it to the framework outcomes, contracts or risks it concerns; see [Cybersecurity frameworks and assessments](05-cybersecurity-frameworks.md).

## Regulatory changes

Open **Risk and compliance > Obligations** and the **Regulatory changes** tab (needs **View** on **Obligations**; the button **Regulatory changes** on the obligations register opens it too). A regulatory change is a new or changed law, rule, standard or funding term that the organization has to respond to. None are supplied: each is your own entry.

The tiles count **Open changes**, those **To assess**, those of **High impact** still open, and those **Implemented**. The list is sorted by the date each change **Takes effect**, with a countdown until it is closed.

To log a change, select **New regulatory change** or use **Create > Regulatory change**, and fill in:

| Field | What to put in it |
|---|---|
| **Title** | What changes, in a few words. |
| **Issued by**, **Citation** | Who issued it and its reference. |
| **Published**, **Takes effect** | The dates. It cannot take effect before it is published. |
| **Summary** | What the change says. |
| **Impact**, **Impact assessment** | **Low**, **Medium** or **High**, and what it means for the organization. |
| **Status** | **Identified**, **Assessing**, **Implementing**, **Implemented** or **Not applicable**. Implemented and Not applicable need the impact assessment (for Not applicable, why it does not apply). |
| **Owner** | Who sees it through. |

The change is given a reference beginning `REG-`. Its **Impact and actions** tab has:

- **Affected records**: the policies, obligations and controls the change affects (only the kinds of record that are switched on). **Add affected record** links an existing one; the cross removes the link without changing the record. The same links appear on each record's **Related** tab, as "affects".
- **Make an obligation**: creates an obligation from the change, with its title, source (citation and issuer), requirement (summary) and owner, a type, a frequency and a next due date (the date the change takes effect, unless you change it), and lists it as affected. Needs **Create** and **Edit** on **Obligations**.
- **Start revision** beside an affected policy (when policies are switched on and you may edit them): starts a draft version of the policy, a copy of its published text with the change's reference as the summary of changes, and opens the policy to edit it there. The policy's own review and approval then apply.
- **Actions**: actions raised from the change, with the source **Regulatory change**.

## Not available yet

- Key risk indicators are monthly; there is no weekly or daily indicator.
- A regulatory change is entered by hand; there is no feed of changes from outside the application.
- An acceptance recorded by hand names its approver; they do not sign in to confirm it (ask for acceptance through the workflow when they can).
