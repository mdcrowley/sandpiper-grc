# Legal holds

A **legal hold** keeps records for a matter, such as a claim, a dispute or an investigation, for as long as counsel needs them. While a hold is active, nothing under it can be **deleted**, **removed for good**, **anonymized** or **lose its files**, whoever asks and whatever parts of the application are switched on or off. Open **Administration > Legal holds**. Lists and record pages work as described in [Getting started](01-getting-started.md).

Legal holds are always on: they are not one of the parts an administrator can switch off under **Administration > Features**, and a hold keeps working when the part a held record belongs to is switched off. The record then cannot be opened until its part is back on, and it still cannot be deleted, removed or anonymized.

You need the **legal** permissions: `legal.view` to read holds and to see the hold banner on a record, `legal.create` and `legal.edit` to place holds, add records and save queries, `legal.approve` to approve a release (or release a hold directly when no release workflow is set up), `legal.delete` to delete a released hold, and `legal.administer` to run the saved queries by hand. The default **Records and privacy officer** role holds all of them; **Compliance officer** and **Auditor** can read holds. An administrator can grant them to any other role under **Administration > Roles**.

## Place a hold

1. Select **New legal hold**, or **Create** then **Legal hold**.
2. Enter the **Matter** (what the hold is for), a **Description**, the **Custodian** (who looks after the hold), the **Counsel** advising, the date it **Starts** (today when left empty) and, if you know it, its **Expected end**. The expected end is a note only: a hold lasts until it is released.
3. Select **Create legal hold**. It gets a reference such as `LGH-00001`.

The matter is shown only to people who may read holds. Anyone else who tries to delete a held record is told only the hold's reference.

## Records

The **Records** tab lists the records under the hold that you may see, with when and how each was added (by hand or by a saved query). The line above the list counts every held record, including the restricted ones you cannot see and those of a part that is switched off.

- **Add a record** places one record under the hold: choose the **Kind of record**, then the record, and select **Place under hold**. Only records you can see can be chosen by hand.
- **Take off** releases one record from the hold. It stays in the hold's history under **Taken off the hold**, and a saved query does not put it back. Adding it again by hand does.

A record that was deleted from its list is still kept while it is held, and is marked **Deleted from lists, kept**.

## Queries

A saved query holds every record of a kind that matches it: now, and every night from then on, as new records appear. It covers restricted records too, because a hold must cover everything. It only ever adds records; it never takes any off.

1. Open the **Queries** tab and select **Save a query**.
2. Choose the **Kind of record**.
3. Enter **Search words** (matched in the title, the reference and the searchable text), and add conditions on fields: a field **is** a value (several values separated by commas), **is empty**, or is **on or after** or **on or before** a date or number.
4. Select **Save and run**. The message says how many records match and how many were added.

A query needs search words or at least one condition. Searching the words or people of a kind of record that may be restricted needs permission to see restricted records; without it, filter by status, dates or numbers instead. **Run now** runs a query at once, and **Remove** stops it adding records (the records it added stay held). A query on records you cannot see shows only its count.

## On a held record

People who may read holds see a **Legal hold** banner at the top of a held record's page, with the hold's reference. Everyone else sees no banner, but deleting, removing or anonymizing the record, or removing one of its files, is refused with "This record is under a legal hold (LGH-00001) and cannot be deleted." This applies everywhere:

- deleting a record from its page or from a list (one by one or in bulk);
- removing or anonymizing a record at the end of its retention period (see [Retention](09-administration.md#retention));
- removing a file from the record, and the later clean-up of removed files: a file removed before the hold was placed stays in storage until the hold is released;
- merging duplicate vulnerability findings (a held finding is not merged away).

An active hold is held itself: it cannot be deleted or anonymized until it is released.

## Retention

The daily retention check skips held records: they are not flagged for review while they are held, and **Run the check now** says how many were left out. A record flagged before the hold was placed stays on the review list marked **Held** with the hold's reference: it can be kept longer, but not anonymized or removed. Filter the list with **Legal hold** (**Held only** or **Not held**). See [Retention](09-administration.md#retention).

## Release a hold

Open the **Release** tab and select **Release the hold…**, then say why it can be released.

- With a **Legal hold release** approval workflow set up (a new installation has one, decided by anyone who may approve legal holds), the release waits for approval and the tab shows the request. Approval releases the hold; rejection keeps it active, with the reason in its history. See [Approval workflows](22-approval-workflows.md).
- With no workflow, someone who may approve legal holds (`legal.approve`) releases it at once. The release is recorded in the history with their name and the reason.

A released hold shows when, by whom and why. Its records then follow their retention periods again, unless another active hold still holds them. Records cannot be added to a released hold; place a new one instead.

## Sample data

The sample data (development profile) holds one active invented hold, "Sample matter: platform incident claim (sample)", with two sample safety events placed by hand and a saved query holding the sample security incident. The records are placed once the server has started after loading the samples.
