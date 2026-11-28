// Where people land, by role (E44-09), and how much is waiting for them (the count on My work).
//
// An administrator chooses, for each role, where its people land after signing in and when they open
// "/": the Overview, My work, the self-service portal or one dashboard (setting `home.role_homes`,
// keyed by role, plus `_none` for people with no role at all). A person with several roles lands on the
// first of their roles' choices in HOME_ORDER: work to do comes before figures to look at. A choice that
// cannot be used (the portal or the reports area switched off, a dashboard removed or no longer shared
// with them, or a permission they lack) falls back to the Overview.
//
// The waiting count is the sum of My work's lists, each asked of the application's own routes in-process
// with the caller's own credential (as the mobile app's My work does), so it is the same count the page
// shows the same person: tickets assigned to them, their open actions, approvals waiting for them, their
// due work, acknowledgments, training and access reviews. Unread notifications are not work (E44-05).
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import { featureState } from '../../core/features.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';

export const HOMES_SETTING = 'home.role_homes';
/** The key for people who hold no role. */
export const NO_ROLE = '_none';
export type HomeKind = 'overview' | 'mywork' | 'portal' | 'dashboard';
/** With several roles, the first of these that one of them chose wins. */
export const HOME_ORDER: HomeKind[] = ['mywork', 'dashboard', 'overview', 'portal'];

/**
 * Where people land before an administrator chooses: people with no role land on My work (where they can
 * report a problem and see their own training and documents); a requester on the portal while it is on.
 */
export const DEFAULT_HOMES: Record<string, string> = { [NO_ROLE]: 'mywork', requester: 'portal' };

const ROUTES: Record<Exclude<HomeKind, 'dashboard'>, string> = { overview: '/', mywork: '/my-work', portal: '/portal' };

/** A stored choice, checked: 'overview', 'mywork', 'portal' or 'dashboard:<id>'. */
export function parseHome(v: unknown): { kind: HomeKind; dashboardId?: string } | null {
  if (v === 'overview' || v === 'mywork' || v === 'portal') return { kind: v };
  if (typeof v === 'string' && v.startsWith('dashboard:') && UUID_RE.test(v.slice(10))) return { kind: 'dashboard', dashboardId: v.slice(10) };
  return null;
}

/** The choice for one person's roles, before checking that it can be used. */
export function chooseHome(roles: string[], homes: Record<string, string>): string {
  const keys = roles.length ? roles : [NO_ROLE];
  const chosen = keys.map((r) => homes[r] ?? DEFAULT_HOMES[r]).filter((v) => parseHome(v));
  for (const kind of HOME_ORDER) {
    const hit = chosen.find((v) => parseHome(v)!.kind === kind);
    if (hit) return hit;
  }
  return 'overview';
}

export async function readHomes(ctx: ModuleContext): Promise<Record<string, string>> {
  const raw = await ctx.settings.get<unknown>(HOMES_SETTING, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Row).filter(([, v]) => parseHome(v)).map(([k, v]) => [k, String(v)]));
}

const portalOn = async (ctx: ModuleContext) => (await featureState(ctx.db)).on.portal === true;

/** Where this person lands: the choice for their roles, if they can use it, else the Overview. */
export async function homeFor(ctx: ModuleContext, user: SessionUser): Promise<{ home: HomeKind; route: string; dashboard: { id: string; name: string } | null }> {
  const overview = { home: 'overview' as const, route: '/', dashboard: null };
  const choice = parseHome(chooseHome(user.roles, await readHomes(ctx)))!;
  if (choice.kind === 'overview') return overview;
  if (choice.kind === 'mywork') return { home: 'mywork', route: ROUTES.mywork, dashboard: null };
  if (choice.kind === 'portal') {
    return (await portalOn(ctx)) && ctx.can(user, 'portal.view') ? { home: 'portal', route: ROUTES.portal, dashboard: null } : overview;
  }
  if (!ctx.resources.get('dashboard') || !ctx.can(user, 'dashboards.view')) return overview;
  const dash = await ctx.resources.find('dashboard', choice.dashboardId!, user).catch(() => undefined);
  return dash ? { home: 'dashboard', route: `/dashboards/${dash.id}`, dashboard: { id: String(dash.id), name: String(dash.name) } } : overview;
}

