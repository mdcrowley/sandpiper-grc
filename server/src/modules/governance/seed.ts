import { approvalEngine } from '../../core/approval-kinds.ts';
import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';

/**
 * Dev profile only, all invented: a governing body, a risk committee and a joint labor-management
 * safety committee with sample members on both sides; four meetings (two held, with minutes,
 * attendance and decisions; two planned); actions agreed at the safety committee; and a sample
 * safety plan (a policy whose document type is a plan) with its element map and last year's review.
 *
 * Modules seed in key order, so the risks module's samples do not exist yet on the first run. When a
 * later run finds an approval waiting for the governing body's chair (for example a risk acceptance),
 * a sample decision is recorded at the last board meeting and applied to it; otherwise nothing is.
 */

const MARK = 'Invented sample record.';
const DAY = 86_400_000;

const SAMPLE_USERS = [
  { username: 'sample.gov.morgan', name: '[Sample] Morgan Ellery', role: 'compliance_officer' },   // secretary
  { username: 'sample.gov.riley', name: '[Sample] Riley Tanaka', role: 'security_lead' },         // board chair
  { username: 'sample.gov.jordan', name: '[Sample] Jordan Pereira', role: 'security_lead' },      // risk committee chair
  { username: 'sample.gov.sam', name: '[Sample] Sam Okafor', role: 'safety_manager' },            // safety committee co-chair (management)
  { username: 'sample.gov.quinn', name: '[Sample] Quinn Delacroix', role: 'safety_manager' },     // safety committee co-chair (labor)
];

async function sampleUsers(ctx: ModuleContext): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const p of SAMPLE_USERS) {
    let row = await ctx.db.one<Row>('select id from users where lower(username) = lower($1)', [p.username]);
    if (!row) {
      // No password: nobody can sign in as a sample person.
      row = (await ctx.db.one<Row>(`insert into users (username, email, display_name, status) values ($1,$2,$3,'active') returning id`,
        [p.username, `${p.username}@example.test`, p.name]))!;
      const role = await ctx.db.one<Row>('select id from roles where key = $1', [p.role]);
      if (role) await ctx.db.query('insert into user_roles (user_id, role_id) values ($1,$2) on conflict do nothing', [row.id, role.id]);
      await ctx.audit(null, { action: 'user.create', recordType: 'user', recordId: row.id, summary: `Sample person added: ${p.name}` });
    }
    ids.set(p.username, row.id);
  }
  return ids;
}

const at = (days: number, hour: number) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

