// Builds the print-ready document for a report, a dashboard or a pack, as one person: every
// figure in it is worked out with that person's permissions.
import { DEFAULT_APP_NAME } from '../../core/config.ts';
import { printBranding } from '../../core/organization.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { AccessError, runReport, type ReportResult } from './query.ts';
import { describeSpecFilters } from './files.ts';
import { htmlDocument, toCsv, type DocInput, type DocSection } from './render.ts';
import { SpecError, type GlobalFilters, type ReportSpec } from './spec.ts';
import { runWidget, type Widget } from './widgets.ts';
import { measureSentence } from '../strategy/widget.ts';

export interface BuiltDocument {
  title: string;
  html: string;
  /** Only for a single report. */
  csv?: string;
  rows: number;
  recordTypes: string[];
  restricted: boolean;
  /** What the document was built from: the PDF and XLSX files are drawn from the same sections. */
  input: DocInput;
}

const globalsNote = (g?: GlobalFilters) => {
  const parts = [g?.from && `from ${g.from}`, g?.to && `to ${g.to}`, g?.department && `department ${g.department}`].filter(Boolean);
  return parts.length ? `Filtered: ${parts.join(', ')}` : undefined;
};

/** Decides whether a section's figures may leave the application in this document. */
export type Allow = (result: ReportResult) => boolean;

/** A recorded figure over time (E41-04) the person may see, or null. */
export type LoadFigure = (user: SessionUser, id: string, months: number) => Promise<{ figure: Row; result: ReportResult; what: string; filters: string[] } | null>;