/** GET an /api path in-process as the caller; null when it is refused, absent or switched off. */
async function sub<T>(ctx: ModuleContext, req: FastifyRequest, path: string): Promise<T | null> {
  const headers: Record<string, string> = {};
  if (req.headers.authorization) headers.authorization = String(req.headers.authorization);
  else if (req.headers.cookie) headers.cookie = String(req.headers.cookie);
  const res = await ctx.app.inject({ method: 'GET', url: path, headers });
  if (res.statusCode !== 200) return null;
  try { return res.json() as T; } catch { return null; }
}

const qs = (params: Record<string, string>) => `?${new URLSearchParams(params).toString()}`;

/** Values of a status list that are not closed, as My work's lists choose them. */
async function openValues(ctx: ModuleContext, list: string, closed: string[], fallback: string[]): Promise<string[]> {
  const open = (await ctx.lookups.values(list))
    .filter((s) => !closed.includes(s.value) && (s as { meta?: { closed?: boolean } | null }).meta?.closed !== true)
    .map((s) => s.value);
  return open.length ? open : fallback;
}

/** How many items wait in each of My work's lists for this person (lists they cannot have are left out). */
export async function waitingFor(ctx: ModuleContext, req: FastifyRequest): Promise<Record<string, number>> {
  const me = req.user!;
  const parts: Record<string, number> = {};
  const sees = (type: string) => {
    const def = ctx.resources.get(type);
    return def ? ctx.can(me, `${def.module}.view`) : false;
  };
  const total = async (type: string, filters: Record<string, string>) => {
    const def = ctx.resources.get(type)!;
    const res = await sub<{ total: number }>(ctx, req, `${def.path}${qs({ ...Object.fromEntries(Object.entries(filters).map(([k, v]) => [`f.${k}`, v])), pageSize: '1' })}`);
    return res?.total ?? null;
  };
  const put = (key: string, n: number | null) => { if (typeof n === 'number') parts[key] = n; };

  if (sees('ticket')) put('my-tickets', await total('ticket', { assignee_id: me.id, 'resolved_at.null': 'true' }));
  if (sees('action')) {
    const open = await openValues(ctx, 'action_status', ['done', 'cancelled'], ['open', 'in_progress', 'blocked']);
    put('my-actions', await total('action', { owner_id: me.id, status: open.join(',') }));
  }
  // The approvals inbox (E44-05): workflow steps, exception requests and documents in review.
  let approvals: number | null = null;
  const steps = await sub<{ rows: unknown[] }>(ctx, req, '/api/workflows/approvals');
  if (steps) approvals = steps.rows.length;
  if (sees('policy_exception') && ctx.can(me, 'exceptions.approve')) {
    const n = await total('policy_exception', { status: 'requested' });
    if (n !== null) approvals = (approvals ?? 0) + n;
  }
  if (sees('policy') && ctx.can(me, 'policies.approve')) {
    const n = await total('policy', { status: 'in_review' });
    if (n !== null) approvals = (approvals ?? 0) + n;
  }
  put('my-approvals', approvals);
  const due = await sub<{ total: number }>(ctx, req, `/api/work/mine${qs({ limit: '1', skip: 'actions.due' })}`);
  put('my-due-work', due?.total ?? null);
  const acks = await sub<{ awaiting: unknown[] }>(ctx, req, '/api/policies/acknowledgments/mine');
  put('my-acknowledgments', acks ? acks.awaiting.length : null);
  const training = await sub<{ rows: { completed_on: string | null }[] }>(ctx, req, '/api/training/mine');
  put('my-training', training ? training.rows.filter((r) => !r.completed_on).length : null);
  if (ctx.can(me, 'systems.view')) {
    const reviews = await sub<{ signed_off_at: string | null }[]>(ctx, req, '/api/access-reviews/mine');
    put('my-access-reviews', Array.isArray(reviews) ? reviews.filter((r) => !r.signed_off_at).length : null);
  }
  return parts;
}

