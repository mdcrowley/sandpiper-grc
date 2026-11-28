// My work's due items and the compliance calendar (E41-03). Not a feature area and no data of its own:
// both read the calendar source registry (core/calendar.ts), where each module registers the dated
// work it offers once (evidence requests, control tests, verifications, inspections, attestations,
// vendor reassessments, certifications and the rest). So the web's My work, the mobile app's My work
// (modules/mobile/home.ts), the assistant's `my_work` tool, calendar feeds and this calendar all list
// the same items, and a switched-off area's sources are left out of every one of them
// (`calendarSources`: type on, permission held).
//
// - GET /api/work/mine: the signed-in person's own work (sources with `work`), overdue items and
//   those due within `days` (default 30).
// - GET /api/work/calendar: everything dated between two dates that the person may see, for themselves,
//   another person or everyone (sources with `anyone`; the others give only the person's own).
// Visibility is the standard one: each source filters with `visibleWhere`, and `checkedEvents` checks
// every record again. Lists, not figures: what a person may not see is left out.
import { areaOf, calendarSources, checkedEvents, type CalendarScope, type CalendarSource, type CheckedEvent } from '../../core/calendar.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, ModuleDef, SessionUser } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addDays, daysBetween, isYmd, monthEndOf, monthStartOf } from '../../../../shared/dates.ts';
import type { ComplianceCalendar, DueItem, DueSection, MyDueWork } from '../../../../shared/work-api.ts';
import { registerHome } from './home.ts';
import { registerReport } from './report.ts';

/** Overdue work is looked for this far back. */
export const OVERDUE_DAYS_BACK = 3650;
export const MAX_SPAN_DAYS = 400;
export const MAX_ITEMS = 5000;
const validDate = (v: string) => isYmd(v);

/** Past its date: a day before today, or a time before now. */
export function isPast(start: string, allDay: boolean, today: string, now = Date.now()): boolean {
  return allDay ? start.slice(0, 10) < today : Date.parse(start) < now;
}

async function names(ctx: ModuleContext, ids: string[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((id) => UUID_RE.test(id)))];
  if (!list.length) return new Map();
  const rows = await ctx.db.query<{ id: string; display_name: string }>('select id, display_name from users where id = any($1::uuid[])', [list]);
  return new Map(rows.map((r) => [r.id, r.display_name]));
}

/** Checked events as API items, with the person's name, area and whether it is overdue; sorted by date. */
export async function toItems(ctx: ModuleContext, user: SessionUser, events: CheckedEvent[], today = dayInZone(0)): Promise<DueItem[]> {
  const who = (c: CheckedEvent) => c.event.personId !== undefined ? c.event.personId : (c.source.anyone ? null : user.id);
  const named = await names(ctx, events.map((c) => who(c) ?? ''));
  return events.map((c): DueItem => {
    const { event, source } = c;
    const area = areaOf(source, ctx.resources);
    const personId = who(c);
    return {
      uid: event.uid, source: source.key, kind: source.kind ?? source.label, area: area.key, areaLabel: area.label,
      title: event.title, start: event.start, end: event.end ?? null, allDay: event.allDay, url: event.url,
      recordType: event.recordType, recordId: event.recordId, ref: event.ref ?? null,
      personId, personName: personId ? named.get(personId) ?? null : null,
      overdue: Boolean(source.work) && isPast(event.start, event.allDay, today),
      work: Boolean(source.work), restricted: c.restricted,
    };
  }).sort((a, b) => a.start.localeCompare(b.start) || a.uid.localeCompare(b.uid));
}

/** A person's own due work, by kind: the sources with `work`, from long ago (overdue) to `until`. */
export async function myDueWork(ctx: ModuleContext, user: SessionUser, opts: { days?: number; limit?: number; skip?: string[] } = {}): Promise<MyDueWork> {
  const today = dayInZone(0);
  const until = addDays(today, opts.days ?? 30);
  const skip = new Set(opts.skip ?? []);
  const sources = calendarSources(ctx.app, ctx.resources, user).filter((s) => s.work && !skip.has(s.key));
  const items = await toItems(ctx, user, await checkedEvents(ctx, user, sources, addDays(today, -OVERDUE_DAYS_BACK), until), today);
  const limit = opts.limit ?? 5;
  const sections: DueSection[] = [];
  for (const s of sources) {
    const mine = items.filter((i) => i.source === s.key);
    if (!mine.length) continue;
    const area = areaOf(s, ctx.resources);
    sections.push({
      key: s.key, kind: s.kind ?? s.label, area: area.key, areaLabel: area.label,
      count: mine.length, overdue: mine.filter((i) => i.overdue).length, items: mine.slice(0, limit),
    });
  }
  // Kinds with overdue work first, then the soonest due.
  sections.sort((a, b) => (b.overdue > 0 ? 1 : 0) - (a.overdue > 0 ? 1 : 0) || a.items[0].start.localeCompare(b.items[0].start));
  return {
    sections, total: items.length, overdue: items.filter((i) => i.overdue).length, until, generatedAt: new Date().toISOString(),
  };
}