export function makeDocuments(ctx: ModuleContext, loadReport: (user: SessionUser, id: string) => Promise<Row | undefined>, loadFigure: LoadFigure = async () => null) {
  const appName = () => ctx.settings.get<string>('app.name', DEFAULT_APP_NAME);

  /** Runs a saved report for a document; a problem becomes a note in its place rather than a failure of the whole document. */
  async function reportSection(user: SessionUser, report: Row | undefined, title?: string, globals?: GlobalFilters, now?: Date): Promise<DocSection> {
    if (!report) return { title: title || 'Report', note: 'This report has been removed or is not shared with you.' };
    const head = { title: title || report.name, description: report.description as string | null };
    if (!ctx.resources.get(report.record_type)) return { ...head, note: 'Not available: this needs a part of the application that is not switched on here.' };
    try {
      const result = await runReport(ctx, user, report.spec, { globals, now, limit: 500 });
      return { ...head, result, chart: (report.chart as Row)?.kind, filters: await describeSpecFilters(ctx, report.spec) };
    } catch (err) {
      if (err instanceof AccessError) return { ...head, note: 'Not included: your role does not include this information.' };
      if (err instanceof SpecError) return { ...head, note: `This report could not be run: ${err.message}` };
      throw err;
    }
  }

  /** A figure over time as a section: a line chart of the months recorded and their values; a note when it cannot be shown. */
  async function figureSection(user: SessionUser, id: string, title?: string, months = 12): Promise<DocSection> {
    const got = await loadFigure(user, id, months);
    if (!got) return { title: title || 'Figure over time', note: 'This figure has been removed, or it is not available to you here.' };
    const head = { title: title || String(got.figure.name), description: (got.figure.description as string | null) ?? got.what };
    if (!got.result.rows.length) return { ...head, note: 'Nothing has been recorded for this figure yet.' };
    return { ...head, result: got.result, chart: 'line', filters: got.filters };
  }

  const finish = async (title: string, subtitle: string | null, cover: boolean, given: DocSection[], user: SessionUser, now: Date, filtersNote?: string, allow?: Allow): Promise<BuiltDocument> => {
    // An export leaves out any section whose records the person may view but not export.
    const sections = given.map((s) => (s.result && allow && !allow(s.result)
      ? { title: s.title, note: `Not included: your role does not allow exporting ${s.result.plural.toLowerCase()}.` } : s));
    const results = sections.map((s) => s.result).filter((r): r is ReportResult => Boolean(r));
    const input: DocInput = { title, subtitle, cover, sections, preparedFor: user.displayName, generatedAt: now.toISOString(), appName: await appName(), branding: await printBranding(ctx.db), filtersNote };
    return {
      title,
      input,
      html: htmlDocument(input),
      rows: results.reduce((n, r) => n + r.rows.length, 0),
      recordTypes: [...new Set(results.flatMap((r) => r.recordTypes))],
      restricted: results.some((r) => r.restricted),
    };
  };

  async function forReport(user: SessionUser, report: Row, opts: { globals?: GlobalFilters; now?: Date } = {}): Promise<BuiltDocument> {
    const now = opts.now ?? new Date();
    // An export is the whole answer, not the first screenful: failures are the caller's to hear about.
    const result = await runReport(ctx, user, report.spec, { globals: opts.globals, now, forExport: true });
    const doc = await finish(report.name, report.description ?? null, false, [{ title: report.name, result, chart: (report.chart as Row)?.kind, filters: await describeSpecFilters(ctx, report.spec) }], user, now, globalsNote(opts.globals));
    return { ...doc, csv: toCsv(result, user.displayName) };
  }

  async function forSpec(user: SessionUser, title: string, spec: unknown, chart?: string): Promise<BuiltDocument> {
    const now = new Date();
    const result = await runReport(ctx, user, spec, { now, forExport: true });
    const doc = await finish(title, null, false, [{ title, result, chart, filters: await describeSpecFilters(ctx, spec as ReportSpec) }], user, now);
    return { ...doc, csv: toCsv(result, user.displayName) };
  }

  async function forDashboard(user: SessionUser, dash: Row, opts: { globals?: GlobalFilters; now?: Date; allow?: Allow } = {}): Promise<BuiltDocument> {
    const now = opts.now ?? new Date();
    const widgets = [...((dash.widgets as Widget[]) ?? [])].sort((a, b) => a.y - b.y || a.x - b.x);
    const all: DocSection[] = [];
    // Widgets that share rows of the grid form a group (a band); the PDF gives each band its own page.
    let group = 0;
    let bandEnd = -1;
    for (const w of widgets) {
      if (bandEnd >= 0 && w.y >= bandEnd) group += 1;
      bandEnd = Math.max(bandEnd, (w.y ?? 0) + Math.max(1, w.h ?? 1));
      const sections = { push: (s: DocSection) => all.push({ ...s, group }) };
      const cfg = (w.config ?? {}) as Row;
      const title = w.title || 'Untitled';
      if (w.kind === 'text') { sections.push({ title, markdown: String(cfg.markdown ?? '') }); continue; }
      if (w.kind === 'countdown' && !cfg.spec) { sections.push({ title, note: cfg.deadline ? `Deadline: ${String(cfg.deadline).slice(0, 10)}` : 'No deadline set.' }); continue; }
      const data = await runWidget(ctx, user, w, { globals: opts.globals, now, loadReport: (id) => loadReport(user, id), loadFigure: async (id, months) => (await loadFigure(user, id, months))?.result ?? null });
      if (data.status !== 'ok' || !data.result) { sections.push({ title, note: data.message ?? 'Not available.' }); continue; }
      const extra = data.measure ? measureSentence(data.measure as Parameters<typeof measureSentence>[0]) : data.denominator !== undefined && data.denominator !== null ? `Out of ${data.denominator}.` : data.trend
        ? `${data.trend.current} in the last ${data.trend.days} days; ${data.trend.previous} in the ${data.trend.days} days before.` : null;
      sections.push({ title, description: extra, result: data.result, chart: (data.chart as Row | undefined)?.kind });
    }
    const sections = all;
    return finish(dash.name, dash.description ?? null, false, sections, user, now, globalsNote(opts.globals), opts.allow);
  }

  async function forPack(user: SessionUser, pack: Row, opts: { now?: Date; allow?: Allow } = {}): Promise<BuiltDocument> {
    const now = opts.now ?? new Date();
    const sections: DocSection[] = [];
    for (const s of (pack.sections as Row[]) ?? []) {
      if (s?.kind === 'text') sections.push({ title: String(s.title ?? ''), markdown: String(s.body ?? '') });
      else if (s?.kind === 'report') sections.push(await reportSection(user, await loadReport(user, String(s.reportId)), s.title ? String(s.title) : undefined, undefined, now));
      else if (s?.kind === 'figure') sections.push(await figureSection(user, String(s.figureId), s.title ? String(s.title) : undefined, Number(s.months) || 12));
    }
    return finish(pack.cover_title || pack.name, pack.cover_subtitle ?? pack.description ?? null, true, sections, user, now, undefined, opts.allow);
  }

  /** One figure over time, on its own (Reports > Figures over time > Export). */
  async function forFigure(user: SessionUser, id: string, months: number, now = new Date()): Promise<BuiltDocument> {
    const section = await figureSection(user, id, undefined, months);
    return finish(section.title, `The last ${months} months`, false, [section], user, now);
  }

  return { forReport, forSpec, forDashboard, forPack, forFigure, reportSection, figureSection };
}

export type Documents = ReturnType<typeof makeDocuments>;
