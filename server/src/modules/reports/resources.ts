// The four record types of the reporting module, with the rules the generic engine cannot know:
// who owns a record, what a valid specification, layout, schedule or pack looks like.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { FieldDef, ModuleContext, Row } from '../../core/module.ts';
import { nextRun } from './schedule.ts';
import type { Sharing } from './sharing.ts';
import { compileWithCustom, GLOBAL_KINDS, SpecError } from './spec.ts';
import { WIDGET_KINDS } from './widgets.ts';

const CHART_KINDS = ['table', 'number', 'gauge', 'bar', 'hbar', 'stacked', 'line', 'area', 'pie', 'donut', 'heatmap', 'calendar'];
export const GRID_COLUMNS = 12;

const sharingFields: Record<string, FieldDef> = {
  owner_id: { label: 'Owner', type: 'user', readOnly: true },
  sharing: { label: 'Shared with', type: 'lookup', list: 'report_sharing', default: 'private' },
  shared_roles: { label: 'Roles', type: 'json' },
  key: { label: 'Standard key', type: 'text', readOnly: true },
};

export function defineReportResources(ctx: ModuleContext, sharing: Sharing) {
  const bad = (field: string, message: string): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', { [field]: message });
  const int = (v: unknown, lo: number, hi: number, fallback: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback; };
  const text = (v: unknown, max: number) => String(v ?? '').slice(0, max);

  /** Ownership and sharing on create; on update only the sharing fields can change. */
  async function owned(req: FastifyRequest | null, data: Row, creating: boolean): Promise<Row> {
    if (creating && req) data.owner_id = req.user!.id;
    await sharing.cleanSharing(data);
    return data;
  }

  /** A saved specification must be one the engine can run. Seeded (system) records may name a record type that is not loaded. */
  async function checkSpec(req: FastifyRequest | null, spec: unknown): Promise<string> {
    const type = (spec as Row | null)?.type;
    if (!req && (typeof type !== 'string' || !ctx.resources.get(type))) return String(type ?? '');
    try {
      return (await compileWithCustom(ctx, null, spec)).def.type;
    } catch (err) {
      if (err instanceof SpecError) bad('spec', err.message);
      throw err;
    }
  }

  function cleanChart(chart: unknown): Row {
    const c = (chart && typeof chart === 'object' ? chart : {}) as Row;
    const kind = CHART_KINDS.includes(c.kind) ? c.kind : 'table';
    const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));
    return { kind, target: num(c.target), max: num(c.max), measure: int(c.measure, 0, 5, 0) };
  }

  ctx.defineResource({
    type: 'report_definition', table: 'report_definitions', module: 'reports',
    label: 'Report', plural: 'Reports', path: '/api/reports', route: '/reports', titleField: 'name',
    searchable: ['name', 'description'], defaultSort: { field: 'name', dir: 'asc' },
    fields: {
      name: { label: 'Name', type: 'text', required: true },
      description: { label: 'Description', type: 'longtext' },
      record_type: { label: 'Reports on', type: 'text', readOnly: true },
      spec: { label: 'What it shows', type: 'json', required: true },
      chart: { label: 'How it is drawn', type: 'json' },
      ...sharingFields,
    },
    hooks: {
      beforeCreate: async (req, data) => {
        data.record_type = await checkSpec(req, data.spec);
        if (req) data.chart = cleanChart(data.chart);
        return owned(req, data, true);
      },
      beforeUpdate: async (req, _existing, patch) => {
        if (patch.spec !== undefined) patch.record_type = await checkSpec(req, patch.spec);
        if (patch.chart !== undefined && req) patch.chart = cleanChart(patch.chart);
        return owned(req, patch, false);
      },
    },
  });

  /**
   * A dashboard or pack may only point at saved reports the person saving it may see, so a private
   * report cannot be pulled into someone else's dashboard. References already saved are kept as
   * they are (a report later made private shows "not shared with you" to people who cannot see it).
   */
  async function checkReportRefs(req: FastifyRequest | null, ids: string[], existing: string[], field: string): Promise<void> {
    if (!req) return;
    for (const id of new Set(ids)) {
      if (existing.includes(id)) continue;
      if (!(await sharing.load(req.user ?? null, 'report_definition', id))) bad(field, 'One of the saved reports does not exist or is not shared with you.');
    }
  }
  const widgetReports = (widgets: unknown) => (Array.isArray(widgets) ? widgets : [])
    .filter((w: Row) => w?.kind === 'report' && w.config?.reportId).map((w: Row) => String(w.config.reportId));
  const sectionReports = (sections: unknown) => (Array.isArray(sections) ? sections : [])
    .filter((s: Row) => s?.kind === 'report' && s.reportId).map((s: Row) => String(s.reportId));

  async function cleanWidgets(req: FastifyRequest | null, widgets: unknown): Promise<Row[]> {
    if (!Array.isArray(widgets)) return bad('widgets', 'The widgets are not valid.');
    if (widgets.length > 40) bad('widgets', 'A dashboard can hold at most 40 widgets.');
    // A person's widget must be runnable; standard widgets may name record types that are not loaded here.
    for (const [i, w] of (widgets as Row[]).entries()) {
      const spec = w?.config?.spec;
      if (!req || !spec || !ctx.resources.get(spec?.type)) continue;
      try { await compileWithCustom(ctx, null, spec); } catch (err) { if (err instanceof SpecError) bad('widgets', `${text(w.title, 80) || `Widget ${i + 1}`}: ${err.message}`); else throw err; }
    }
    const seen = new Set<string>();
    return widgets.map((w: Row, i) => {
      if (!w || typeof w !== 'object' || !(WIDGET_KINDS as readonly string[]).includes(w.kind)) bad('widgets', `Widget ${i + 1} is of an unknown kind.`);
      let id = /^[a-z0-9_-]{1,40}$/i.test(String(w.id)) ? String(w.id) : `w${i + 1}`;
      while (seen.has(id)) id = `${id}x`;
      seen.add(id);
      const width = int(w.w, 2, GRID_COLUMNS, 4);
      const config = (w.config && typeof w.config === 'object' ? w.config : {}) as Row;
      if (JSON.stringify(config).length > 20000) bad('widgets', `Widget ${i + 1} holds too much.`);
      return { id, kind: w.kind, title: text(w.title, 120), x: int(w.x, 0, GRID_COLUMNS - width, 0), y: int(w.y, 0, 500, 0), w: width, h: int(w.h, 1, 12, 3), config };
    });
  }
  function cleanGlobalFilters(filters: unknown): Row[] {
    if (!Array.isArray(filters)) return bad('filters', 'The dashboard filters are not valid.');
    const kinds = new Set<string>();
    for (const f of filters as Row[]) {
      if (!f || !(GLOBAL_KINDS as readonly string[]).includes(f.kind) || kinds.has(f.kind)) bad('filters', 'Choose each dashboard filter once, from the list.');
      kinds.add(f.kind);
    }
    return (filters as Row[]).map((f) => ({ kind: f.kind, label: text(f.label, 60) || f.kind, default: f.default ?? null }));
  }

  ctx.defineResource({
    type: 'dashboard', table: 'dashboards', module: 'dashboards',
    label: 'Dashboard', plural: 'Dashboards', path: '/api/dashboards', route: '/dashboards', titleField: 'name',
    searchable: ['name', 'description'], defaultSort: { field: 'name', dir: 'asc' },
    fields: {
      name: { label: 'Name', type: 'text', required: true },
      description: { label: 'Description', type: 'longtext' },
      layout: { label: 'Layout', type: 'json' },
      widgets: { label: 'Widgets', type: 'json' },
      filters: { label: 'Dashboard filters', type: 'json' },
      refresh_seconds: { label: 'Refresh every (seconds)', type: 'number' },
      ...sharingFields,
    },
    hooks: {
      beforeCreate: async (req, data) => {
        data.widgets = await cleanWidgets(req, data.widgets ?? []);
        await checkReportRefs(req, widgetReports(data.widgets), [], 'widgets');
        data.filters = cleanGlobalFilters(data.filters ?? []);
        data.layout = { columns: GRID_COLUMNS };
        return owned(req, data, true);
      },
      beforeUpdate: async (req, existing, patch) => {
        if (patch.widgets !== undefined) {
          patch.widgets = await cleanWidgets(req, patch.widgets ?? []);
          await checkReportRefs(req, widgetReports(patch.widgets), widgetReports(existing.widgets), 'widgets');
        }
        if (patch.filters !== undefined) patch.filters = cleanGlobalFilters(patch.filters ?? []);
        if (patch.refresh_seconds !== undefined && patch.refresh_seconds !== null) patch.refresh_seconds = int(patch.refresh_seconds, 30, 3600, 300);
        delete patch.layout;
        return owned(req, patch, false);
      },
    },
  });

  async function cleanSchedule(req: FastifyRequest | null, s: Row, merged: Row): Promise<void> {
    if (s.target_type !== undefined || s.target_id !== undefined) {
      const type = merged.target_type === 'dashboard' ? 'dashboard' : 'report_definition';
      // Only something the person can see can be scheduled.
      if (!(await sharing.load(req?.user ?? null, type, String(merged.target_id)))) bad('target_id', 'Choose a report or dashboard to send.');
    }
    if (s.recipient_users !== undefined) {
      const ids = Array.isArray(s.recipient_users) ? [...new Set(s.recipient_users.map(String))] : bad('recipient_users', 'Choose people from the list.');
      if (ids.length > 100 || ids.some((id: string) => !UUID_RE.test(id))) bad('recipient_users', 'Choose people from the list.');
      s.recipient_users = ids;
    }
    if (s.recipient_roles !== undefined) {
      const keys = Array.isArray(s.recipient_roles) ? [...new Set(s.recipient_roles.map(String))] : bad('recipient_roles', 'Choose roles from the list.');
      const known = keys.length ? await ctx.db.query('select key from roles where key = any($1::text[])', [keys]) : [];
      if (known.length !== keys.length) bad('recipient_roles', 'One of the roles does not exist.');
      s.recipient_roles = keys;
    }
    if (!(merged.recipient_users ?? []).length && !(merged.recipient_roles ?? []).length) bad('recipient_users', 'Choose at least one person or role to send to.');
    if (s.hour !== undefined) s.hour = int(s.hour, 0, 23, 7);
    if (s.weekday !== undefined && s.weekday !== null) s.weekday = int(s.weekday, 1, 7, 1);
    if (s.month_day !== undefined && s.month_day !== null) s.month_day = int(s.month_day, 1, 31, 1);
    if (merged.target_type === 'dashboard' && merged.format === 'csv') bad('format', 'A dashboard can only be sent as a document.');
    if (s.email !== undefined && !['off', 'link', 'attach'].includes(String(s.email))) bad('email', 'Choose how email is used.');
    if ((merged.email ?? 'link') === 'attach' && !['pdf', 'xlsx', 'csv'].includes(String(merged.format ?? 'html'))) {
      bad('email', 'Only a PDF, Excel or CSV file can be attached. Choose one of those formats, or send a link.');
    }
    s.next_run_at = merged.active === false ? null : nextRun({ ...merged, ...s } as { cadence: string }, new Date()).toISOString();
  }

  ctx.defineResource({
    type: 'report_schedule', table: 'report_schedules', module: 'reports',
    label: 'Report schedule', plural: 'Report schedules', path: '/api/report-schedules', route: '/reports/schedules', titleField: 'name',
    searchable: ['name'], defaultSort: { field: 'name', dir: 'asc' },
    fields: {
      name: { label: 'Name', type: 'text', required: true },
      target_type: { label: 'Sends a', type: 'lookup', list: 'report_schedule_target', default: 'report' },
      target_id: { label: 'Report or dashboard', type: 'text', required: true },
      cadence: { label: 'How often', type: 'lookup', list: 'report_schedule_cadence', default: 'weekly' },
      weekday: { label: 'Day of the week', type: 'number' },
      month_day: { label: 'Day of the month', type: 'number' },
      hour: { label: 'Hour of the day', type: 'number', default: 7 },
      format: { label: 'Format', type: 'lookup', list: 'report_schedule_format', default: 'html' },
      email: { label: 'Email', type: 'lookup', list: 'report_schedule_email', default: 'link' },
      recipient_users: { label: 'People', type: 'json' },
      recipient_roles: { label: 'Roles', type: 'json' },
      active: { label: 'Switched on', type: 'boolean', default: true },
      next_run_at: { label: 'Next delivery', type: 'datetime', readOnly: true },
      last_run_at: { label: 'Last delivery', type: 'datetime', readOnly: true },
      last_status: { label: 'Last result', type: 'text', readOnly: true },
      owner_id: { label: 'Owner', type: 'user', readOnly: true },
    },
    hooks: {
      beforeCreate: async (req, data) => {
        if (req) data.owner_id = req.user!.id;
        await cleanSchedule(req, data, data);
        return data;
      },
      beforeUpdate: async (req, existing, patch) => {
        await cleanSchedule(req, patch, { ...existing, ...patch });
        return patch;
      },
    },
  });

  function cleanSections(sections: unknown): Row[] {
    if (!Array.isArray(sections)) return bad('sections', 'The sections are not valid.');
    if (sections.length > 40) bad('sections', 'A pack can hold at most 40 sections.');
    return sections.map((s: Row, i) => {
      if (s?.kind === 'text') return { kind: 'text', title: text(s.title, 160), body: text(s.body, 20000) };
      if (s?.kind === 'report' && UUID_RE.test(String(s.reportId))) return { kind: 'report', reportId: String(s.reportId), title: s.title ? text(s.title, 160) : undefined };
      return bad('sections', `Section ${i + 1} is not valid.`);
    });
  }

  ctx.defineResource({
    type: 'report_pack', table: 'report_packs', module: 'reports',
    label: 'Report pack', plural: 'Report packs', path: '/api/report-packs', route: '/reports/packs', titleField: 'name',
    searchable: ['name', 'description'], defaultSort: { field: 'name', dir: 'asc' },
    fields: {
      name: { label: 'Name', type: 'text', required: true },
      description: { label: 'Description', type: 'longtext' },
      cover_title: { label: 'Cover title', type: 'text' },
      cover_subtitle: { label: 'Cover subtitle', type: 'text' },
      sections: { label: 'Sections', type: 'json' },
      ...sharingFields,
    },
    hooks: {
      beforeCreate: async (req, data) => {
        if (req) {
          data.sections = cleanSections(data.sections ?? []);
          await checkReportRefs(req, sectionReports(data.sections), [], 'sections');
        }
        return owned(req, data, true);
      },
      beforeUpdate: async (req, existing, patch) => {
        if (patch.sections !== undefined) {
          patch.sections = cleanSections(patch.sections ?? []);
          await checkReportRefs(req, sectionReports(patch.sections), sectionReports(existing.sections), 'sections');
        }
        return owned(req, patch, false);
      },
    },
  });
}
