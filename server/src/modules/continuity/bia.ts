// Business impact analyses (E31-02): per process and year, the impact of an outage over time bands
// (operational, safety, financial, reputational, legal or regulatory, each 1 to 5), the tolerable
// downtime and recovery targets that follow, and answers to the organization's own questions.
// Signing one off (continuity.approve) copies its downtime and targets onto the process and sets the
// next analysis due date.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { PROCESS_HOURS } from './processes.ts';
import { addMonths, checkHours, invalid } from './shared.ts';

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
    },
    hooks: {
      beforeCreate: (req, data) => check(req, data, null),
      beforeUpdate: (req, existing, patch) => check(req, patch, existing),
    },
  });

  app.post('/api/bias/:id/sign-off', { preHandler: ctx.requirePerm('continuity.approve') }, async (req) => {
    const bia = (await ctx.resources.find('bia', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Impact analysis not found.');
    if (bia.status === 'signed_off') ctx.fail(409, 'signed_off', 'This impact analysis is already signed off.');
    if (bia.status !== 'submitted') ctx.fail(409, 'not_submitted', 'The analysis is signed off once it has been submitted.');
    if (bia.mtd_hours === null || bia.mtd_hours === undefined) invalid(ctx, { mtd_hours: 'Give the maximum tolerable downtime before signing off.' });
    const process = (await ctx.resources.find('business_process', bia.process_id, req.user))
      ?? ctx.fail(409, 'process_gone', 'The business process of this analysis no longer exists.');
    const today = dayInZone();
    const every = Math.min(60, Math.max(1, Math.round(Number(await ctx.settings.get(BIA_EVERY_SETTING, DEFAULT_BIA_EVERY)) || DEFAULT_BIA_EVERY)));
    await ctx.resources.update('bia', bia.id, { status: 'signed_off', signed_off_by_name: req.user!.displayName, signed_off_on: today }, null);
    const copy: Row = { last_bia_on: today, next_bia_due: addMonths(today, every) };
    for (const f of PROCESS_HOURS) if (bia[f] !== null && bia[f] !== undefined) copy[f] = bia[f];
    await ctx.resources.update('business_process', process.id, copy, null);
    await ctx.audit(req, {
      action: 'bia.sign_off', recordType: 'bia', recordId: bia.id,
      summary: `Impact analysis ${bia.ref} signed off; tolerable downtime ${bia.mtd_hours} hours copied to ${process.ref} ${process.name}`,
      after: { process_id: process.id, ...copy },
    });
    return db.one<Row>('select status, signed_off_by_name, signed_off_on::text as signed_off_on from bia_assessments where id = $1', [bia.id]);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/bias/:id/sign-off', tag: 'Continuity', permission: 'continuity.approve',
    summary: 'Sign off a submitted impact analysis: copies its tolerable downtime and recovery targets onto the process and sets the next analysis due date',
    description: `The next analysis is due \`${BIA_EVERY_SETTING}\` months later (${DEFAULT_BIA_EVERY} unless changed). 409 \`not_submitted\` unless the analysis was submitted.`,
    response: '{ status, signed_off_by_name, signed_off_on }',
  });
}
