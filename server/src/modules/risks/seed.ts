import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { seedCaps } from './seed-caps.ts';
import { seedCompliance } from './seed-compliance.ts';

// Seed loader. Pilot: information requests from the seed folder, when the file is there (read
// at run time, never copied into the repository). Dev: invented actions, clearly invented sample
// risks and example obligations (E18-69: none of these in the pilot). Both: obligations from the
// organization profile.

const day = (offset: number): string => dayInZone(offset);

const REQUESTS_FILE = 'information_requests.psv';

/**
 * Loads the optional information-requests file as actions. It is pipe-delimited with the
 * header ID|Dept|Item|Why|Feeds|Form|Priority|IfNone. Idempotent on the row's own identifier.
 * Returns null when the seed folder has no such file.
 */
async function loadInformationRequests(ctx: ModuleContext, opts: SeedOptions): Promise<{ added: number; updated: number; unchanged: number } | null> {
  if (!existsSync(join(opts.seedDir, REQUESTS_FILE))) return null;
  const rows = ctx.readSeed(opts, REQUESTS_FILE, '|');
  const priorities = new Set((await ctx.lookups.values('action_priority')).map((p) => p.value));
  const FIELDS = ['title', 'description', 'department', 'priority', 'notes'] as const;
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const r of rows) {
    const id = String(r.ID ?? '').trim();
    const title = String(r.Item ?? '').trim();
    if (!id || !title) { unchanged += 1; continue; }
    const priority = String(r.Priority ?? '').trim().toLowerCase();
    const notes = [['Feeds', r.Feeds], ['Form', r.Form], ['If none', r.IfNone]]
      .filter(([, v]) => String(v ?? '').trim())
      .map(([k, v]) => `${k}: ${String(v).trim()}`)
      .join('\n');
    const imported: Row = {
      title,
      description: String(r.Why ?? '').trim() || null,
      department: String(r.Dept ?? '').trim() || null,
      priority: priorities.has(priority) ? priority : 'medium',
      notes: notes || null,
    };
    const existing = await ctx.db.one<Row>(
      `select id, title, description, department, priority, notes, import_snapshot, deleted_at
       from actions where external_ref = $1 and source = 'information_request' order by deleted_at nulls first limit 1`, [id]);
    if (!existing) {
      const made = await ctx.resources.create('action', { ...imported, source: 'information_request', external_ref: id, status: 'open' });
      await ctx.db.query('update actions set import_snapshot = $2::jsonb where id = $1', [made.id, JSON.stringify(imported)]);
      added += 1;
      continue;
    }
    // A deleted request is not brought back, and one whose file row has not changed is left alone.
    const snapshot: Row | null = existing.import_snapshot ?? null;
    if (existing.deleted_at || (snapshot && FIELDS.every((k) => (snapshot[k] ?? null) === imported[k]))) { unchanged += 1; continue; }
    // The file row changed. A field is brought up to date unless it was edited in the application
    // since the last load (its value no longer matches what was loaded then). Rows loaded before
    // this bookkeeping existed have no record of that, so the file wins for them, once.
    const patch: Row = {};
    for (const k of FIELDS) {
      if ((existing[k] ?? null) !== imported[k] && (!snapshot || (existing[k] ?? null) === (snapshot[k] ?? null))) patch[k] = imported[k];
    }
    if (Object.keys(patch).length) {
      await ctx.resources.update('action', existing.id, patch);
      updated += 1;
    } else {
      unchanged += 1;
    }
    await ctx.db.query('update actions set import_snapshot = $2::jsonb where id = $1', [existing.id, JSON.stringify(imported)]);
  }
  return { added, updated, unchanged };
}

