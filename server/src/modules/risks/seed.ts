import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';

// Seed loader. Pilot: information requests from the seed folder, when the file is there (read
// at run time, never copied into the repository). Dev: invented actions and example
// obligations. Both: obligations from the organisation profile and clearly invented sample risks.

const day = (offset: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const REQUESTS_FILE = 'information_requests.psv';

/**
 * Loads the optional information-requests file as actions. It is pipe-delimited with the
 * header ID|Dept|Item|Why|Feeds|Form|Priority|IfNone. Idempotent on the row's own identifier.
 * Returns null when the seed folder has no such file.
 */
async function loadInformationRequests(ctx: ModuleContext, opts: SeedOptions): Promise<{ added: number; skipped: number } | null> {
  if (!existsSync(join(opts.seedDir, REQUESTS_FILE))) return null;
  const rows = ctx.readSeed(opts, REQUESTS_FILE, '|');
  const priorities = new Set((await ctx.lookups.values('action_priority')).map((p) => p.value));
  let added = 0;
  let skipped = 0;
  for (const r of rows) {
    const id = String(r.ID ?? '').trim();
    const title = String(r.Item ?? '').trim();
    if (!id || !title) { skipped += 1; continue; }
    if (await ctx.db.one(`select 1 from actions where external_ref = $1 and source = 'information_request'`, [id])) { skipped += 1; continue; }
    const priority = String(r.Priority ?? '').trim().toLowerCase();
    const notes = [['Feeds', r.Feeds], ['Form', r.Form], ['If none', r.IfNone]]
      .filter(([, v]) => String(v ?? '').trim())
      .map(([k, v]) => `${k}: ${String(v).trim()}`)
      .join('\n');
    await ctx.resources.create('action', {
      title,
      description: String(r.Why ?? '').trim() || null,
      source: 'information_request',
      external_ref: id,
      department: String(r.Dept ?? '').trim() || null,
      priority: priorities.has(priority) ? priority : 'medium',
      status: 'open',
      notes: notes || null,
    });
    added += 1;
  }
  return { added, skipped };
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
  type Sample = Row & { actions?: Row[]; acceptance?: Row };
  // Scores are [likelihood, impact]; on the safety hazard scale impact is severity (1-4).
  const samples: Sample[] = [
    {
      title: '[Sample] Ransomware stops core business systems', category: 'cyber',
      description: 'Invented example. Malicious software encrypts the servers that run day-to-day operations.',
      cause: 'A member of staff opens a harmful attachment', consequence: 'Work is done on paper for several days',
      affected: 'Line-of-business systems', existing_controls: 'Email filtering; off-site backups',
      inherent: [4, 5], residual: [3, 4], treatment: 'mitigate', status: 'in_treatment', due_on: day(45), review_on: day(90),
      actions: [
        { title: 'Run a restore test of the main business database', priority: 'high', due_on: day(14) },
        { title: 'Turn on attachment sandboxing for all mailboxes', priority: 'medium', due_on: day(30) },
      ],
    },
    {
      title: '[Sample] Staff account taken over through a fake sign-in page', category: 'cyber',
      description: 'Invented example. A password is captured and used to read mail.',
      cause: 'Convincing phishing message', consequence: 'Mailbox contents exposed; fraudulent messages sent',
      affected: 'Email and document storage', existing_controls: 'Second factor for most staff',
      inherent: [5, 3], residual: [3, 3], treatment: 'mitigate', status: 'open', due_on: day(60), review_on: day(120),
      actions: [{ title: 'Enrol the remaining accounts in the second factor', priority: 'high', due_on: day(-3) }],
    },
    {
      title: '[Sample] Key supplier fails with no exit plan', category: 'third_party',
      description: 'Invented example. A hosted system is withdrawn at short notice.',
      cause: 'Supplier ceases trading', consequence: 'Months of manual working while a replacement is bought',
      affected: 'Hosted payroll service', existing_controls: 'Contract includes data return',
      inherent: [2, 4], residual: [2, 3], treatment: 'transfer', status: 'open', review_on: day(180),
    },
    {
      title: '[Sample] Old workstation left unpatched in a branch office', category: 'cyber',
      description: 'Invented example. A machine no one owns misses updates for a year.',
      cause: 'Not in the inventory', consequence: 'Foothold for an attacker on the internal network',
      affected: 'Branch office network', existing_controls: 'Network segmentation',
      inherent: [3, 3], residual: [2, 2], treatment: 'accept', status: 'accepted', review_on: day(150),
      acceptance: {
        approver_name: 'Sample Approver', approver_title: 'Chief Information Officer', approved_on: day(-30), expires_on: day(335),
        reference: 'SAMPLE-MEMO-001', rationale: 'Invented example: the machine is isolated and due for replacement next year.',
      },
    },
    {
      title: '[Sample] Budget cycle delays a planned system replacement', category: 'enterprise',
      description: 'Invented example. Funding slips a year and support for the old system ends.',
      cause: 'Competing capital priorities', consequence: 'Running an unsupported system',
      affected: 'Finance system', existing_controls: 'Extended support agreement',
      inherent: [3, 4], residual: [3, 2], treatment: 'mitigate', status: 'open', due_on: day(200),
    },
    {
      title: '[Sample] Total loss of the main data room', category: 'enterprise',
      description: 'Invented example. Fire or flood destroys on-site equipment.',
      cause: 'Building incident', consequence: 'All on-site systems unavailable until rebuilt elsewhere',
      affected: 'All on-site systems', existing_controls: 'Off-site backups',
      inherent: [1, 5], residual: null, treatment: 'avoid', status: 'open', review_on: day(365),
    },
    {
      title: '[Sample] Fire alarm panel fault goes unnoticed', category: 'safety',
      description: 'Invented example. The alarm panel stops reporting to the monitoring service for part of a week.',
      cause: 'Network change cuts off the alarm panel', consequence: 'Delayed response to a fire out of hours',
      affected: 'Building alarm system', existing_controls: 'Weekly alarm test',
      inherent: [3, 3], residual: [2, 3], treatment: 'mitigate', status: 'in_treatment', due_on: day(75),
    },
    {
      title: '[Sample] Door access system fails locked during an evacuation', category: 'safety',
      description: 'Invented example. Controlled doors do not release when the alarm sounds.',
      cause: 'Door controller fault', consequence: 'People are slowed on their way out of the building',
      affected: 'Door access control', existing_controls: 'Manual release at each door; quarterly evacuation drill',
      inherent: [4, 2], residual: [2, 1], treatment: 'mitigate', status: 'open', due_on: day(120),
    },
  ];
  let added = 0;
  for (const { inherent, residual, actions, acceptance, ...s } of samples) {
    if (await ctx.db.one('select 1 from risks where title = $1', [s.title])) continue;
    const risk = await ctx.resources.create('risk', {
      ...s,
      inherent_likelihood: inherent?.[0] ?? null, inherent_impact: inherent?.[1] ?? null,
      residual_likelihood: residual?.[0] ?? null, residual_impact: residual?.[1] ?? null,
    });
    for (const a of actions ?? []) {
      await ctx.resources.create('action', { ...a, source: 'risk', source_type: 'risk', source_id: risk.id, department: 'IT' });
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

interface ObligationSeed { title: string; source?: string; requirement?: string; how_met?: string; evidence?: string; next_due_on?: string }

/** Invented, sector-neutral examples for the dev profile. */
const DEV_OBLIGATIONS: ObligationSeed[] = [
  {
    title: 'Annual payment security self-assessment', source: 'Payment provider agreement (invented example)',
    requirement: 'Complete the self-assessment questionnaire every 12 months and keep service provider attestations on file',
  },
  {
    title: 'Cyber insurance policy conditions', source: 'Cyber insurance policy (invented example)',
    requirement: 'Second factor on remote access; tested off-site backups; notify the insurer promptly of any incident',
  },
  {
    title: 'Data protection breach reporting', source: 'Data protection law (invented example)',
    requirement: 'Assess every personal data breach and report qualifying breaches to the regulator within the legal time limit',
  },
  {
    title: 'Software licence true-up', source: 'Enterprise licence agreement (invented example)',
    requirement: 'Report the number of users to the supplier once a year',
  },
];

/**
 * Creates the obligations that are not there yet, matched by title, through the resource
 * engine so they are numbered and audited. An existing obligation is never changed, and a
 * deleted one is not brought back, so later edits and deletions stick.
 */
async function loadObligations(ctx: ModuleContext, list: unknown): Promise<number> {
  if (!Array.isArray(list)) return 0;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  let added = 0;
  for (const o of list as Partial<ObligationSeed>[]) {
    const title = text(o?.title);
    if (!title) continue;
    if (await ctx.db.one('select 1 from obligations where title = $1', [title])) continue;
    await ctx.resources.create('obligation', {
      title, source: text(o.source), requirement: text(o.requirement),
      how_met: text(o.how_met), evidence: text(o.evidence), next_due_on: text(o.next_due_on),
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
      parts.push(`${loaded.added} information-request actions added, ${loaded.skipped} skipped (${total} in total)`);
    }
  } else {
    parts.push(`${await devActions(ctx)} invented actions added`);
  }
  parts.push(`${await sampleRisks(ctx)} sample risks added`);
  let obligationsAdded = await loadObligations(ctx, opts.organisation?.obligations);
  if (opts.profile === 'dev') obligationsAdded += await loadObligations(ctx, DEV_OBLIGATIONS);
  const obligations = (await ctx.db.one<{ c: number }>('select count(*)::int as c from obligations where deleted_at is null'))!.c;
  parts.push(`${obligationsAdded} obligations added (${obligations} in the register)`);
  return parts.join('; ');
}