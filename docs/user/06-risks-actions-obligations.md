# Risks, actions and obligations

This page covers three registers in the **Cybersecurity** group of the menu. The **Risk register** records what could go wrong, how serious it is and what is being done about it. The **Action tracker** is the single to-do list for follow-up work arising anywhere in the application. **Obligations** lists the things your organisation is required to do and how each is met.

## Who can see risks

Risks are **restricted records**. A person sees the risk register only if their roles give them both of these permissions:

- **View** on **Risks**
- **View** on **Security incidents and restricted records**

Without both, risks do not appear anywhere for that person: not in the register, the heat map, counts, search results, related-record links or exports. The register carries the line "Restricted: visible only to people with access to security records" as a reminder.

Recording an acceptance needs a further permission, **Approve** on **Risks**. Roles are managed by an administrator; see [Administration](09-administration.md).

Obligations are not restricted. An action is restricted when the record it was raised from is: an action raised from a risk, a security incident or any other restricted record is hidden, everywhere, from people without **View** on **Security incidents and restricted records**, including its owner if they lack that permission. Other actions are visible to anyone with **View** on **Actions**. You cannot raise an action on, or move one to, a record you cannot see.

## The risk register

Open **Cybersecurity > Risk register**. The page has a heat map, a summary across all scales, and the list of risks.

### The two scales

A risk is scored on a scale: a grid of likelihood against impact, where each cell gives a rating. Two scales are supplied, and the risk's **Category** decides which one is used.

| Scale | Used for categories | Down the side | Along the top | Ratings, lowest to highest |
|---|---|---|---|---|
| **Cyber and enterprise risk (5 by 5)** | Cybersecurity, Enterprise, Third party, Compliance | Likelihood: Rare, Unlikely, Possible, Likely, Almost certain | Impact: Insignificant, Minor, Moderate, Major, Severe | Low, Medium, High, Extreme |
| **Safety hazard matrix (4 by 5)** | Safety | Likelihood: Improbable, Remote, Occasional, Probable, Frequent | Severity: Negligible, Marginal, Critical, Catastrophic | Low, Medium, Serious, High |

On the 5 by 5 scale each level counts from 1 to 5 and the rating comes from likelihood multiplied by impact: 1 to 4 is Low, 5 to 9 is Medium, 10 to 19 is High, and 20 or 25 is Extreme.

The safety hazard matrix does not use multiplication. Each cell is set individually:

| Likelihood | Negligible | Marginal | Critical | Catastrophic |
|---|---|---|---|---|
| Frequent | Medium | Serious | High | High |
| Probable | Medium | Serious | High | High |
| Occasional | Low | Medium | Serious | High |
| Remote | Low | Medium | Medium | Serious |
| Improbable | Low | Medium | Medium | Medium |

Hover over a level name on the heat map to read what it means, for example "Likely: Expected about once a year".

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

The **Heat map** card shows one scale at a time as a grid, with the worst likelihood at the top and the worst impact on the right. Each cell shows the number of risks in it and the rating that cell gives.

1. In **Scale**, choose which scale to show.
2. In **Show**, choose **Residual risk (after controls)** or **Inherent risk (before controls)**.

Under the grid, a badge for each rating gives the total, and a note such as "3 not yet scored" counts risks on that scale that have no score for the view you chose. Closed risks are left out of the heat map.

### Drilling down from a cell

1. Select a cell that has a number in it. Empty cells cannot be selected.
2. The list below now shows only the risks in that cell, under a line such as "Showing 2 risks at Likely by Major (residual, Cyber and enterprise risk (5 by 5))".
3. Select the same cell again, or **Show all risks**, to return to the full list.

Changing the scale or the **Show** setting also clears the drill-down.

### All scales, common levels

The second card brings every scale together. The chart counts open risks at each common level (Low, Medium, High, Critical), with a colour for each scale. Below it, **Highest risks** lists the five open risks with the highest scores; select one to open it.

### The list of risks

The list shows **Reference**, **Title**, **Category**, **Inherent**, **Residual**, **Treatment**, **Status**, **Owner**, **Due** and **Next review**. You can:

- search by title, description, cause, consequence or affected systems;
- filter by **Category**, **Summary level** (the common level), **Status**, **Treatment**, **Owner**, **Due** and **Next review**;
- sort by selecting a column heading;
- save a search and filter combination with **Views > Save current view…**;
- download the rows with **Export CSV** (needs **Export** on **Risks**).

## Adding a risk