async function devActions(ctx: ModuleContext): Promise<number> {
  const owner = (await ctx.db.one<{ id: string }>(`select id from users where status = 'active' and deleted_at is null order by created_at limit 1`))?.id ?? null;
  const items: Row[] = [
    { title: 'Confirm who holds the spare keys to the server room', source: 'audit', priority: 'medium', department: 'Facilities', due_on: day(-6), owner_id: owner },
    { title: 'Send the list of shared mailboxes and their owners', source: 'information_request', priority: 'high', department: 'Customer Service', due_on: day(2) },
    { title: 'Provide the current after-hours call-out roster', source: 'information_request', priority: 'medium', department: 'Operations', due_on: day(4), owner_id: owner },
    { title: 'Write up findings from the spring restore test', source: 'exercise', priority: 'medium', department: 'IT', due_on: day(-12), status: 'in_progress', owner_id: owner },
    { title: 'Agree a review date for the visitor Wi-Fi terms', source: 'assessment', priority: 'low', department: 'IT', due_on: day(21) },
    { title: 'Replace the unsupported label printer in the post room', source: 'assessment', priority: 'medium', department: 'Operations', due_on: day(35), status: 'blocked', notes: 'Waiting for a quote.' },
    { title: 'Collect signed acceptable-use forms from new starters', source: 'audit', priority: 'high', department: 'Human Resources', due_on: day(1), owner_id: owner },
    { title: 'Record lessons learned from the phishing drill', source: 'exercise', priority: 'low', department: 'IT', due_on: day(-20), status: 'done' },
    { title: 'Send the building management system supplier contact sheet', source: 'information_request', priority: 'low', department: 'Facilities', due_on: day(10) },
    { title: 'Update the intranet project risk log', source: 'project', priority: 'medium', department: 'Planning', due_on: day(6), owner_id: owner },
    { title: 'Close out actions from the tabletop incident review', source: 'incident', priority: 'high', department: 'IT', due_on: day(-2), status: 'in_progress' },
    { title: 'Decide whether to keep the legacy fax line', source: 'other', priority: 'low', department: 'Finance', due_on: null, status: 'cancelled' },
  ];
  let added = 0;
  for (const [i, item] of items.entries()) {
    const ref = `DEV-${String(i + 1).padStart(2, '0')}`;
    if (await ctx.db.one('select 1 from actions where external_ref = $1', [ref])) continue;
    await ctx.resources.create('action', { ...item, external_ref: ref });
    added += 1;
  }
  return added;
}

