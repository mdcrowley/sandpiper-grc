// Reporting: the report builder's query service, dashboards, report packs, exports and
// scheduled delivery. Permission modules: `reports` and `dashboards`.
//
// The one rule everything here keeps: figures are always worked out with the permissions of the
// person looking at them (see spec.ts and query.ts), never the author's.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleDef, Row, SessionUser } from '../../core/module.ts';
import { catalog } from './catalog.ts';
import { makeDocuments, type Allow, type BuiltDocument } from './documents.ts';
import { EXPORT_KINDS, FILE_TYPES, FORMAT_NAMES, renderFile } from './files.ts';
import { AccessError, runReport } from './query.ts';
import { defineReportResources } from './resources.ts';
import { runDueSchedules, runSchedule } from './schedule.ts';
import { seedStandard } from './seed.ts';
import { makeSharing } from './sharing.ts';
import { makeSnapshots } from './snapshots.ts';
import { mayView, reportable, SpecError, type GlobalFilters } from './spec.ts';
import { runWidget, type Widget } from './widgets.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Dashboard-wide filter values from a request body or from `g.<name>` query parameters. */
function readGlobals(source: unknown): GlobalFilters {
  const s = (source && typeof source === 'object' ? source : {}) as Row;
  const pick = (k: string) => { const v = s[k] ?? s[`g.${k}`]; return typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined; };
  const date = (k: string) => { const v = pick(k); return v && DATE_RE.test(v) ? v : undefined; };
  const id = (k: string, me = false) => { const v = pick(k); return v && (UUID_RE.test(v) || (me && v === 'me')) ? v : undefined; };
  return { from: date('from'), to: date('to'), department: pick('department'), site: id('site'), system: id('system'), owner: id('owner', true) };
}

