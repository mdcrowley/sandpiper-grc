// The board-ready scorecard of a strategic plan as a tagged PDF (PDF/UA, core PdfBuilder).
import type { FastifyRequest } from 'fastify';
import { formatNumber, PdfBuilder } from '../../core/export/pdf.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { printBranding } from '../../core/organization.ts';
import { dayInZone, displayDate } from '../../core/timezone.ts';
import { periodLabel } from './periods.ts';
import { matrix, scorecard } from './service.ts';

export async function scorecardPdf(ctx: ModuleContext, req: FastifyRequest, plan: Row): Promise<Buffer> {
  const card = await scorecard(ctx, plan, { canSeeProjects: ctx.can(req.user, 'projects.view') });
  const grid = await matrix(ctx, plan);
  const labels = async (list: string) => new Map((await ctx.lookups.values(list)).map((v) => [v.value, v.label]));
  const rag = await labels('strategy_rag');
  const state = await labels('measure_state');
  const stage = await labels('initiative_stage');
  const planStatus = await labels('strategy_plan_status');
  const ragOf = (v: unknown) => (v ? rag.get(String(v)) ?? String(v) : 'Not reported');
  const n = (v: number | null | undefined, unit?: string | null) => (v === null || v === undefined ? '' : `${formatNumber(v)}${unit ? ` ${unit}` : ''}`);
  const appName = String(await ctx.settings.get('app.name', 'Sandpiper GRC'));
  const period = [card.plan.period_start, card.plan.period_end].filter(Boolean).map((d) => displayDate(String(d))).join(' to ');

  const pdf = new PdfBuilder({
    title: `Strategic plan scorecard: ${card.plan.title}`,
    subtitle: [card.plan.ref, period].filter(Boolean).join(' · '),
    meta: [`Produced ${displayDate(dayInZone())} by ${req.user!.displayName}`, `Status: ${planStatus.get(String(card.plan.status)) ?? card.plan.status ?? ''}`],
    cover: true, appName, author: appName, branding: await printBranding(ctx.db),
  });

  pdf.heading('Summary', 1);
  if (card.plan.description) pdf.paragraph(String(card.plan.description));
  pdf.keyValues([
    { label: 'Period', value: period },
    { label: 'Adopted on', value: card.plan.adopted_on ? displayDate(card.plan.adopted_on) : 'Not yet adopted' },
  ].filter((r) => r.value));
  const o = card.totals.objectives;
  pdf.figures([
    { label: 'Objectives on track', value: `${o.on_track} of ${o.total}` },
    { label: 'Objectives at risk', value: String(o.at_risk) },
    { label: 'Objectives off track', value: String(o.off_track) },
    { label: 'Measures meeting target', value: `${card.totals.measures.met} of ${card.totals.measures.total}` },
  ]);

  for (const g of card.goals) {
    pdf.heading([g.code, g.title].filter(Boolean).join(' '), 1);
    if (g.description) pdf.paragraph(String(g.description), { muted: true });
    if (!g.objectives.length) { pdf.note('No objectives under this goal yet.'); continue; }
    for (const ob of g.objectives) {
      pdf.heading(`${[ob.code, ob.title].filter(Boolean).join(' ')}: ${ragOf(ob.status)}`, 2);
      pdf.keyValues([
        { label: 'Owner', value: ob.owner_name ?? '' },
        { label: 'Target date', value: ob.target_date ? displayDate(ob.target_date) : '' },
        { label: 'Latest update', value: ob.latest ? `${periodLabel(ob.latest.period)}${ob.latest.reported_by ? `, ${ob.latest.reported_by}` : ''}` : 'None yet' },
      ].filter((r) => r.value));
      if (ob.latest?.narrative) pdf.paragraph(ob.latest.narrative);
      if (ob.measures.length) {
        pdf.table(
          [{ header: 'Measure' }, { header: 'Baseline', align: 'right' }, { header: 'Period' }, { header: 'Target', align: 'right' }, { header: 'Actual', align: 'right' }, { header: 'Against target' }],
          ob.measures.map((m) => [
            m.title, n(m.baseline_value, m.unit), m.latest_period ? periodLabel(m.latest_period) : '', n(m.latest_target, m.unit), n(m.latest_value, m.unit),
            m.latest_state ? state.get(m.latest_state) ?? m.latest_state : 'No actual yet',
          ]),
        );
      }
      if (ob.initiatives.length) {
        pdf.table(
          [{ header: 'Initiative' }, { header: 'Stage' }, { header: 'Status' }, { header: 'Owner' }, { header: 'Ends' }],
          ob.initiatives.map((i) => [`${i.ref ?? ''} ${i.title}`.trim(), stage.get(String(i.stage)) ?? String(i.stage ?? ''), ragOf(i.status), i.owner_name ?? '', i.end_on ? displayDate(i.end_on) : '']),
        );
      }
    }
  }

  if (grid.rows.length && grid.quarters.length) {
    pdf.heading('Status by quarter', 1);
    const fiscal = grid.fiscal_year.start_month > 1;
    pdf.paragraph(`Each objective and initiative with the status of its update in each quarter${fiscal ? ` of the fiscal year (${grid.quarters.slice(-6).map((q) => `${periodLabel(q)}: ${grid.spans[q]}`).join('; ')})` : ''}. A dash means no update was made that quarter.`, { muted: true });
    // At most six quarters fit across a page: the latest ones.
    const qs = grid.quarters.slice(-6);
    pdf.table(
      [{ header: 'Objective or initiative' }, ...qs.map((q) => ({ header: periodLabel(q) }))],
      grid.rows.map((r) => [`${r.kind === 'initiative' ? '    ' : ''}${[r.code ?? r.ref, r.title].filter(Boolean).join(' ')}`, ...qs.map((q) => (r.cells[q] ? ragOf(r.cells[q]!.status) : '—'))]),
      { boldFirstColumn: false },
    );
  }
  return pdf.finish();
}
