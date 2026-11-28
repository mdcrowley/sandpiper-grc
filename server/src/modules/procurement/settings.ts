// Procurement settings (Procurement > Settings): the standard evaluation criteria a new evaluation starts
// from, and the invoice match tolerance (E46-66). Lists (methods with their limits, statuses, the clause template) are edited under Lists.
import type { ModuleContext, Row } from '../../core/module.ts';
import { body, cleanText, invalid } from './shared.ts';

export const CRITERIA_KEY = 'procurement.criteria_template';
/** The share (percent) an invoice may go over the order's price or the value received and still match. Same key as invoices.ts TOLERANCE_KEY. */
export const TOLERANCE_SETTING = 'procurement.invoice_tolerance_pct';

async function toleranceSetting(ctx: ModuleContext): Promise<number> {
  const v = Number(await ctx.settings.get(TOLERANCE_SETTING, 0));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export interface CriterionTemplate { name: string; description: string | null; weight: number; max_score: number }

export const DEFAULT_CRITERIA: CriterionTemplate[] = [
  { name: 'Technical approach and understanding of the work', description: null, weight: 35, max_score: 10 },
  { name: 'Qualifications and experience of the firm and staff', description: null, weight: 25, max_score: 10 },
  { name: 'Price', description: 'Lowest responsive price scores highest.', weight: 30, max_score: 10 },
  { name: 'Schedule and capacity', description: null, weight: 10, max_score: 10 },
];

/** Checks a list of criteria (a template or one procurement's), answering them cleaned. */
export function cleanCriteria(ctx: ModuleContext, raw: unknown): CriterionTemplate[] {
  if (!Array.isArray(raw)) invalid(ctx, { criteria: 'Give a list of criteria.' });
  const list = raw as Row[];
  if (list.length > 30) invalid(ctx, { criteria: 'Use at most 30 criteria.' });
  return list.map((c, i) => {
    const name = cleanText(c?.name, 200);
    const weight = Number(c?.weight);
    const max = c?.max_score === undefined || c?.max_score === null || c?.max_score === '' ? 10 : Number(c.max_score);
    if (!name) invalid(ctx, { criteria: `Criterion ${i + 1}: give it a name.` });
    if (!Number.isFinite(weight) || weight <= 0 || weight > 1000) invalid(ctx, { criteria: `${name}: give a weight above zero.` });
    if (!Number.isFinite(max) || max <= 0 || max > 1000) invalid(ctx, { criteria: `${name}: give a top score above zero.` });
    return { name: name!, description: cleanText(c?.description, 1000), weight, max_score: max };
  });
}

export async function criteriaTemplate(ctx: ModuleContext): Promise<CriterionTemplate[]> {
  const stored = await ctx.settings.get(CRITERIA_KEY, null);
  return Array.isArray(stored) ? stored as CriterionTemplate[] : DEFAULT_CRITERIA;
}

export function registerSettings(ctx: ModuleContext) {
  ctx.app.get('/api/procurement/settings', { preHandler: ctx.requirePerm('procurement.view') }, async () => ({
    criteria_template: await criteriaTemplate(ctx),
    invoice_tolerance_pct: await toleranceSetting(ctx),
  }));
  ctx.describeRoute({
    method: 'GET', path: '/api/procurement/settings', tag: 'Procurement', permission: 'procurement.view',
    summary: 'Procurement settings: the standard evaluation criteria and the invoice match tolerance', response: '{ criteria_template: { name, description, weight, max_score }[], invoice_tolerance_pct }',
  });

  ctx.app.put('/api/procurement/settings', { preHandler: ctx.requirePerm('procurement.administer') }, async (req) => {
    const b = body(req);
    if (b.criteria_template === undefined && b.invoice_tolerance_pct === undefined) invalid(ctx, { criteria_template: 'Give the criteria or the invoice match tolerance.' });
    if (b.criteria_template !== undefined) {
      const before = await criteriaTemplate(ctx);
      const next = cleanCriteria(ctx, b.criteria_template);
      await ctx.settings.set(CRITERIA_KEY, next, req);
      await ctx.audit(req, {
        action: 'procurement.settings', recordType: 'setting', recordId: CRITERIA_KEY,
        summary: `Standard evaluation criteria changed (${next.length} criteria)`, before, after: next,
      });
    }
    if (b.invoice_tolerance_pct !== undefined) {
      const v = b.invoice_tolerance_pct === null || b.invoice_tolerance_pct === '' ? 0 : Number(b.invoice_tolerance_pct);
      if (!Number.isFinite(v) || v < 0 || v > 25) invalid(ctx, { invoice_tolerance_pct: 'Give a percentage from 0 to 25.' });
      const before = await toleranceSetting(ctx);
      await ctx.settings.set(TOLERANCE_SETTING, v, req);
      await ctx.audit(req, {
        action: 'procurement.settings', recordType: 'setting', recordId: TOLERANCE_SETTING,
        summary: `Invoice match tolerance changed from ${before}% to ${v}%`, before, after: v,
      });
    }
    return { criteria_template: await criteriaTemplate(ctx), invoice_tolerance_pct: await toleranceSetting(ctx) };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/procurement/settings', tag: 'Procurement', permission: 'procurement.administer',
    summary: 'Change the standard evaluation criteria and the invoice match tolerance (either or both)', body: '{ criteria_template?: { name, description?, weight, max_score? }[], invoice_tolerance_pct? }',
    response: '{ criteria_template, invoice_tolerance_pct }',
  });
}
