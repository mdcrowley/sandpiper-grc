// Business impact analyses (E31-02): per process and year, the impact of an outage over time bands
// (operational, safety, financial, reputational, legal or regulatory, each 1 to 5), the tolerable
// downtime and recovery targets that follow, and answers to the organization's own questions.
// Signing one off copies its downtime and targets onto the process and sets the next analysis due
// date. Submitting starts the `bia_signoff` approval workflow (E31-10: by default the process owner
// signs it off); with no workflow that applies, a holder of continuity.approve signs it off with
// "Sign off", which also replaces a request still waiting in a workflow.
import type { FastifyRequest } from 'fastify';
import { approvalEngine, defineApprovalKind } from '../../core/approval-kinds.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { PROCESS_HOURS } from './processes.ts';
import { addMonths, checkHours, invalid, text } from './shared.ts';

export const BIA_KIND = 'bia_signoff';

export const DEFAULT_BIA_WORKFLOW = {
  name: 'Impact analysis sign-off',
  description: 'The owner of the business process signs off its impact analysis once it is submitted. Approval copies the tolerable downtime and recovery targets onto the process; rejection sends the analysis back to draft. Applies when the process has an owner.',
  conditions: [{ field: 'process_owner_id', op: 'set' }],
  steps: [{ key: 'owner', name: 'Process owner', approvers: { kind: 'field', field: 'process_owner_id' }, quorum: 'any', due_hours: 240 }],
};

export const BANDS = ['1h', '4h', '1d', '3d', '1w'] as const;
export const BAND_HOURS: Record<string, number> = { '1h': 1, '4h': 4, '1d': 24, '3d': 72, '1w': 168 };
export const IMPACT_AREAS = ['operational', 'safety', 'financial', 'reputational', 'legal_regulatory'] as const;
export const BIA_EVERY_SETTING = 'continuity.bia_every_months';
export const DEFAULT_BIA_EVERY = 12;

/** Impacts as stored: one row per band in band order, each area a whole number 1 to 5 or null. */
export function cleanImpacts(value: unknown): Row[] | string {
  if (value === null || value === undefined) return [];
  const list = typeof value === 'string' ? (() => { try { return JSON.parse(value); } catch { return null; } })() : value;
  if (!Array.isArray(list) || list.length > BANDS.length) return 'Give one row per time band.';
  const out: Row[] = [];
  for (const r of list as Row[]) {
    if (!r || !BANDS.includes(r.band)) return 'Each row needs a time band: 1h, 4h, 1d, 3d or 1w.';
    if (out.some((o) => o.band === r.band)) return `The ${r.band} band is given twice.`;
    const row: Row = { band: r.band };
    for (const a of IMPACT_AREAS) {
      const v = r[a];
      if (v === null || v === undefined || v === '') { row[a] = null; continue; }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) return 'Rate each impact from 1 (minimal) to 5 (severe).';
      row[a] = n;
    }
    out.push(row);
  }
  return out.sort((a, b) => BANDS.indexOf(a.band) - BANDS.indexOf(b.band));
}

/** The hours of the first band at which any impact reaches 4 (major) or more: a suggested tolerable downtime. */
export function suggestedMtd(impacts: Row[]): number | null {
  for (const b of BANDS) {
    const row = impacts.find((r) => r.band === b);
    if (row && IMPACT_AREAS.some((a) => Number(row[a] ?? 0) >= 4)) return BAND_HOURS[b];
  }
  return null;
}