1. On the risk register, select **New risk**. You can also use **Create > Risk** at the top of any page.
2. Enter a **Title** that states the risk plainly.
3. Choose the **Category**. This decides the scale.
4. Fill in what you know of **Description**, **Cause**, **Consequence**, **Affected systems and data** and **Existing controls**.
5. Choose a **Treatment** and, if known, the **Owner**, **Due** date and **Next review** date.
6. Save. The risk is given a reference beginning `RSK-` and a status of **Open**.

The new risk is not scored yet. Open it and score it next.

## Scoring a risk

Open the risk and select the **Scoring** tab. The card title names the scale in use.

1. Under **Inherent risk**, choose a **Likelihood** and an **Impact** (called **Severity** on the safety hazard matrix). Each choice shows its description.
2. Under **Residual risk**, do the same, this time allowing for the existing controls.
3. The **Rating** beside each pair updates as you choose, so you can see the result before saving.
4. Select **Save scores**. Select **Reset** to discard changes you have not saved.

Rules to know:

- Give both likelihood and impact for a pair, or leave both as **Not scored**. One without the other is refused.
- Ratings are worked out from the scale and cannot be typed in.
- You may score only the inherent risk and leave the residual risk for later. Until the residual risk is scored, the inherent rating is used for the common level and for the acceptance rule.
- If you change a risk's category to one that uses the other scale, check the scores again: the levels have different names and meanings.

The header of the risk shows the result as "Inherent: High" followed by "Residual: Medium", next to the treatment.

## Treatment and status

**Treatment** records what you intend to do about the risk.

| Treatment | Meaning |
|---|---|
| **Mitigate** | Reduce the likelihood or the impact with further controls. |
| **Accept** | Live with the risk as it stands, with a recorded approval. |
| **Transfer** | Pass the risk to another party, for example by insurance or contract. |
| **Avoid** | Stop the activity that causes the risk. |

**Status** records where the risk is: **Open**, **In treatment**, **Accepted** or **Closed**.

To change either, select **Edit** on the **Details** card, change the field and save. You cannot set the status to **Accepted** this way unless the risk already has an acceptance that has not expired; record the acceptance instead, as described next.

Use the **Actions** tab to list the work that will carry out the treatment (see "Adding an action from a risk" below).

## Recording an acceptance

An acceptance is a recorded decision to live with a risk for a limited time. You need **Approve** on **Risks**, and the risk must be scored.

1. Open the risk and select the **Acceptance** tab. The text at the top tells you whether the executive-approval rule applies to this risk.
2. Select **Record acceptance**.
3. Enter the **Approver name** and **Approver title**. If the executive-approval rule does not apply you may leave the name empty, and you are recorded as the approver.
4. Enter **Approved on**, or leave it empty for today.
5. Enter **Expires on**. This is required and must be after the approval date.
6. Enter a **Reference** for the approval, for example a memo, email or resolution number.
7. Enter the **Rationale**: why the risk is being accepted. This is required.
8. Select **Record acceptance**.

The risk's status becomes **Accepted** and its treatment becomes **Accept**. The acceptance is written to the risk's history.

### The executive-approval rule

Each scale has a threshold rating. A risk rated at or above the threshold can be accepted only with a named executive approver.

| Scale | Executive approval is needed when the rating is |
|---|---|
| Cyber and enterprise risk (5 by 5) | High or Extreme |
| Safety hazard matrix (4 by 5) | Serious or High |

When the rule applies, **Approver name**, **Approver title** and **Reference** are all required, and the acceptance is refused without them. The acceptance is then labelled **Executive approval**. The rating tested is the residual rating, or the inherent rating if the residual risk has not been scored.

The application records who approved; it does not ask the approver to sign in and confirm. Keep the memo or email the reference points to.

### Expiry

Every acceptance has an expiry date, after which the risk must be looked at again. The **Acceptance** tab shows the newest acceptance as **Current acceptance** and older ones as **Earlier acceptance**, each with a label:

- **Valid until** (green): more than 60 days remain.
- **Expires in N days** (amber): 60 days or fewer remain.
- **Expired** (red): the expiry date has passed.

When an acceptance expires the risk's status does not change by itself. Review the risk, then either record a new acceptance or edit the status and treatment.

## The action tracker

Open **Cybersecurity > Action tracker**. It lists actions arising from risks, assessments, incidents, audits, exercises, information requests and projects in one place.

### Summary and groups

Four tiles show the number of actions that are **Open**, **Overdue** (open and past the due date), **Due this week** (due between today and Sunday) and **Unassigned** (no owner).

Two tables, **Open by owner** and **Open by source**, count open and overdue actions for each person and each source. Select a name or a source to filter the list to it; a button such as "Audit: clear" appears beside the views so you can remove that filter.

