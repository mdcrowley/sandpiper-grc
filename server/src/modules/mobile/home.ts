// My work in one call for the mobile app (wave 13, E38-04): GET /api/mobile/home.
//
// Each section asks the application's own /api routes in-process, with the caller's own credential
// (the app's token or the browser session), the same lists and filters the web's Overview, Approvals,
// inspection and training pages use. So the counts are the web's counts for the same person, every
// permission, restriction and row rule applies unchanged, and a section of a switched-off area (its
// routes answer 404 `switched_off`) or one the person may not open (403) is simply left out.
import type { FastifyRequest } from 'fastify';
import { calendarSources } from '../../core/calendar.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import type { MobileHome, MobileWorkItem, MobileWorkKey, MobileWorkSection } from '../../../../shared/mobile-api.ts';
import type { MyDueWork } from '../../../../shared/work-api.ts';

/** Calendar sources that already have a section of their own (or a list of their own, actions). */
const OWN_SECTIONS = new Set(['audits.inspections', 'condition.assessments_due', 'actions.due']);

export const ITEMS = 5;

const qs = (params: Record<string, string>) => `?${new URLSearchParams(params).toString()}`;

export function registerHome(ctx: ModuleContext) {
  const { app } = ctx;

  /** GET an /api path in-process as the caller; null when it is refused, absent or switched off. */
  async function sub<T>(req: FastifyRequest, path: string): Promise<T | null> {
    const headers: Record<string, string> = {};
    if (req.headers.authorization) headers.authorization = String(req.headers.authorization);
    else if (req.headers.cookie) headers.cookie = String(req.headers.cookie);
    const res = await app.inject({ method: 'GET', url: path, headers });
    if (res.statusCode !== 200) return null;
    try { return res.json() as T; } catch { return null; }
  }

  /** Values of a status list that are not closed, as the web's My work lists choose them. */
  async function openValues(list: string, closed: string[]): Promise<string[]> {
    return (await ctx.lookups.values(list))
      .filter((s) => !closed.includes(s.value) && (s as { meta?: { closed?: boolean } | null }).meta?.closed !== true)
      .map((s) => s.value);
  }

  const today = () => dayInZone(0);
  const overdueDate = (d: unknown) => typeof d === 'string' && d.slice(0, 10) < today();
  const overdueTime = (d: unknown) => typeof d === 'string' && Date.parse(d) < Date.now();

  function section(key: MobileWorkKey, label: string, count: number, items: MobileWorkItem[], webRoute: string): MobileWorkSection {
    return { key, label, count, items: items.slice(0, ITEMS), webRoute };
  }

  /** A section from a generic list route: total as the count, the first rows as items. */
  async function listSection(req: FastifyRequest, key: MobileWorkKey, label: string, type: string, filters: Record<string, string>,
    sort: string, due: string, dueIsTime: boolean): Promise<MobileWorkSection | null> {
    const def = ctx.resources.get(type);
    if (!def) return null;
    const query = { ...Object.fromEntries(Object.entries(filters).map(([k, v]) => [`f.${k}`, v])), sort, dir: 'asc' };
    const res = await sub<{ rows: Row[]; total: number }>(req, `${def.path}${qs({ ...query, pageSize: String(ITEMS) })}`);
    if (!res) return null;
    return section(key, label, res.total, res.rows.map((r) => ({
      type, id: r.id, label: String(r[def.titleField] ?? r.ref ?? r.id), ref: r.ref ?? null, route: `${def.route}/${r.id}`,
      status: r._display?.status ?? r.status ?? null, due: r[due] ?? null, overdue: dueIsTime ? overdueTime(r[due]) : overdueDate(r[due]),
    })), `${def.route}${qs(query)}`);
  }

  app.get('/api/mobile/home', async (req): Promise<MobileHome> => {
    const me = req.user!;
    const sections: MobileWorkSection[] = [];
    const add = (s: MobileWorkSection | null) => { if (s) sections.push(s); };

    // Tickets assigned to me and not resolved (the Overview's "My tickets").
    add(await listSection(req, 'tickets', 'My tickets', 'ticket', { assignee_id: me.id, 'resolved_at.null': 'true' }, 'resolve_due_at', 'resolve_due_at', true));

    // My actions that are not done or canceled (the Overview's "My actions").
    if (ctx.resources.get('action')) {
      const open = await openValues('action_status', ['done', 'cancelled']);
      add(await listSection(req, 'actions', 'My actions', 'action', { owner_id: me.id, status: (open.length ? open : ['open', 'in_progress', 'blocked']).join(',') }, 'due_on', 'due_on', false));
    }

    // Approvals waiting for my decision (the Approvals page).
    const approvals = await sub<{ rows: Row[] }>(req, '/api/workflows/approvals');
    if (approvals) {
      add(section('approvals', 'Approvals waiting for me', approvals.rows.length, approvals.rows.map((r) => ({
        // The app opens its own approval screen: the workflow step is the item.
        type: 'workflow_step', id: r.step_id, label: r.record_title ?? r.workflow ?? 'Approval', ref: r.record_ref ?? null, route: r.route ?? '/approvals',
        status: r.step ?? null, due: r.due_at ?? null, overdue: Boolean(r.overdue),
      })), '/approvals'));
    }

    // Inspections assigned to me that are not complete or missed (the inspection list, filtered to me).
    if (ctx.resources.get('inspection')) {
      const open = await openValues('inspection_status', []);
      add(await listSection(req, 'inspections', 'My inspections', 'inspection', { inspector_id: me.id, status: (open.length ? open : ['scheduled', 'in_progress']).join(',') }, 'due_on', 'due_on', false));
    }

    // Condition assessments due within 30 days, or overdue, for what I look after (my calendar feed's source).
    const condition = calendarSources(app, ctx.resources, me).find((s) => s.key === 'condition.assessments_due');
    if (condition) {
      const events = (await condition.events(ctx, me, '2000-01-01', dayInZone(30)).catch(() => null)) ?? null;
      if (events) {
        events.sort((a, b) => String(a.start).localeCompare(String(b.start)));
        add(section('condition', 'Condition assessments due', events.length, events.map((e) => ({
          type: e.recordType, id: e.recordId, label: e.title.replace(/^Condition assessment due: /, ''), ref: null,
          route: e.url, status: null, due: String(e.start).slice(0, 10), overdue: overdueDate(e.start),
        })), ctx.resources.get('condition_assessment')?.route ?? '/'));
      }
    }

    // Policies waiting for my acknowledgment, and training to complete (the "mine" pages).
    const acks = await sub<{ awaiting: Row[] }>(req, '/api/policies/acknowledgments/mine');
    if (acks) {
      add(section('acknowledgments', 'Policies to acknowledge', acks.awaiting.length, acks.awaiting.map((a) => ({
        // The app opens its own acknowledgment screen: the acknowledgment request is the item.
        type: 'policy_acknowledgment', id: a.id, label: a.policy_title ?? 'Policy', ref: a.policy_ref ?? null, route: '/policies/acknowledgments',
        status: a.state ?? null, due: a.due_on ?? null, overdue: overdueDate(a.due_on),
      })), '/policies/acknowledgments'));
    }
    const training = await sub<{ rows: Row[] }>(req, '/api/training/mine');
    if (training) {
      const todo = training.rows.filter((r) => !r.completed_on);
      add(section('training', 'Training to complete', todo.length, todo.map((r) => ({
        type: 'course', id: r.course_id ?? r.id, label: r.course_title ?? 'Course', ref: r.course_ref ?? null, route: '/training/mine',
        status: r.status ?? null, due: r.due_on ?? null, overdue: overdueDate(r.due_on),
      })), '/training/mine'));
    }

    // Every other kind of due work a module registers as a calendar source (E41-03): evidence requests,
    // control tests, verifications, periods to attest, vendor reassessments, certifications and the rest,
    // from My work's own list (GET /api/work/mine). Inspections and condition assessments have their own
    // sections above (they open the app's field work screens).
    const due = await sub<MyDueWork>(req, `/api/work/mine${qs({ limit: String(ITEMS), skip: [...OWN_SECTIONS].join(',') })}`);
    for (const s of due?.sections ?? []) {
      if (OWN_SECTIONS.has(s.key)) continue;
      add(section(s.key as MobileWorkKey, s.kind, s.count, s.items.map((i) => ({
        type: i.recordType, id: i.recordId, label: i.title, ref: i.ref, route: i.url,
        status: null, due: i.allDay ? i.start.slice(0, 10) : i.start, overdue: i.overdue,
      })), `/calendar${qs({ view: 'mine', kind: s.key })}`));
    }

    const unread = await sub<{ unread: number }>(req, '/api/notifications/unread-count');
    return { sections, unreadNotifications: unread?.unread ?? 0, generatedAt: new Date().toISOString() };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/mobile/home', tag: 'Mobile app',
    summary: 'My work for the mobile app: tickets, actions, approvals, inspections, condition assessments, acknowledgments, training and every other kind of due work (evidence requests, control tests, verifications, attestations, reassessments, certifications) waiting for you',
    description: 'Each section is the same list the web shows the same person (counted the same way, at most 5 items, most urgent first); sections of switched-off areas or of lists you may not open are left out. Due work comes from GET /api/work/mine, one section per kind (its key is the calendar source key, for example `audits.requests`).',
    response: 'MobileHome: { sections: [{ key, label, count, items: [{ type, id, label, ref, route, status, due, overdue }], webRoute }], unreadNotifications, generatedAt }',
  });
}