/** About eight invented risks spread across both scales and the heat map. */
async function sampleRisks(ctx: ModuleContext): Promise<number> {
  // `reviewed` is an earlier review: [days ago, residual rating then, residual score then].
  type Sample = Row & { actions?: Row[]; acceptance?: Row; reviewed?: [number, string, number]; target?: [number, number] };
  // Scores are [likelihood, impact]; on the safety hazard scale impact is severity (1-4).
  const samples: Sample[] = [
    {
      title: '[Sample] CAD/AVL outage during peak service', category: 'cyber',
      description: 'Invented example. The computer-aided dispatch and automatic vehicle location system stops during the morning peak.',
      cause: 'A failed update on the dispatch servers', consequence: 'Controllers lose sight of vehicles; service runs on radio and paper until it is restored',
      affected: 'CAD/AVL servers; operations control room', existing_controls: 'Backup control room; radio voice procedures',
      inherent: [4, 5], residual: [3, 4], target: [2, 4], target_on: day(120), treatment: 'mitigate', status: 'in_treatment', due_on: day(45), review_on: day(90),
      reviewed: [60, 'extreme', 479],
      actions: [
        { title: 'Test failover of the dispatch servers to the backup control room', priority: 'high', due_on: day(14) },
        { title: 'Write the manual dispatch procedure for a peak-hour outage', priority: 'medium', due_on: day(30) },
      ],
    },
    {
      title: '[Sample] Ransomware on the fare collection system', category: 'cyber',
      description: 'Invented example. Malicious software encrypts the back office that settles fares and passes.',
      cause: 'An administrator account is phished', consequence: 'Fares cannot be settled and passes cannot be sold online for several days',
      affected: 'Fare back office; ticket vending machines', existing_controls: 'Email filtering; off-site backups of the fare database',
      inherent: [5, 3], residual: [3, 3], target: [2, 3], target_on: day(90), treatment: 'mitigate', status: 'open', due_on: day(60), review_on: day(-4),
      reviewed: [95, 'low', 116],
      actions: [{ title: 'Enroll every fare system administrator in the second factor', priority: 'high', due_on: day(-3) }],
    },
    {
      title: '[Sample] Scheduling software supplier fails with no exit plan', category: 'third_party',
      description: 'Invented example. The hosted service that builds timetables and duty rosters is withdrawn at short notice.',
      cause: 'Supplier ceases trading', consequence: 'Timetable and roster changes are made by hand for months',
      existing_controls: 'Contract includes data return',
      inherent: [2, 4], residual: [2, 3], treatment: 'transfer', status: 'open', review_on: day(180),
    },
    {
      title: '[Sample] Depot network compromised through an unpatched workstation', category: 'cyber',
      description: 'Invented example. A workshop PC no one owns misses updates for a year.',
      cause: 'Not in the inventory', consequence: 'Foothold for an attacker on the depot network',
      affected: 'Depot workshop network', existing_controls: 'Depot network separated from the control network',
      inherent: [3, 3], residual: [2, 2], treatment: 'accept', status: 'accepted', review_on: day(150),
      acceptance: {
        approver_name: 'Sample Approver', approver_title: 'Chief Information Officer', approved_on: day(-30), expires_on: day(335),
        reference: 'SAMPLE-MEMO-001', rationale: 'Invented example: the PC is isolated and due for replacement next year.',
      },
    },
    {
      title: '[Sample] Budget cycle delays replacement of the on-board radio system', category: 'enterprise',
      description: 'Invented example. Funding slips a year and support for the old radios ends.',
      cause: 'Competing capital priorities', consequence: 'Running radios the maker no longer supports',
      existing_controls: 'Extended support agreement; stock of spare handsets',
      inherent: [3, 4], residual: [3, 2], target: [2, 2], target_on: day(365), treatment: 'mitigate', status: 'open', due_on: day(200),
    },
    {
      title: '[Sample] Total loss of the operations control center data room', category: 'enterprise',
      description: 'Invented example. Fire or flood destroys the equipment in the control center.',
      cause: 'Building incident', consequence: 'All control center systems unavailable until rebuilt elsewhere',
      existing_controls: 'Off-site backups',
      inherent: [1, 5], residual: null, treatment: 'avoid', status: 'open', review_on: day(365),
    },
    {
      title: '[Sample] Signal priority fault at a busy junction goes unnoticed', category: 'safety',
      description: 'Invented example. The traffic signal priority link for buses drops for part of a week.',
      cause: 'Network change cuts off the junction controller', consequence: 'Buses and general traffic conflict at a busy junction',
      existing_controls: 'Daily link health check',
      inherent: [3, 3], residual: [2, 3], treatment: 'mitigate', status: 'in_treatment', due_on: day(75),
    },
    {
      title: '[Sample] Depot door access fails locked during an evacuation', category: 'safety',
      description: 'Invented example. Controlled depot doors do not release when the fire alarm sounds.',
      cause: 'Door controller fault', consequence: 'Staff are slowed on their way out of the depot',
      existing_controls: 'Manual release at each door; quarterly evacuation drill',
      inherent: [4, 2], residual: [2, 1], treatment: 'mitigate', status: 'open', due_on: day(120),
    },
    {
      title: '[Sample] Ticket vending machines run an unsupported operating system', category: 'cyber',
      description: 'Invented example. The machines cannot be upgraded until the supplier releases new software.',
      cause: 'The vending software only runs on the older system', consequence: 'A machine could be tampered with to skim card details',
      affected: 'Ticket vending machines', existing_controls: 'Machines on their own network; card payments handled by a separate sealed reader',
      inherent: [3, 3], residual: [2, 3], treatment: 'accept', status: 'accepted', review_on: day(20),
      acceptance: {
        approver_name: 'Sample Approver', approver_title: 'Chief Information Officer', approved_on: day(-160), expires_on: day(21),
        reference: 'SAMPLE-MEMO-002', rationale: 'Invented example: accepted for six months while the supplier releases new software.',
      },
    },
  ];
  // Owned by the first person set up, so the samples show an owner as real risks would.
  const owner = (await ctx.db.one<{ id: string }>(`select id from users where status = 'active' and deleted_at is null order by created_at limit 1`))?.id ?? null;
  let added = 0;
  for (const { inherent, residual, target, actions, acceptance, reviewed, ...s } of samples) {
    if (await ctx.db.one('select 1 from risks where title = $1', [s.title])) continue;
    const risk = await ctx.resources.create('risk', {
      owner_id: owner,
      ...s,
      inherent_likelihood: inherent?.[0] ?? null, inherent_impact: inherent?.[1] ?? null,
      residual_likelihood: residual?.[0] ?? null, residual_impact: residual?.[1] ?? null,
      target_likelihood: target?.[0] ?? null, target_impact: target?.[1] ?? null,
    });
    for (const a of actions ?? []) {
      await ctx.resources.create('action', { owner_id: owner, ...a, source: 'risk', source_type: 'risk', source_id: risk.id, department: 'IT' });
    }
    if (reviewed) {
      const [daysAgo, rating, score] = reviewed;
      await ctx.db.query(
        `insert into risk_reviews (risk_id, reviewed_on, note, next_review_on, inherent_rating, inherent_score, residual_rating, residual_score, summary_level, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [risk.id, day(-daysAgo), 'Invented example of an earlier review.', s.review_on ?? null, risk.inherent_rating, risk.inherent_score, rating, score, null, 'open']);
      await ctx.db.query('update risks set last_reviewed_on = $2 where id = $1', [risk.id, day(-daysAgo)]);
      await ctx.audit(null, { action: 'risk.review', recordType: 'risk', recordId: risk.id, summary: `Sample review recorded for ${risk.ref}` });
    }
    if (acceptance) {
      const row = await ctx.db.one<Row>(
        `insert into risk_acceptances (risk_id, approver_name, approver_title, approved_on, expires_on, reference, rationale, rating_at_acceptance)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [risk.id, acceptance.approver_name, acceptance.approver_title, acceptance.approved_on, acceptance.expires_on,
          acceptance.reference, acceptance.rationale, risk.residual_rating ?? risk.inherent_rating],
      );
      await ctx.audit(null, { action: 'risk.accept', recordType: 'risk', recordId: risk.id, summary: `Sample acceptance recorded for ${risk.ref}`, after: row });
    }
    added += 1;
  }
  return added;
}