### Views

The row of buttons above the list switches between ready-made views:

| View | Shows |
|---|---|
| **Open** | Every action that is not Done or Cancelled. This is the starting view. |
| **My actions** | Open actions you own. |
| **Overdue** | Open actions past their due date. |
| **Due this week** | Open actions due between today and Sunday. |
| **Information requests** | Actions whose source is Information request, open or not. |
| **All** | Every action, including Done and Cancelled. |

Within any view you can search, filter by **Status**, **Priority**, **Source**, **Owner** and **Due**, sort, save your own views and use **Export CSV**.

### What an action holds

| Field | Notes |
|---|---|
| **Title**, **Description** | What has to be done. |
| **Status** | **Open**, **In progress**, **Blocked**, **Done** or **Cancelled**. |
| **Priority** | **High**, **Medium** or **Low**. New actions start as Medium. |
| **Owner** | The person responsible. An action with no owner shows as Unassigned. |
| **Due** | The date it should be finished. Shown in red with "(overdue)" once that date has passed and the action is still open. |
| **Completed** | Filled in with today's date when the status becomes Done, and cleared if the action is reopened. |
| **Source** | Where the action came from: Risk, Assessment, Incident, Audit, Exercise, Information request, Project or Other. |
| **Department**, **External reference**, **Notes** | Optional. |

Each action has a reference beginning `ACT-`.

### Adding an action

1. On the action tracker, select **New action**, or use **Create > Action**.
2. Enter the **Title** and any **Description**.
3. Choose the **Priority**, **Owner** and **Due** date.
4. Choose the **Source** and add a **Department** or **Notes** if useful.
5. Save.

### Adding an action from a risk

1. Open the risk and select the **Actions** tab.
2. Select **Add action**.
3. Enter the **Title**, **Description**, **Priority**, **Owner**, **Due** date and **Department**, then save.

The action is tied to the risk. It appears on the risk's **Actions** tab and in the action tracker, where the **Arose from** column links back to the risk and the action's own page says "Arose from risk record".

In this version the risk is the only record with its own **Actions** tab. For an action arising from anything else, add it in the action tracker, choose the matching **Source**, and connect the two records on the action's **Related** tab (choose the **Record type**, find the **Record** and select **Add link**).

### Updating an action

- To change the status quickly, use the **Status** drop-down on the action's row in the tracker or on a risk's **Actions** tab. It saves immediately.
- To change anything else, open the action, select **Edit** on the **Details** card and save.
- Use the **Activity** tab to add comments, and the **History** tab to see every change.

Changing the status needs **Edit** on **Actions**; without it you see the status as a label.

## The obligations register

Open **Cybersecurity > Obligations**. An obligation is something the organisation must do because of a law, a regulation, a contract, a funding condition or an insurance policy. The register records each one, who owns it and how it is met. None are supplied with the application: they are loaded from your organisation's profile when the application is set up, or entered by hand.

| Field | What to put in it |
|---|---|
| **Obligation** | A short name for the requirement. |
| **Source** | Where it comes from, for example the name of the agreement or policy and the clause. |
| **Requirement** | What exactly must be done. |
| **Owner** | The person responsible for meeting it. |
| **How it is met** | The process or control that satisfies it. |
| **Evidence** | Where proof can be found. |
| **Next due** | The next date something must be done or reviewed. |
| **Status** | **Not assessed**, **Met**, **Partly met** or **Not met**. New obligations start as Not assessed. |

To add an obligation:

1. Select **New obligation**, or use **Create > Obligation**.
2. Fill in the fields above and save. The obligation is given a reference beginning `OBL-`.

To review an obligation, open it, select **Edit** on the **Details** card, update **Status**, **How it is met**, **Evidence** and **Next due**, and save.

The list can be searched, filtered by **Status**, **Owner** and **Next due**, sorted, saved as a view and exported. Use the **Related** tab on an obligation to link it to the framework outcomes, contracts or risks it concerns; see [Cybersecurity frameworks and assessments](05-cybersecurity-frameworks.md).

## Not available yet

- There is no screen for editing a risk scale: its levels, its grid of ratings or the executive-approval threshold.
- An acceptance cannot be withdrawn once recorded, and its expiry does not change the risk's status automatically.
- No reminders are sent for risk review dates, acceptance expiry, action due dates or obligation due dates. Use the filters and the **Overdue** and **Due this week** views instead.
- Only risks have an **Actions** tab. Other records cannot yet raise an action directly.
- The title of an action raised from a risk is visible to anyone who can see the action tracker, even if they cannot see the risk.
- Files cannot be attached to risks, actions or obligations.