export function registerHome(ctx: ModuleContext) {
  const { app } = ctx;

  app.get('/api/work/home', async (req) => homeFor(ctx, req.user!));
  ctx.describeRoute({
    method: 'GET', path: '/api/work/home', tag: 'My work',
    summary: 'Where I land after signing in and when I open the start page: the Overview, My work or another page an administrator chose',
    description: 'Chosen by an administrator for each role (Administration > Roles). With several roles, the first of My work, a dashboard, the Overview and any other start page that one of them chose. A choice that cannot be used (its part switched off, the dashboard gone or not shared with me) gives the Overview.',
    response: '{ home: overview|mywork|portal|dashboard, route, dashboard: { id, name } | null }',
  });

  app.get('/api/work/waiting', async (req) => {
    const parts = await waitingFor(ctx, req);
    return { count: Object.values(parts).reduce((a, b) => a + b, 0), parts };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/work/waiting', tag: 'My work',
    summary: 'How many items are waiting for me in My work, in total and by list (the count on the My work menu entry)',
    description: 'The same lists, counted the same way, as the My work page. Unread notifications are not counted. Lists of switched-off areas, or that I may not open, are left out.',
    response: '{ count, parts: { "my-tickets"?, "my-actions"?, "my-approvals"?, "my-due-work"?, "my-acknowledgments"?, "my-training"?, "my-access-reviews"? } }',
  });

  const admin = { preHandler: ctx.requirePerm('admin.administer') };
  app.get('/api/work/role-homes', admin, async () => ({ homes: await readHomes(ctx), defaults: DEFAULT_HOMES, order: HOME_ORDER }));
  ctx.describeRoute({
    method: 'GET', path: '/api/work/role-homes', tag: 'My work', permission: 'admin.administer',
    summary: 'Where the people of each role land (role key, or `_none` for people with no role)',
    response: '{ homes: { <role key>: overview|mywork|portal|dashboard:<id> }, defaults, order }',
  });

  app.put('/api/work/role-homes', admin, async (req) => {
    const b = ((req.body ?? {}) as Row).homes;
    if (!b || typeof b !== 'object' || Array.isArray(b)) ctx.fail(400, 'validation', 'Give the home page of each role.', { homes: 'Give an object of role and home page.' });
    const roles = new Set((await ctx.db.query<{ key: string }>('select key from roles')).map((r) => r.key));
    const next = { ...(await readHomes(ctx)) };
    const fields: Record<string, string> = {};
    for (const [role, value] of Object.entries(b as Row)) {
      if (role !== NO_ROLE && !roles.has(role)) { fields[role] = 'There is no such role.'; continue; }
      if (value === null || value === '') { delete next[role]; continue; }
      const home = parseHome(value);
      if (!home) { fields[role] = 'Choose the Overview, My work, the portal or a dashboard.'; continue; }
      if (home.kind === 'dashboard' && !(await ctx.db.one('select 1 from dashboards where id = $1 and deleted_at is null', [home.dashboardId]).catch(() => null))) {
        fields[role] = 'That dashboard does not exist.';
        continue;
      }
      next[role] = String(value);
    }
    if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
    // ctx.settings.set writes the audit event (setting.change) with before and after.
    await ctx.settings.set(HOMES_SETTING, next, req);
    return { homes: next, defaults: DEFAULT_HOMES, order: HOME_ORDER };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/work/role-homes', tag: 'My work', permission: 'admin.administer',
    summary: 'Choose where the people of one or more roles land (audited)',
    body: '{ homes: { <role key or _none>: overview|mywork|portal|dashboard:<id>|null } } (null: back to the default)',
    response: '{ homes, defaults, order }',
  });
}