interface ObligationSeed {
  title: string; source?: string; requirement?: string; how_met?: string; evidence?: string; next_due_on?: string; status?: string;
  /** E30-01: values of the lists obligation_type and obligation_frequency, and what it applies to (names). */
  type?: string; frequency?: string; applies_to?: string[];
}

const firstUser = async (ctx: ModuleContext): Promise<string | null> =>
  (await ctx.db.one<{ id: string }>(`select id from users where status = 'active' and deleted_at is null order by created_at limit 1`))?.id ?? null;

/** Invented examples for the dev profile, with due dates spread around today so the countdowns show. */
const devObligations = (): ObligationSeed[] => [
  {
    title: 'Annual payment security self-assessment', source: 'Payment provider agreement (invented example)',
    requirement: 'Complete the self-assessment questionnaire every 12 months and keep service provider attestations on file',
    how_met: 'Fare systems team completes the questionnaire each spring', status: 'met', next_due_on: day(120),
    type: 'contract', frequency: 'yearly', applies_to: ['Fare collection'],
  },
  {
    title: 'Cyber insurance policy conditions', source: 'Cyber insurance policy (invented example)',
    requirement: 'Second factor on remote access; tested off-site backups; notify the insurer promptly of any incident',
    how_met: 'Second factor on remote access; quarterly restore test', status: 'partly_met', next_due_on: day(18),
    type: 'contract', frequency: 'yearly',
  },
  {
    title: 'Safety management system review of technology changes', source: 'Safety management plan (invented example)',
    requirement: 'Assess every change to dispatch, signal-priority and passenger information systems for safety hazards before it goes live',
    status: 'not_met', next_due_on: day(-5), type: 'internal', frequency: 'monthly', applies_to: ['Bus operations', 'Light rail'],
  },
  {
    title: 'Software license true-up', source: 'Enterprise license agreement (invented example)',
    requirement: 'Report the number of users to the supplier once a year', next_due_on: day(64), type: 'contract', frequency: 'yearly',
  },
];
/**
 * Creates the obligations that are not there yet, matched by title, through the resource
 * engine so they are numbered and audited. An existing obligation is never changed, and a
 * deleted one is not brought back, so later edits and deletions stick.
 */