const list = (v: unknown): string[] => (typeof v === 'string' ? v.split(',') : Array.isArray(v) ? v.map(String) : []).map((x) => x.trim()).filter(Boolean);

function registerRoutes(ctx: ModuleContext) {
  const { app } = ctx;

  app.get('/api/work/mine', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const days = q.days === undefined ? 30 : Number(q.days);
    const limit = q.limit === undefined ? 5 : Number(q.limit);
    const fields: Record<string, string> = {};
    if (!Number.isInteger(days) || days < 0 || days > 365) fields.days = 'Give a whole number of days from 0 to 365.';
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) fields.limit = 'Give a whole number from 1 to 200.';
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    return myDueWork(ctx, req.user!, { days, limit, skip: list(q.skip) });
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/work/mine', tag: 'My work',
    summary: 'My due work across every area that is on, by kind: each kind of dated work an area offers',
    description: 'Each kind is a calendar source a module registers (`work`). Items are the signed-in person\'s own, visible to them, overdue or due within `days` (default 30, at most 365); each kind lists at most `limit` items (default 5, at most 200), most urgent first, with its full count. Kinds of switched-off areas, or that need a permission the person lacks, are left out.',
    query: { type: 'object', properties: { days: { type: 'integer', minimum: 0, maximum: 365 }, limit: { type: 'integer', minimum: 1, maximum: 200 }, skip: { type: 'string', description: 'Comma-separated kinds (source keys) to leave out, for example `actions.due` where actions have a list of their own.' } } },
    response: 'MyDueWork: { sections: [{ key, kind, area, areaLabel, count, overdue, items: DueItem[] }], total, overdue, until, generatedAt }',
  });

  app.get('/api/work/calendar', async (req): Promise<ComplianceCalendar> => {
    const user = req.user!;
    const q = req.query as Record<string, unknown>;
    const today = dayInZone(0);
    const from = typeof q.from === 'string' && q.from ? q.from : monthStartOf(today);
    const to = typeof q.to === 'string' && q.to ? q.to : (isYmd(from) ? monthEndOf(from) : from);
    const person = typeof q.person === 'string' && q.person ? q.person : 'me';
    const fields: Record<string, string> = {};
    if (!validDate(from)) fields.from = 'Give the first day (YYYY-MM-DD).';
    if (!validDate(to)) fields.to = 'Give the last day (YYYY-MM-DD).';
    else if (validDate(from) && (to < from || daysBetween(from, to) > MAX_SPAN_DAYS)) fields.to = `Give a last day on or after the first, at most ${MAX_SPAN_DAYS} days later.`;
    if (person !== 'me' && person !== 'all' && !UUID_RE.test(person)) fields.person = 'Choose me, all or a person.';
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

    const all = calendarSources(app, ctx.resources, user);
    const areas = list(q.area);
    const kinds = list(q.kind);
    const chosen = all.filter((s) => (!areas.length || areas.includes(areaOf(s, ctx.resources).key)) && (!kinds.length || kinds.includes(s.key)));
    const scope: CalendarScope | undefined = person === 'me' ? undefined : { person: person === 'all' ? null : person };
    const items = await toItems(ctx, user, await checkedEvents(ctx, user, chosen, from, to, scope), today);

    const seenAreas = new Map<string, string>();
    for (const s of all) { const a = areaOf(s, ctx.resources); seenAreas.set(a.key, a.label); }
    const ownOnly = scope && scope.person !== user.id ? chosen.filter((s) => !s.anyone).map((s) => s.key) : [];
    return {
      from, to, person, items: items.slice(0, MAX_ITEMS),
      areas: [...seenAreas].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)),
      kinds: all.map((s: CalendarSource) => ({ key: s.key, kind: s.kind ?? s.label, area: areaOf(s, ctx.resources).key, anyone: Boolean(s.anyone) })),
      ownOnly, truncated: items.length > MAX_ITEMS,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/work/calendar', tag: 'My work',
    summary: 'The compliance calendar: everything dated between two days that you may see, across every area that is on',
    description: '`from` and `to` (YYYY-MM-DD, at most 400 days apart; default the current month). `person`: `me` (default), `all`, or a user id; '
      + 'kinds that give only your own items (`ownOnly`) are left out for anyone else. `area` and `kind`: comma-separated area keys or source keys. '
      + 'Every record is checked against your visibility (restricted records, scope); kinds of switched-off areas are left out.',
    query: { type: 'object', properties: { from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' }, person: { type: 'string' }, area: { type: 'string' }, kind: { type: 'string' } } },
    response: 'ComplianceCalendar: { from, to, person, items: DueItem[], areas: [{ key, label }], kinds: [{ key, kind, area, anyone }], ownOnly, truncated }',
  });
}

const mod: ModuleDef = {
  key: 'work',
  async register(ctx) {
    registerRoutes(ctx);
    // Wave 26: where people land by role, the waiting count on My work (E44-09), and Report a problem.
    registerHome(ctx);
    registerReport(ctx);
  },
};
export default mod;