const mod: ModuleDef = {
  key: 'reports',

  async seedDefaults(ctx) {
    await ctx.lookups.ensure('report_sharing', [
      { value: 'private', label: 'Only me', color: 'gray', sort: 10 },
      { value: 'roles', label: 'Chosen roles', color: 'blue', sort: 20 },
      { value: 'everyone', label: 'Everyone', color: 'green', sort: 30 },
    ], { public: true });
    await ctx.lookups.ensure('report_schedule_cadence', [
      { value: 'daily', label: 'Every day', color: 'blue', sort: 10 },
      { value: 'weekly', label: 'Every week', color: 'teal', sort: 20 },
      { value: 'monthly', label: 'Every month', color: 'purple', sort: 30 },
    ], { module: 'reports' });
    await ctx.lookups.ensure('report_schedule_format', [
      { value: 'html', label: 'Document (print or save as PDF)', color: 'blue', sort: 10 },
      { value: 'csv', label: 'Spreadsheet file (CSV)', color: 'green', sort: 20 },
      { value: 'xlsx', label: 'Excel file (XLSX)', color: 'teal', sort: 30 },
      { value: 'pdf', label: 'PDF file', color: 'purple', sort: 40 },
    ], { module: 'reports' });
    await ctx.lookups.ensure('report_schedule_target', [
      { value: 'report', label: 'Report', color: 'blue', sort: 10 },
      { value: 'dashboard', label: 'Dashboard', color: 'teal', sort: 20 },
    ], { module: 'reports' });
  },

  async register(ctx) {
    const { app, db } = ctx;
    const sharing = makeSharing(ctx);
    const snapshots = makeSnapshots(ctx);
    // A saved report inside a dashboard or pack runs only for people it is shared with; everyone
    // else sees a "not shared with you" placeholder in its place.
    const visibleReport = async (user: SessionUser, id: string) => sharing.load(user, 'report_definition', id);
    const documents = makeDocuments(ctx, visibleReport);
    const deps = { documents, snapshots, canSee: (user: SessionUser, type: 'report_definition' | 'dashboard', row: Row) => sharing.canSee(user, type, row) };

    // Must be in place before the generated routes are defined: it applies the sharing rules to them.
    app.addHook('preHandler', sharing.guard);
    defineReportResources(ctx, sharing);

    const anyOf = (...perms: string[]) => async (req: FastifyRequest) => {
      if (!perms.some((p) => ctx.can(req.user, p))) ctx.fail(403, 'forbidden', 'You do not have permission to do that.');
    };
    const fromSpecError = (err: unknown): never => {
      if (err instanceof AccessError) ctx.fail(403, 'forbidden', err.message);
      if (err instanceof SpecError) ctx.fail(400, 'bad_report', err.message, err.field ? { [err.field]: err.message } : undefined);
      throw err;
    };
    const need = async (req: FastifyRequest, type: string, label: string) =>
      (await sharing.load(req.user, type, (req.params as { id: string }).id)) ?? ctx.fail(404, 'not_found', `${label} not found.`);
    /** Exporting needs export permission on every record type whose rows leave, exactly as the generic CSV export does. */
    const exportAllowed = (user: SessionUser): Allow => (r) => r.recordTypes.every((t) => { const d = ctx.resources.get(t); return Boolean(d && mayView(ctx, user, d, 'export')); });

    async function send(req: FastifyRequest, reply: FastifyReply, doc: BuiltDocument, format: string, audit: { type: string; id?: string; what: string }) {
      const kind = format === 'csv' && doc.csv !== undefined ? 'csv' : format === 'xlsx' || format === 'pdf' ? format : 'html';
      const body = await renderFile(doc, kind, audit.type);
      // Every export is in the audit trail, with whether restricted records were in it.
      await ctx.audit(req, {
        action: `${audit.type}.export`, recordType: audit.type, recordId: audit.id,
        summary: `Exported ${audit.what} to ${FORMAT_NAMES[kind]} (${doc.rows} rows${doc.restricted ? ', includes restricted records' : ''})`,
        after: { record_types: doc.recordTypes, restricted: doc.restricted, format: kind },
      });
      const file = doc.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'report';
      reply.header('content-type', FILE_TYPES[kind]);
      reply.header('content-disposition', `${kind === 'html' ? 'inline' : 'attachment'}; filename="${file}.${kind}"`);
      reply.header('cache-control', 'no-store');
      return body;
    }

    // ---------- builder support ----------

    const viewer = anyOf('reports.view', 'dashboards.view');

    app.get('/api/reports/catalog', { preHandler: viewer }, async (req) => ({ types: await catalog(ctx, req.user) }));

    app.get('/api/reports/roles', { preHandler: viewer }, async () =>
      db.query('select key, name from roles where enabled order by name'));

    /** Values offered by the dashboard "department" filter: what is recorded on records the caller may view. */
    app.get('/api/reports/departments', { preHandler: viewer }, async (req) => {
      const names = new Set<string>((await db.query<{ name: string }>('select name from departments where deleted_at is null')).map((r) => r.name));
      for (const d of ctx.resources.all()) {
        if (!reportable(d) || !mayView(ctx, req.user, d)) continue;
        for (const field of ['department', 'requester_department'].filter((n) => d.fields[n]?.type === 'text')) {
          const rows = await db.query<{ v: string }>(
            `select distinct ${field} as v from ${d.table} where deleted_at is null and ${ctx.resources.visibleWhere(d.type, req.user)} and ${field} is not null and ${field} <> '' limit 200`,
          );
          for (const r of rows) names.add(r.v);
        }
      }
      return [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ value: name, label: name }));
    });

    // ---------- running ----------

    app.post('/api/reports/run', { preHandler: viewer }, async (req) => {
      const b = (req.body ?? {}) as Row;
      return runReport(ctx, req.user, b.spec, { globals: readGlobals(b.globals), dateField: typeof b.dateField === 'string' ? b.dateField : undefined, limit: b.limit }).catch(fromSpecError);
    });

    app.get('/api/reports/:id/run', { preHandler: ctx.requirePerm('reports.view') }, async (req) => {
      const report = await need(req, 'report_definition', 'Report');
      if (!ctx.resources.get(report.record_type)) ctx.fail(409, 'unavailable', 'This report needs a part of the application that is not switched on here.');
      const result = await runReport(ctx, req.user, report.spec, { globals: readGlobals(req.query) }).catch(fromSpecError);
      return { report: { id: report.id, name: report.name, description: report.description, chart: report.chart }, result };
    });

    // ---------- exports ----------

    const checkFormat = (f: unknown, csv = true) => (typeof f === 'string' && (EXPORT_KINDS as string[]).includes(f) && (csv || f !== 'csv') ? f
      : ctx.fail(400, 'bad_format', csv ? 'Choose CSV, Excel, PDF or a print-ready document.' : 'Choose Excel, PDF or a print-ready document.'));
    const needExport = (user: SessionUser, types: string[]) => {
      for (const t of types) {
        const d = ctx.resources.get(t);
        if (!d || !mayView(ctx, user, d, 'export')) ctx.fail(403, 'forbidden', `Your role does not allow exporting ${d?.plural.toLowerCase() ?? 'these records'}.`);
      }
    };

    app.post('/api/reports/export', { preHandler: ctx.requirePerm('reports.export') }, async (req, reply) => {
      const b = (req.body ?? {}) as Row;
      const format = checkFormat(b.format);
      const doc = await documents.forSpec(req.user!, String(b.title ?? '').trim().slice(0, 160) || 'Report', b.spec, b.chart?.kind).catch(fromSpecError);
      needExport(req.user!, doc.recordTypes);
      return send(req, reply, doc, format, { type: 'report_definition', what: `an unsaved report "${doc.title}"` });
    });

    app.get('/api/reports/:id/export', { preHandler: ctx.requirePerm('reports.export') }, async (req, reply) => {
      const report = await need(req, 'report_definition', 'Report');
      const format = checkFormat((req.query as Row).format ?? 'csv');
      const doc = await documents.forReport(req.user!, report, { globals: readGlobals(req.query) }).catch(fromSpecError);
      needExport(req.user!, doc.recordTypes);
      return send(req, reply, doc, format, { type: 'report_definition', id: report.id, what: `report "${report.name}"` });
    });

    app.get('/api/dashboards/:id/export', { preHandler: ctx.requirePerm('dashboards.export') }, async (req, reply) => {
      const dash = await need(req, 'dashboard', 'Dashboard');
      const format = checkFormat((req.query as Row).format ?? 'html', false);
      const doc = await documents.forDashboard(req.user!, dash, { globals: readGlobals(req.query), allow: exportAllowed(req.user!) });
      return send(req, reply, doc, format, { type: 'dashboard', id: dash.id, what: `dashboard "${dash.name}"` });
    });

    app.get('/api/report-packs/:id/export', { preHandler: ctx.requirePerm('reports.export') }, async (req, reply) => {
      const pack = await need(req, 'report_pack', 'Report pack');
      const format = checkFormat((req.query as Row).format ?? 'html', false);
      const doc = await documents.forPack(req.user!, pack, { allow: exportAllowed(req.user!) });
      return send(req, reply, doc, format, { type: 'report_pack', id: pack.id, what: `report pack "${pack.name}"` });
    });

    // ---------- dashboards ----------

    app.post('/api/dashboards/run-widget', { preHandler: ctx.requirePerm('dashboards.view') }, async (req) => {
      const b = (req.body ?? {}) as Row;
      const widget = (b.widget && typeof b.widget === 'object' ? b.widget : ctx.fail(400, 'validation', 'No widget was given.')) as Widget;
      // A saved report runs only when it is shared with the viewer, wherever it is placed.
      const loadReport = async (id: string) => visibleReport(req.user!, id);
      return runWidget(ctx, req.user, widget, { globals: readGlobals(b.globals), month: b.month, loadReport });
    });

    /**
     * The signed-in person's chosen home dashboard, for the Overview page. Never fails for lack of
     * permission: `dashboard` is null when nothing is chosen, it was removed, or it is no longer shared.
     */
    app.get('/api/dashboards/home', async (req) => {
      const none = { dashboard: null, route: null };
      if (!ctx.can(req.user, 'dashboards.view')) return none;
      const pick = await db.one<{ dashboard_id: string }>('select dashboard_id from dashboard_home where user_id = $1', [req.user!.id]);
      const dash = pick ? await sharing.load(req.user, 'dashboard', pick.dashboard_id) : undefined;
      return dash ? { dashboard: { id: dash.id, name: dash.name, description: dash.description }, route: `/dashboards/${dash.id}` } : none;
    });

    // A personal view setting, like notification read state: not written to the audit log.
    app.post('/api/dashboards/home', { preHandler: ctx.requirePerm('dashboards.view') }, async (req) => {
      const id = ((req.body ?? {}) as Row).dashboard_id;
      if (id === null || id === undefined || id === '') {
        await db.query('delete from dashboard_home where user_id = $1', [req.user!.id]);
        return { dashboard: null, route: null };
      }
      const dash = (await sharing.load(req.user, 'dashboard', String(id))) ?? ctx.fail(404, 'not_found', 'Dashboard not found.');
      await db.query(
        `insert into dashboard_home (user_id, dashboard_id) values ($1, $2)
         on conflict (user_id) do update set dashboard_id = excluded.dashboard_id, updated_at = now()`, [req.user!.id, dash.id],
      );
      return { dashboard: { id: dash.id, name: dash.name, description: dash.description }, route: `/dashboards/${dash.id}` };
    });

    // ---------- packs ----------

    /** The pack as the caller would see it now: each section with its figures, for the on-screen preview. */
    app.get('/api/report-packs/:id/preview', { preHandler: ctx.requirePerm('reports.view') }, async (req) => {
      const pack = await need(req, 'report_pack', 'Report pack');
      const sections = [];
      for (const s of (pack.sections as Row[]) ?? []) {
        if (s.kind === 'text') { sections.push({ kind: 'text', title: s.title, body: s.body }); continue; }
        const report = await visibleReport(req.user!, String(s.reportId));
        const sec = await documents.reportSection(req.user!, report, s.title);
        sections.push({ kind: 'report', reportId: s.reportId, title: sec.title, description: sec.description ?? null, note: sec.note ?? null, result: sec.result ?? null, chart: report?.chart ?? null });
      }
      return { pack: { id: pack.id, name: pack.name, cover_title: pack.cover_title, cover_subtitle: pack.cover_subtitle, description: pack.description }, sections, generatedAt: new Date().toISOString(), preparedFor: req.user!.displayName };
    });

    /** Freezes the pack as a dated document that can be opened again later. */
    app.post('/api/report-packs/:id/produce', { preHandler: ctx.requirePerm('reports.export') }, async (req, reply) => {
      const pack = await need(req, 'report_pack', 'Report pack');
      const doc = await documents.forPack(req.user!, pack, { allow: exportAllowed(req.user!) });
      const id = await snapshots.save({ sourceType: 'pack', sourceId: pack.id, title: doc.title, format: 'html', forUser: req.user!, content: doc.html, recordTypes: doc.recordTypes, restricted: doc.restricted });
      await ctx.audit(req, {
        action: 'report_pack.produce', recordType: 'report_pack', recordId: pack.id,
        summary: `Produced report pack "${pack.name}" (${doc.rows} rows${doc.restricted ? ', includes restricted records' : ''})`, after: { snapshot_id: id, record_types: doc.recordTypes, restricted: doc.restricted },
      });
      reply.code(201);
      return snapshots.meta(id);
    });

    app.get('/api/report-packs/:id/snapshots', { preHandler: ctx.requirePerm('reports.view') }, async (req) => {
      const pack = await need(req, 'report_pack', 'Report pack');
      const out: Row[] = [];
      for (const s of await snapshots.listForSource('pack', pack.id)) if (snapshots.mayOpen(req.user!, s, true) && await sourceAllows(req.user!, s)) out.push(s);
      return out;
    });

    // ---------- snapshots ----------

    const SNAP_SOURCE: Record<string, { type: string; module: string }> = {
      report: { type: 'report_definition', module: 'reports' },
      dashboard: { type: 'dashboard', module: 'dashboards' },
      pack: { type: 'report_pack', module: 'reports' },
    };
    /**
     * Reading a stored copy inside the application is viewing: it needs view permission on what it
     * was made from, and that report, dashboard or pack, and every saved report in it that still
     * exists, must still be visible to the person. Only taking it out of the application (download)
     * is an export.
     */
    async function sourceAllows(user: SessionUser, row: Row): Promise<boolean> {
      const src = SNAP_SOURCE[row.source_type];
      if (!src || !ctx.can(user, `${src.module}.view`)) return false;
      const source = await sharing.load(user, src.type, row.source_id);
      if (!source) return false;
      const refs = row.source_type === 'dashboard'
        ? ((source.widgets as Row[]) ?? []).filter((w) => w?.kind === 'report').map((w) => String(w.config?.reportId ?? ''))
        : row.source_type === 'pack' ? ((source.sections as Row[]) ?? []).filter((s) => s?.kind === 'report').map((s) => String(s.reportId)) : [];
      for (const id of refs) {
        if (!UUID_RE.test(id)) continue;
        const exists = await db.one('select 1 from report_definitions where id = $1 and deleted_at is null', [id]);
        if (exists && !(await sharing.load(user, 'report_definition', id))) return false;
      }
      return true;
    }
    const mayDownload = (user: SessionUser, row: Row) => ctx.can(user, `${SNAP_SOURCE[row.source_type]?.module ?? 'reports'}.export`);

    async function openSnapshot(req: FastifyRequest): Promise<Row> {
      const row = await snapshots.meta((req.params as { id: string }).id);
      const allowed = row ? await sourceAllows(req.user!, row) : false;
      // Someone else's snapshot is "not found", exactly like one that does not exist.
      if (!row || !allowed || !snapshots.mayOpen(req.user!, row, row.source_type === 'pack')) ctx.fail(404, 'not_found', 'This document was not found, or it was produced for someone else.');
      return { ...row!, can_download: mayDownload(req.user!, row!) };
    }

    app.get('/api/reports/snapshots', async (req) => {
      const out: Row[] = [];
      for (const row of await snapshots.listFor(req.user!)) if (await sourceAllows(req.user!, row)) out.push(row);
      return out;
    });
    app.get('/api/reports/snapshots/:id', async (req) => openSnapshot(req));
    app.get('/api/reports/snapshots/:id/content', async (req, reply) => {
      const row = await openSnapshot(req);
      const kind = (EXPORT_KINDS as string[]).includes(row.format) ? row.format as 'csv' | 'html' | 'pdf' | 'xlsx' : 'html';
      const file = kind !== 'html';
      // A file (spreadsheet, PDF), or ?download=1, leaves the application: that is an export.
      const download = file || (req.query as Row).download === '1';
      if (download && !row.can_download) ctx.fail(403, 'forbidden', 'Your role does not allow taking this out of the application. You can read it here.');
      await ctx.audit(req, {
        action: download ? 'report_snapshot.export' : 'report_snapshot.open', recordType: 'report_snapshot', recordId: row.id,
        summary: `${download ? 'Downloaded' : 'Opened'} stored ${file ? 'export' : 'document'} "${row.title}"${row.restricted ? ' (includes restricted records)' : ''}`,
      });
      reply.header('content-type', FILE_TYPES[kind]);
      reply.header('content-disposition', `${download ? 'attachment' : 'inline'}; filename="snapshot-${String(row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at).slice(0, 10)}.${kind}"`);
      reply.header('cache-control', 'no-store');
      return snapshots.content(row.id);
    });

    // ---------- schedules ----------

    app.post('/api/report-schedules/:id/run-now', { preHandler: ctx.requirePerm('reports.edit') }, async (req) => {
      const s = await need(req, 'report_schedule', 'Schedule');
      if (!sharing.canChange(req.user, 'report_schedule', s)) ctx.fail(403, 'forbidden', 'Only the owner of this schedule can run it.');
      return runSchedule(ctx, deps, s, new Date());
    });

    app.get('/api/report-schedules/:id/deliveries', { preHandler: ctx.requirePerm('reports.view') }, async (req) => {
      const s = await need(req, 'report_schedule', 'Schedule');
      return db.query(
        `select d.id, d.status, d.detail, d.created_at, d.snapshot_id, u.display_name as user_name
         from report_deliveries d left join users u on u.id = d.user_id where d.schedule_id = $1 order by d.created_at desc, d.id limit 100`, [s.id],
      );
    });

    app.post('/api/report-schedules/run-due', { preHandler: ctx.requirePerm('admin.administer') }, async () => runDueSchedules(ctx, deps, new Date()));

    // The in-process scheduler. No timers under the test runner or with a throwaway in-memory database.
    if (!process.env.VITEST && ctx.dataDir !== 'memory' && process.env.GRC_DATA_DIR !== 'memory') {
      const tick = () => { runDueSchedules(ctx, deps, new Date()).catch((err) => console.error('[reports] scheduled delivery failed:', err)); };
      const first = setTimeout(tick, 90_000);
      const timer = setInterval(tick, 5 * 60_000);
      first.unref();
      timer.unref();
      app.addHook('onClose', async () => { clearTimeout(first); clearInterval(timer); });
    }
  },

  async seed(ctx) {
    return seedStandard(ctx);
  },
};

export default mod;