export async function seedGovernance(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'nothing to load (sample committees are dev profile only)';
  // Sample people are only added once a real account exists (the setup wizard needs an empty user table).
  if (!(await ctx.db.one('select 1 from users limit 1'))) return 'nothing to load yet (no account exists)';
  if (await ctx.db.one('select 1 from committees where purpose like $1 limit 1', [`%${MARK}`])) {
    const applied = await applySample(ctx);
    return `sample committees already loaded${applied ? '; a sample decision was applied to a waiting approval' : ''}`;
  }
  const u = await sampleUsers(ctx);
  const secretary = u.get('sample.gov.morgan')!;

  const board = await ctx.resources.create('committee', {
    name: '[Sample] Board of directors', kind: 'governing_body', status: 'active', chair_id: u.get('sample.gov.riley'), secretary_id: secretary,
    quorum_rule: 'percent', quorum_value: 50, meeting_frequency: 'every_2_months', joint_labor_management: false,
    purpose: `Sets direction, approves the annual budget and the safety plan, and oversees risk. ${MARK}`,
  });
  const risk = await ctx.resources.create('committee', {
    name: '[Sample] Risk and audit committee', kind: 'risk', status: 'active', chair_id: u.get('sample.gov.jordan'), secretary_id: secretary,
    quorum_rule: 'count', quorum_value: 3, meeting_frequency: 'quarterly', joint_labor_management: false,
    purpose: `Reviews the risk register, risk acceptances, audit findings and corrective action plans. ${MARK}`,
  });
  const safety = await ctx.resources.create('committee', {
    name: '[Sample] Joint safety committee', kind: 'safety', status: 'active', chair_id: u.get('sample.gov.sam'), secretary_id: secretary,
    quorum_rule: 'percent', quorum_value: 60, meeting_frequency: 'monthly', joint_labor_management: true,
    purpose: `Management and frontline representatives review safety events, hazards and safety performance, and recommend improvements. ${MARK}`,
  });

  const member = async (committeeId: string, m: Row) => (await ctx.db.one<Row>(
    `insert into committee_members (committee_id, user_id, name, side, role, voting, from_on) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [committeeId, m.user_id ?? null, m.user_id ? null : m.name, m.side, m.role, m.voting ?? true, dayInZone(-400)]))!.id as string;
  const boardMembers = [
    await member(board.id, { user_id: u.get('sample.gov.riley'), name: '[Sample] Riley Tanaka', side: 'independent', role: 'chair' }),
    await member(board.id, { name: '[Sample] Taylor Brennan', side: 'independent', role: 'member' }),
    await member(board.id, { name: '[Sample] Harper Lindgren', side: 'independent', role: 'member' }),
    await member(board.id, { name: '[Sample] Rowan Castillo', side: 'independent', role: 'member' }),
    await member(board.id, { user_id: u.get('sample.gov.jordan'), name: '[Sample] Jordan Pereira', side: 'management', role: 'member', voting: false }),
  ];
  for (const m of [
    { user_id: u.get('sample.gov.jordan'), name: '[Sample] Jordan Pereira', side: 'independent', role: 'chair' },
    { name: '[Sample] Avery Kowalczyk', side: 'independent', role: 'member' },
    { name: '[Sample] Drew Achterberg', side: 'independent', role: 'member' },
    { name: '[Sample] Kai Mbeki', side: 'management', role: 'member' },
  ]) await member(risk.id, m);
  const safetyMembers = [
    await member(safety.id, { user_id: u.get('sample.gov.sam'), name: '[Sample] Sam Okafor', side: 'management', role: 'chair' }),
    await member(safety.id, { name: '[Sample] Ellis Varga', side: 'management', role: 'member' }),
    await member(safety.id, { name: '[Sample] Noor Haddad', side: 'management', role: 'member' }),
    await member(safety.id, { user_id: u.get('sample.gov.quinn'), name: '[Sample] Quinn Delacroix', side: 'labor', role: 'chair' }),
    await member(safety.id, { name: '[Sample] Jesse Moreau', side: 'labor', role: 'member' }),
    await member(safety.id, { name: '[Sample] Frankie Oyelaran', side: 'labor', role: 'member' }),
    await member(safety.id, { name: '[Sample] Robin Sato', side: 'labor', role: 'alternate', voting: false }),
  ];

  const plan = await samplePlan(ctx, u);

  // Two held meetings with minutes and decisions, two planned.
  const boardMeeting = await ctx.resources.create('meeting', {
    committee_id: board.id, title: '[Sample] Board meeting', scheduled_at: at(-45, 17), location: 'Board room, head office', status: 'held',
    minutes: '[Sample] The chair opened the meeting and confirmed the quorum.\n\n1. The annual review of the safety plan was presented and approved.\n2. The quarterly risk report was noted.\n\nThe meeting closed on time.',
  });
  const safetyMeeting = await ctx.resources.create('meeting', {
    committee_id: safety.id, title: '[Sample] Joint safety committee', scheduled_at: at(-12, 14), location: 'Depot training room', status: 'held',
    minutes: '[Sample] Members reviewed last month\'s safety events and the platform-edge hazard.\n\nThe revised platform-edge procedure was adopted; the depot lighting proposal was deferred until costs are known.',
  });
  await ctx.resources.create('meeting', { committee_id: safety.id, title: '[Sample] Joint safety committee', scheduled_at: at(4, 14), location: 'Depot training room', status: 'agenda_published' });
  await ctx.resources.create('meeting', { committee_id: risk.id, title: '[Sample] Risk and audit committee', scheduled_at: at(30, 15), location: 'Video call', status: 'planned' });

  const attend = async (meetingId: string, members: string[], absent: number[], apologies: number[]) => {
    for (const [i, id] of members.entries()) {
      await ctx.db.query('insert into meeting_attendance (meeting_id, member_id, present, apology) values ($1,$2,$3,$4) on conflict do nothing',
        [meetingId, id, !absent.includes(i), apologies.includes(i)]);
    }
  };
  await attend(boardMeeting.id, boardMembers, [3], [3]);
  await attend(safetyMeeting.id, safetyMembers, [2, 6], [2]);
  const { quorumOf } = await import('./committees.ts');
  for (const m of [boardMeeting, safetyMeeting]) await ctx.resources.update('meeting', m.id, { quorum_met: (await quorumOf(ctx, m)).met }, null);

  const item = async (meetingId: string, sort: number, title: string, presenter: string, record?: { type: string; id: string }) => (await ctx.db.one<Row>(
    `insert into agenda_items (meeting_id, sort, title, presenter, record_type, record_id) values ($1,$2,$3,$4,$5,$6) returning id`,
    [meetingId, sort, title, presenter, record?.type ?? null, record?.id ?? null]))!.id as string;
  const planItem = await item(boardMeeting.id, 10, 'Annual review of the safety plan', '[Sample] Sam Okafor', plan ? { type: 'policy', id: plan } : undefined);
  const riskItem = await item(boardMeeting.id, 20, 'Quarterly risk report', '[Sample] Jordan Pereira');
  const edgeItem = await item(safetyMeeting.id, 10, 'Platform-edge procedure', '[Sample] Ellis Varga');
  const lightItem = await item(safetyMeeting.id, 20, 'Depot lighting proposal', '[Sample] Jesse Moreau');

  const decide = (meetingId: string, agendaItemId: string, title: string, outcome: string, record?: { type: string; id: string }) =>
    ctx.resources.create('meeting_decision', { meeting_id: meetingId, agenda_item_id: agendaItemId, title, outcome, notes: MARK, record_type: record?.type ?? null, record_id: record?.id ?? null });
  await decide(boardMeeting.id, planItem, 'Approve the annual review of the safety plan', 'approved', plan ? { type: 'policy', id: plan } : undefined);
  await decide(boardMeeting.id, riskItem, 'Note the quarterly risk report', 'noted');
  await decide(safetyMeeting.id, edgeItem, 'Adopt the revised platform-edge procedure', 'approved');
  await decide(safetyMeeting.id, lightItem, 'Defer the depot lighting proposal until costs are known', 'deferred');

  // The board's minutes were approved by its chair (recorded directly for the sample).
  await ctx.resources.update('meeting', boardMeeting.id, { status: 'minutes_approved' }, null);

  let actions = 0;
  if (ctx.resources.get('action')) {
    for (const a of [
      { title: '[Sample] Brief all station staff on the revised platform-edge procedure', due_on: dayInZone(18), priority: 'high' },
      { title: '[Sample] Obtain two quotes for depot yard lighting', due_on: dayInZone(-2), priority: 'medium' },
    ]) {
      await ctx.resources.create('action', { ...a, status: 'open', owner_id: u.get('sample.gov.sam'), source: 'meeting', source_type: 'meeting', source_id: safetyMeeting.id, notes: MARK });
      actions += 1;
    }
  }
  const applied = await applySample(ctx);
  return `3 committees, 4 meetings, 4 decisions, ${actions} actions${plan ? ', a sample safety plan' : ''}${applied ? ', a decision applied to a waiting approval' : ''}`;
}

/** The sample safety plan: a policy of a plan document type, its element map and last year's approved review. */
async function samplePlan(ctx: ModuleContext, u: Map<string, string>): Promise<string | null> {
  const def = ctx.resources.get('policy');
  if (!def) return null;
  const column = await ctx.db.one(`select 1 from information_schema.columns where table_name = 'policies' and column_name = 'document_type'`);
  if (!column) return null; // the document type (contract C6) is not there yet
  const types = await ctx.lookups.values('policy_document_type');
  const planType = types.find((v) => v.meta?.plan === true)?.value ?? (types.length ? null : 'plan');
  if (!planType) return null;
  const existing = await ctx.db.one<Row>('select id from policies where title = $1 and deleted_at is null', ['[Sample] Safety plan']);
  if (existing) return existing.id;
  const policy = await ctx.resources.create('policy', {
    title: '[Sample] Safety plan', category: 'operations', owner_id: u.get('sample.gov.sam'),
    summary: 'How the organization manages safety: its safety policy and objectives, how safety risk is managed, how performance is assured and how safety is promoted. Invented sample.',
    approver_name: '[Sample] Accountable executive', approver_role: 'Accountable executive', review_date: dayInZone(320),
    ...('document_type' in def.fields ? { document_type: planType } : {}),
  });
  if (!('document_type' in def.fields)) await ctx.db.query('update policies set document_type = $2 where id = $1', [policy.id, planType]);
  const version = (await ctx.db.one<Row>(
    `insert into policy_versions (policy_id, version, body, change_summary, status, approved_by_name, approved_on) values ($1,1,$2,$3,'approved',$4,$5) returning *`,
    [policy.id, SAMPLE_PLAN_BODY, 'First version of the sample plan.', '[Sample] Accountable executive', dayInZone(-60)]))!;
  const { publishVersion } = await import('../policies/acknowledgments.ts');
  await publishVersion(ctx, null, policy, version, { now: new Date(Date.now() - 58 * DAY) });
  const elements = [
    ['policy_objectives', 'Safety policy statement signed by the accountable executive', '1.1', u.get('sample.gov.sam')],
    ['policy_objectives', 'Safety objectives and performance targets', '1.3', u.get('sample.gov.sam')],
    ['risk_management', 'Hazard identification and the hazard log', '2.1', u.get('sample.gov.sam')],
    ['risk_management', 'Safety risk assessment and the hazard matrix', '2.2', u.get('sample.gov.jordan')],
    ['assurance', 'Safety performance monitoring and indicators', '3.1', u.get('sample.gov.sam')],
    ['assurance', 'Management of change', '3.3', u.get('sample.gov.jordan')],
    ['promotion', 'Safety training and competence', '4.1', u.get('sample.gov.quinn')],
  ];
  for (const [i, [key, title, section, owner]] of elements.entries()) {
    await ctx.db.query('insert into policy_plan_elements (policy_id, element_key, title, section_ref, owner_id, sort) values ($1,$2,$3,$4,$5,$6)',
      [policy.id, key, title, `Section ${section}`, owner ?? null, (i + 1) * 10]);
  }
  const year = Number(dayInZone().slice(0, 4)) - 1;
  await ctx.db.query(
    `insert into policy_plan_reviews (policy_id, version_id, review_year, outcome, started_on, approved_on, note) values ($1,$2,$3,'approved',$4,$5,$6)`,
    [policy.id, version.id, year, dayInZone(-380), dayInZone(-350), 'Reviewed by the accountable executive, the board and the joint safety committee. Invented sample.']);
  return policy.id;
}

/** When an approval waits for the board's chair, record a sample decision on it at the last board meeting and apply it. */
async function applySample(ctx: ModuleContext): Promise<boolean> {
  const eng = approvalEngine(ctx.app);
  if (!eng) return false;
  if (await ctx.db.one(`select 1 from meeting_decisions where notes = $1 and applied_at is not null`, [`${MARK} Applied to a waiting approval.`])) return false;
  const board = await ctx.db.one<Row>(`select id, chair_id from committees where kind = 'governing_body' and purpose like $1 limit 1`, [`%${MARK}`]);
  const meeting = board ? await ctx.db.one<Row>(`select * from meetings where committee_id = $1 and status in ('held', 'minutes_approved') order by scheduled_at desc limit 1`, [board.id]) : undefined;
  if (!board?.chair_id || !meeting) return false;
  const { approvalKinds } = await import('../../core/approval-kinds.ts');
  for (const k of approvalKinds(ctx.app)) {
    if (!ctx.resources.get(k.recordType)) continue;
    const [recordId] = await eng.waiting(k.key, board.chair_id);
    if (!recordId) continue;
    const decision = await ctx.resources.create('meeting_decision', {
      meeting_id: meeting.id, title: `Approve the ${k.label.toLowerCase()} waiting for the chair`, outcome: 'approved',
      record_type: k.recordType, record_id: recordId, notes: `${MARK} Applied to a waiting approval.`,
    });
    try {
      await eng.decide(k.key, recordId, null, 'approved', `[Sample] Decided at ${meeting.ref}.`, { userId: board.chair_id, via: 'meeting' });
      await ctx.db.query('update meeting_decisions set applied_at = now(), applied_to_workflow = $2 where id = $1', [decision.id, `[Sample] ${k.label}: approved as the chair`]);
      return true;
    } catch {
      // The chair could not decide it (another rule of the engine): the sample decision is taken back.
      await ctx.db.query(`delete from record_links where from_type = 'meeting_decision' and from_id = $1`, [decision.id]);
      await ctx.db.query('delete from meeting_decisions where id = $1', [decision.id]);
    }
  }
  return false;
}

const SAMPLE_PLAN_BODY = `## Purpose

[Sample] This plan describes how the organization manages the safety of its passengers, staff and the public. It is invented sample text.

## 1. Safety policy and objectives

The accountable executive signs the safety policy. Safety objectives and performance targets are set each year and reported to the board.

## 2. Safety risk management

Hazards are identified from safety events, inspections, staff reports and changes, recorded in the hazard log and assessed on the hazard matrix.

## 3. Safety assurance

Safety performance indicators are monitored monthly. Changes to services, vehicles and systems are assessed for their safety impact before they go ahead.

## 4. Safety promotion

Staff are trained for their roles, and safety lessons are shared through briefings and the joint safety committee.
`;