export function registerBia(ctx: ModuleContext) {
  const { app, db } = ctx;

  async function check(req: FastifyRequest | null, data: Row, existing: Row | null): Promise<Row> {
    const errors = checkHours(data, PROCESS_HOURS);
    if ('impacts' in data) {
      const impacts = cleanImpacts(data.impacts);
      if (typeof impacts === 'string') errors.impacts = impacts; else data.impacts = impacts;
    }
    if ('answers' in data && data.answers !== null && (typeof data.answers !== 'object' || Array.isArray(data.answers))) {
      errors.answers = 'Answers are kept as a set of question and answer pairs.';
    }
    if (data.year !== undefined && data.year !== null && data.year !== '') {
      const y = Number(data.year);
      if (!Number.isInteger(y) || y < 1990 || y > 2200) errors.year = 'Give the year as four digits.';
    }
    if ('process_id' in data && req) {
      if (existing && data.process_id !== existing.process_id) errors.process_id = 'An impact analysis stays with its process.';
      else if (!existing && !(await ctx.resources.find('business_process', String(data.process_id ?? ''), req.user))) errors.process_id = 'Choose a business process.';
    }
    if (Object.keys(errors).length) invalid(ctx, errors);
    if (req && existing?.status === 'signed_off') ctx.fail(409, 'signed_off', 'This impact analysis is signed off. Start a new one for the next review.');
    if (req && data.status === 'signed_off' && existing?.status !== 'signed_off') {
      invalid(ctx, { status: 'An approver signs the analysis off with "Sign off".' });
    }
    if (req && data.status === 'submitted' && existing?.status !== 'submitted') {
      invalid(ctx, { status: 'Submit the analysis with "Submit for sign-off".' });
    }
    if (!existing && !data.year) data.year = Number(dayInZone().slice(0, 4));
    return data;
  }

  ctx.defineResource({
    type: 'bia', table: 'bia_assessments', module: 'continuity', label: 'Impact analysis', plural: 'Impact analyses',
    path: '/api/bias', route: '/continuity/impact-analyses', titleField: 'ref',
    ref: { field: 'ref', prefix: 'BIA-' },
    searchable: ['ref', 'notes'],
    defaultSort: { field: 'assessed_on', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      process_id: { label: 'Business process', type: 'ref', to: 'business_process', required: true },
      year: { label: 'Year', type: 'number' },
      assessed_on: { label: 'Assessed on', type: 'date' },
      assessor_id: { label: 'Assessor', type: 'user' },
      status: { label: 'Status', type: 'lookup', list: 'bia_status', default: 'draft' },
      impacts: { label: 'Impacts over time', type: 'json' },
      mtd_hours: { label: 'Maximum tolerable downtime (hours)', type: 'number' },
      rto_target_hours: { label: 'Recovery time target (hours)', type: 'number' },
      rpo_target_hours: { label: 'Recovery point target (hours)', type: 'number' },
      answers: { label: 'Answers', type: 'json' },
      notes: { label: 'Notes', type: 'longtext' },
      signed_off_by_name: { label: 'Signed off by', type: 'text', readOnly: true },
      signed_off_on: { label: 'Signed off on', type: 'date', readOnly: true },
      process_owner_id: { label: 'Process owner at submission', type: 'user', readOnly: true },
    },
    hooks: {
      beforeCreate: (req, data) => check(req, data, null),
      beforeUpdate: (req, existing, patch) => check(req, patch, existing),
      afterUpdate: async (req, before, after) => {
        // Sent back to draft by hand while the process owner was asked to sign it off: the request ends.
        if (req && before.status === 'submitted' && after.status === 'draft') {
          await approvalEngine(app)?.cancel(BIA_KIND, after.id, 'The impact analysis was sent back to draft.', req);
        }
      },
    },
  });

  /**
   * Signs an analysis off: copies its tolerable downtime and recovery targets onto the process and
   * sets the next analysis due date. Used by "Sign off" and by the approval of a `bia_signoff` workflow.
   */
  async function signOff(bia: Row, process: Row, byName: string, req: FastifyRequest | null): Promise<void> {
    const today = dayInZone();
    const every = Math.min(60, Math.max(1, Math.round(Number(await ctx.settings.get(BIA_EVERY_SETTING, DEFAULT_BIA_EVERY)) || DEFAULT_BIA_EVERY)));
    await ctx.resources.update('bia', bia.id, { status: 'signed_off', signed_off_by_name: byName.slice(0, 200), signed_off_on: today }, null);
    const copy: Row = { last_bia_on: today, next_bia_due: addMonths(today, every) };
    for (const f of PROCESS_HOURS) if (bia[f] !== null && bia[f] !== undefined) copy[f] = bia[f];
    await ctx.resources.update('business_process', process.id, copy, null);
    await ctx.audit(req, {
      action: 'bia.sign_off', recordType: 'bia', recordId: bia.id,
      summary: `Impact analysis ${bia.ref} signed off by ${byName}; tolerable downtime ${bia.mtd_hours} hours copied to ${process.ref} ${process.name}`,
      after: { process_id: process.id, ...copy },
    });
  }

  // ---------- sign-off through an approval workflow (E31-10) ----------

  defineApprovalKind(app, {
    key: BIA_KIND, recordType: 'bia', label: 'Impact analysis sign-off',
    startsWhen: 'Someone submits an impact analysis for sign-off',
    outcome: 'Approved: the analysis is signed off (its tolerable downtime and recovery targets are copied onto the process and the next analysis becomes due); rejected: it goes back to Draft, with the reason in its history',
    // The process owner need not hold continuity.approve; checked again when they decide.
    approverPermission: 'continuity.view',
    async install(h) {
      if (!(await h.hasDefinitions())) await h.define(DEFAULT_BIA_WORKFLOW);
    },
    async onFinish(e) {
      const bia = await db.one<Row>('select * from bia_assessments where id = $1 and deleted_at is null', [e.instance.recordId]);
      if (!bia) {
        if (e.outcome === 'canceled') return;
        throw new Error('The impact analysis no longer exists.');
      }
      // Ended by the module itself (signed off directly, or sent back to draft): it already knows.
      if (e.byModule) return;
      const who = `${e.approverName ?? 'the process owner'}${e.onBehalfOfName ? ` on behalf of ${e.onBehalfOfName}` : ''}`;
      if (e.outcome === 'approved') {
        if (bia.status === 'signed_off') return;
        if (bia.mtd_hours === null || bia.mtd_hours === undefined) throw new Error('The analysis has no maximum tolerable downtime, so it was not signed off.');
        const process = await db.one<Row>('select * from business_processes where id = $1 and deleted_at is null', [bia.process_id]);
        if (!process) throw new Error('The business process of this analysis no longer exists.');
        await signOff(bia, process, who, e.req);
        return;
      }
      if (bia.status === 'submitted') await ctx.resources.update('bia', bia.id, { status: 'draft' }, null);
      if (e.outcome === 'rejected') {
        await ctx.audit(e.req, {
          action: 'bia.sign_off_rejected', recordType: 'bia', recordId: bia.id,
          summary: `Impact analysis ${bia.ref} sent back by ${who}: ${e.comment ?? 'no reason given'}`, after: { reason: e.comment },
        });
      }
    },
  });

  const biaFor = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('bia', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Impact analysis not found.');

  app.post('/api/bias/:id/submit', { preHandler: ctx.requirePerm('continuity.edit') }, async (req) => {
    const bia = await biaFor(req);
    if (bia.status === 'signed_off') ctx.fail(409, 'signed_off', 'This impact analysis is already signed off.');
    if (bia.status !== 'draft') ctx.fail(409, 'already_submitted', 'This impact analysis is already submitted for sign-off.');
    if (bia.mtd_hours === null || bia.mtd_hours === undefined) invalid(ctx, { mtd_hours: 'Give the maximum tolerable downtime before submitting.' });
    const process = (await ctx.resources.find('business_process', bia.process_id, req.user))
      ?? ctx.fail(409, 'process_gone', 'The business process of this analysis no longer exists.');
    const eng = approvalEngine(app);
    if (eng && process.owner_id && process.owner_id === req.user!.id && (await eng.definitions(BIA_KIND)).length) {
      ctx.fail(409, 'owner_submits', 'You own this business process, so you sign its analysis off: someone else submits it for your sign-off.');
    }
    // The type's lifecycle rules apply as they did when the status was set by hand.
    const problems = await app.lifecycles.check(ctx.resources.get('bia')!, bia, { status: 'submitted' }, req);
    if (Object.keys(problems).length) invalid(ctx, problems);
    const owner = process.owner_id ?? null;
    await ctx.resources.update('bia', bia.id, { status: 'submitted', process_owner_id: owner }, null);
    const note = text((req.body as Row | null)?.note, 2000);
    const started = eng ? await eng.start(BIA_KIND, { ...bia, status: 'submitted', process_owner_id: owner }, { requester: req.user!.id, req, note }) : null;
    await ctx.audit(req, {
      action: 'bia.submitted', recordType: 'bia', recordId: bia.id,
      summary: `Impact analysis ${bia.ref} submitted for sign-off${started ? ` (${started.name})` : ''}`, after: { workflow: started?.name ?? null, note },
    });
    const now = (await ctx.resources.find('bia', bia.id))!;
    return { status: now.status, instance_id: started?.id ?? null, workflow: started?.name ?? null };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/bias/:id/submit', tag: 'Continuity', permission: 'continuity.edit',
    summary: 'Submit a draft impact analysis for sign-off: starts the Impact analysis sign-off workflow (by default the process owner signs it off); with none that applies, it waits for "Sign off"',
    description: 'Needs the maximum tolerable downtime. 409 `already_submitted` unless it is a draft; 409 `owner_submits` when the process owner submits it while a sign-off workflow is active.',
    body: '{ note? }', response: '{ status, instance_id, workflow }',
  });

  app.get('/api/bias/:id/sign-off', { preHandler: ctx.requirePerm('continuity.view') }, async (req) => {
    const bia = await biaFor(req);
    const eng = approvalEngine(app);
    const latest = eng ? await eng.latest(BIA_KIND, bia.id) : null;
    return {
      available: Boolean(eng && (await eng.definitions(BIA_KIND)).length),
      request: latest ? { id: latest.id, workflow: latest.name, status: latest.status, started_at: latest.startedAt, finished_at: latest.finishedAt } : null,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/bias/:id/sign-off', tag: 'Continuity', permission: 'continuity.view',
    summary: 'The newest sign-off request of an impact analysis, and whether a sign-off workflow is active',
    response: '{ available, request: { id, workflow, status, started_at, finished_at } | null }',
  });

  app.post('/api/bias/:id/sign-off', { preHandler: ctx.requirePerm('continuity.approve') }, async (req) => {
    const bia = await biaFor(req);
    if (bia.status === 'signed_off') ctx.fail(409, 'signed_off', 'This impact analysis is already signed off.');
    if (bia.status !== 'submitted') ctx.fail(409, 'not_submitted', 'The analysis is signed off once it has been submitted.');
    if (bia.mtd_hours === null || bia.mtd_hours === undefined) invalid(ctx, { mtd_hours: 'Give the maximum tolerable downtime before signing off.' });
    const process = (await ctx.resources.find('business_process', bia.process_id, req.user))
      ?? ctx.fail(409, 'process_gone', 'The business process of this analysis no longer exists.');
    // A sign-off made directly replaces a request still waiting in the approval workflow.
    await approvalEngine(app)?.cancel(BIA_KIND, bia.id, `Signed off directly by ${req.user!.displayName}.`, req);
    await signOff(bia, process, req.user!.displayName, req);
    return db.one<Row>('select status, signed_off_by_name, signed_off_on::text as signed_off_on from bia_assessments where id = $1', [bia.id]);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/bias/:id/sign-off', tag: 'Continuity', permission: 'continuity.approve',
    summary: 'Sign off a submitted impact analysis directly: copies its tolerable downtime and recovery targets onto the process and sets the next analysis due date',
    description: `The next analysis is due \`${BIA_EVERY_SETTING}\` months later (${DEFAULT_BIA_EVERY} unless changed). 409 \`not_submitted\` unless the analysis was submitted. A sign-off request still waiting in the Impact analysis sign-off workflow is canceled.`,
    response: '{ status, signed_off_by_name, signed_off_on }',
  });
}
