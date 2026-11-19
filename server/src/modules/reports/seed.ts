// Seeds the standard dashboards, reports and starter pack. Idempotent: an item is created once,
// found again by its key, and never overwritten, so edits made in the application are kept (and a
// standard item someone deleted stays deleted). The same in both profiles: nothing here is
// specific to an organization.
import type { ModuleContext } from '../../core/module.ts';
import { STANDARD_DASHBOARDS, STANDARD_PACK, STANDARD_REPORTS } from './standard.ts';

export async function seedStandard(ctx: ModuleContext): Promise<string> {
  const exists = async (table: string, key: string) => ctx.db.one<{ id: string }>(`select id from ${table} where key = $1`, [key]);
  let reports = 0;
  let dashboards = 0;
  let packs = 0;

  for (const r of STANDARD_REPORTS) {
    if (await exists('report_definitions', r.key)) continue;
    await ctx.resources.create('report_definition', {
      key: r.key, name: r.name, description: r.description, record_type: r.spec.type, spec: r.spec, chart: r.chart, sharing: 'everyone',
    });
    reports += 1;
  }

  for (const d of STANDARD_DASHBOARDS) {
    if (await exists('dashboards', d.key)) continue;
    await ctx.resources.create('dashboard', {
      key: d.key, name: d.name, description: d.description, widgets: d.widgets, filters: d.filters,
      layout: { columns: 12 }, refresh_seconds: d.refresh_seconds ?? null, sharing: 'everyone',
    });
    dashboards += 1;
  }

  if (!(await exists('report_packs', STANDARD_PACK.key))) {
    const sections = [];
    for (const s of STANDARD_PACK.sections) {
      if (s.kind !== 'report') { sections.push(s); continue; }
      const report = await exists('report_definitions', s.reportKey);
      if (report) sections.push({ kind: 'report', reportId: report.id });
    }
    await ctx.resources.create('report_pack', {
      key: STANDARD_PACK.key, name: STANDARD_PACK.name, description: STANDARD_PACK.description,
      cover_title: STANDARD_PACK.cover_title, cover_subtitle: STANDARD_PACK.cover_subtitle, sections, sharing: 'everyone',
    });
    packs += 1;
  }
  return `${dashboards} dashboards, ${reports} reports, ${packs} packs added`;
}