async function loadObligations(ctx: ModuleContext, list: unknown, ownerId: string | null = null): Promise<number> {
  if (!Array.isArray(list)) return 0;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const statuses = new Set((await ctx.lookups.values('obligation_status')).map((v) => v.value));
  const types = new Set((await ctx.lookups.values('obligation_type')).map((v) => v.value));
  const frequencies = new Set((await ctx.lookups.values('obligation_frequency')).map((v) => v.value));
  let added = 0;
  for (const o of list as Partial<ObligationSeed>[]) {
    const title = text(o?.title);
    if (!title) continue;
    if (await ctx.db.one('select 1 from obligations where title = $1', [title])) continue;
    const status = text(o.status);
    const type = text(o.type);
    const frequency = text(o.frequency);
    const appliesTo = Array.isArray(o.applies_to) ? o.applies_to.map(text).filter((x): x is string => !!x).slice(0, 50) : [];
    await ctx.resources.create('obligation', {
      title, source: text(o.source), requirement: text(o.requirement),
      how_met: text(o.how_met), evidence: text(o.evidence), next_due_on: text(o.next_due_on),
      ...(status && statuses.has(status) ? { status } : {}),
      ...(type && types.has(type) ? { type } : {}),
      ...(frequency && frequencies.has(frequency) ? { frequency } : {}),
      ...(appliesTo.length ? { applies_to: appliesTo } : {}),
      ...(ownerId ? { owner_id: ownerId } : {}),
    });
    added += 1;
  }
  return added;
}

export async function seedRisksModule(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  const parts: string[] = [];
  if (opts.profile === 'pilot') {
    const loaded = await loadInformationRequests(ctx, opts);
    if (!loaded) {
      parts.push(`no ${REQUESTS_FILE} in the seed folder, so no information-request actions loaded`);
    } else {
      const total = (await ctx.db.one<{ c: number }>(
        `select count(*)::int as c from actions where source = 'information_request' and external_ref is not null`))!.c;
      parts.push(`${loaded.added} information-request actions added, ${loaded.updated} updated, ${loaded.unchanged} unchanged (${total} in total)`);
    }
  } else {
    parts.push(`${await devActions(ctx)} invented actions added`);
    parts.push(`${await sampleRisks(ctx)} sample risks added`);
  }
  let obligationsAdded = await loadObligations(ctx, opts.organization?.obligations);
  if (opts.profile === 'dev') obligationsAdded += await loadObligations(ctx, devObligations(), await firstUser(ctx));
  const obligations = (await ctx.db.one<{ c: number }>('select count(*)::int as c from obligations where deleted_at is null'))!.c;
  parts.push(`${obligationsAdded} obligations added (${obligations} in the register)`);
  // Corrective action plans (E23, seed-caps.ts) and the compliance samples (E30, seed-compliance.ts).
  const caps = await seedCaps(ctx, opts);
  if (caps) parts.push(caps);
  const compliance = await seedCompliance(ctx, opts);
  if (compliance) parts.push(compliance);
  return parts.join('; ');
}