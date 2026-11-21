// E15 Self-service portal: a simple area for any member of staff to raise and follow their own
// requests, read staff knowledge articles, and see what is waiting for them.
//
// Everything here is behind the `portal` feature switch (off by default) and the `portal.*`
// permissions (the Requester role, off by default). It builds on the tickets module and does
// nothing when that module is not loaded.
import type { FastifyInstance } from 'fastify';
import { approvalEngine } from '../../core/approval-kinds.ts';
import type { ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { articleVote, recordArticleFeedback } from '../tickets/feedback.ts';
import { makeAccess } from './access.ts';
import { makeFiles, type PortalFiles } from './files.ts';
import { registerRequests } from './requests.ts';
import { seedPortal } from './seed.ts';
import { BANNER_TONES, isEnabled, readSettings, saveSettings } from './settings.ts';
import { AFFECTS, URGENCY } from './words.ts';

/** Knowledge articles written for everyone (the `kb_audience` value). */
export const STAFF_AUDIENCE = 'staff';

const filesFor = new WeakMap<FastifyInstance, PortalFiles>();

const mod: ModuleDef = {
  key: 'portal',

  async seedDefaults(ctx) {
    // The file hook has to be in place before the attachments module creates its upload route.
    if (!filesFor.has(ctx.app)) {
      const files = makeFiles(ctx);
      files.addHook();
      filesFor.set(ctx.app, files);
    }
  },

  async register(ctx) {
    // Modules register in alphabetical order, so the tickets module is not there yet: check once ready.
    ctx.app.addHook('onReady', async () => {
      if (!ctx.resources.get('ticket') && !process.env.VITEST) console.warn('[portal] the tickets module is not loaded: the portal is not available.');
    });
    const { app, db } = ctx;
    const access = makeAccess(ctx);
    const files = filesFor.get(app) ?? makeFiles(ctx);
    const view = { preHandler: access.need('portal.view') };
    const administer = { preHandler: ctx.requirePerm('tickets.administer') };

    // ---------- configuration the portal page needs ----------

    // Any signed-in person may ask whether the portal is on (the application decides where to send them).
    app.get('/api/portal/config', async (req) => {
      const enabled = Boolean(ctx.resources.get('ticket')) && (await isEnabled(ctx));
      const allowed = ctx.can(req.user, 'portal.view');
      if (!enabled || !allowed) return { enabled, allowed };
      const s = await readSettings(ctx);
      return {
        enabled, allowed, title: s.title, intro: s.intro, banner: s.banner, reopen_days: s.reopen_days,
        can_create: ctx.can(req.user, 'portal.create'),
        // E15-12: who I may raise a request for (nobody, my department, anyone).
        on_behalf: ctx.can(req.user, 'portal.create') ? s.on_behalf : 'nobody',
        files: files.available(),
        has: {
          assets: Boolean(ctx.resources.get('asset')),
          training: Boolean(ctx.resources.get('course')),
          policies: Boolean(ctx.resources.get('policy')),
          changes: Boolean(ctx.resources.get('change')) && ctx.can(req.user, 'changes.approve'),
          ticket_approvals: ctx.can(req.user, 'tickets.approve'),
          // E20-13: reporting a safety event (the safety module adds the routes).
          safety: Boolean(ctx.resources.get('safety_event')) && s.safety_reports && ctx.can(req.user, 'portal.create'),
        },
        affects: AFFECTS.map(({ value, label }) => ({ value, label })),
        urgency: URGENCY.map(({ value, label }) => ({ value, label })),
      };
    });
    ctx.describeRoute({ method: 'GET', path: '/api/portal/config', summary: 'Whether the portal is on for me, and its title, banner and options' });

    // ---------- catalog ----------

    app.get('/api/portal/catalog', view, async () => {
      const cats = await ctx.lookups.values('catalog_category');
      const rows = await db.query<Row>(
        `select id, name, description, category, questions, requires_approval, defaults->>'type' as type
         from catalog_items where deleted_at is null and active and portal order by name`);
      return rows.map((r) => ({
        id: r.id, name: r.name, description: r.description, category: r.category,
        category_label: cats.find((c) => c.value === r.category)?.label ?? 'Other',
        questions: r.questions ?? [], requires_approval: r.requires_approval, type: r.type === 'incident' ? 'incident' : 'request',
      }));
    });
    ctx.describeRoute({ method: 'GET', path: '/api/portal/catalog', permission: 'portal.view', summary: 'Catalog items offered in the portal' });

    // ---------- knowledge for staff ----------

    const ARTICLE = `deleted_at is null and status = 'published' and audience = '${STAFF_AUDIENCE}'`;
    const excerpt = (body: unknown) => String(body ?? '').replace(/\s+/g, ' ').trim().slice(0, 180);

    app.get('/api/portal/knowledge', view, async (req) => {
      const q = String((req.query as Row).q ?? '').trim().slice(0, 200);
      const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2).slice(0, 8);
      let rows: Row[];
      if (!words.length) {
        rows = await db.query<Row>(`select id, ref, title, body, category from knowledge_articles where ${ARTICLE}
                                    order by helpful_yes desc, updated_at desc limit 6`);
      } else {
        // Each word found in the title counts double; an article must match at least one word.
        const params = words.map((w) => `%${w.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
        const score = params.map((_, i) => `(case when title ilike $${i + 1} then 2 else 0 end + case when body ilike $${i + 1} then 1 else 0 end)`).join(' + ');
        rows = await db.query<Row>(
          `select * from (select id, ref, title, body, category, helpful_yes, (${score}) as score from knowledge_articles where ${ARTICLE}) x
           where score > 0 order by score desc, helpful_yes desc limit 8`, params);
      }
      const cats = await ctx.lookups.values('kb_category');
      return rows.map((r) => ({
        id: r.id, ref: r.ref, title: r.title, excerpt: excerpt(r.body), category_label: cats.find((c) => c.value === r.category)?.label ?? null,
      }));
    });
    ctx.describeRoute({ method: 'GET', path: '/api/portal/knowledge', permission: 'portal.view', summary: 'Published articles for all staff, best match first', query: { q: 'Words to find' } });

    const needArticle = async (id: unknown) => (typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)
      ? await db.one<Row>(`select * from knowledge_articles where id = $1 and ${ARTICLE}`, [id]) : undefined)
      ?? ctx.fail(404, 'not_found', 'Article not found.');

    app.get('/api/portal/knowledge/:id', view, async (req) => {
      const a = await needArticle((req.params as Row).id);
      return {
        id: a.id, ref: a.ref, title: a.title, body: a.body, updated_at: a.updated_at,
        helpful_yes: a.helpful_yes, your_vote: await articleVote(ctx, req.user!.id, a),
      };
    });
    ctx.describeRoute({ method: 'GET', path: '/api/portal/knowledge/:id', permission: 'portal.view', summary: 'One article for all staff' });

    app.post('/api/portal/knowledge/:id/feedback', view, async (req) => {
      const a = await needArticle((req.params as Row).id);
      return recordArticleFeedback(ctx, req, a, (req.body as Row | undefined)?.helpful);
    });
    ctx.describeRoute({ method: 'POST', path: '/api/portal/knowledge/:id/feedback', permission: 'portal.view', summary: 'Say whether an article helped', body: '{ helpful: boolean }' });

    // ---------- my assets ----------

    app.get('/api/portal/assets', view, async (req) => {
      if (!ctx.resources.get('asset')) return { available: false, rows: [] };
      const types = await ctx.lookups.values('asset_type');
      const rows = await db.query<Row>(
        `select id, tag, name, asset_type, make, model, serial from assets
         where deleted_at is null and user_id = $1 and ${ctx.resources.visibleWhere('asset', null)} order by name limit 100`, [req.user!.id]);
      return {
        available: true,
        rows: rows.map((r) => ({ ...r, asset_type_label: types.find((t) => t.value === r.asset_type)?.label ?? null })),
      };
    });
    ctx.describeRoute({ method: 'GET', path: '/api/portal/assets', permission: 'portal.view', summary: 'Equipment recorded as used by me' });

    // ---------- requests waiting for my approval ----------

    app.get('/api/portal/approvals', view, async (req) => {
      if (!ctx.can(req.user, 'tickets.approve')) return { rows: [] };
      // E03-22: a request's approval runs on its approval workflow; listed when its current step waits for me.
      const engine = approvalEngine(app);
      if (!engine) return { rows: [] };
      const ids = await engine.waiting('ticket_approval', req.user!.id);
      if (!ids.length) return { rows: [] };
      const rows = await db.query<Row>(
        `select t.id, t.ref, t.title, t.requester_name, t.requester_department, t.opened_at, t.catalog_answers, c.name as item_name
         from tickets t left join catalog_items c on c.id = t.catalog_item_id
         where t.id = any($2::uuid[]) and t.deleted_at is null and t.approval_status = 'pending' and coalesce(t.requester_id, t.created_by) is distinct from $1
           and ${ctx.resources.visibleWhere('ticket', req.user, 't')}
         order by t.opened_at limit 200`, [req.user!.id, ids]);
      const out: Row[] = [];
      for (const r of rows) {
        const p = await engine.progress('ticket_approval', r.id, req.user!.id);
        if (!p.canDecide) continue;
        out.push({
          ...r, approvals_needed: Math.max(1, p.required), approvals_given: p.approvals,
          catalog_answers: ((r.catalog_answers ?? []) as Row[]).map((a) => ({ label: a.label, value: a.value })),
        });
        if (out.length >= 100) break;
      }
      return { rows: out };
    });
    ctx.describeRoute({
      method: 'GET', path: '/api/portal/approvals', permission: 'portal.view',
      summary: 'Requests whose approval workflow waits for my decision now (as on the Approvals page; requests I have already decided are left out)',
      response: '{ rows: [{ id, ref, title, requester_name, item_name, catalog_answers, approvals_needed, approvals_given }] }',
    });

    registerRequests(ctx, access, files);

    // ---------- settings ----------

    app.get('/api/portal/settings', { preHandler: ctx.requirePerm('tickets.view') }, async (req) => ({
      ...(await readSettings(ctx)), enabled: await isEnabled(ctx), banner_tones: BANNER_TONES,
      can_switch: ctx.can(req.user, 'admin.administer'), can_edit: ctx.can(req.user, 'tickets.administer'),
    }));
    ctx.describeRoute({ method: 'GET', path: '/api/portal/settings', permission: 'tickets.view', summary: 'Portal settings' });

    app.put('/api/portal/settings', administer, async (req) => {
      await saveSettings(ctx, req, (req.body ?? {}) as Row);
      return { ...(await readSettings(ctx)), enabled: await isEnabled(ctx) };
    });
    ctx.describeRoute({
      method: 'PUT', path: '/api/portal/settings', permission: 'tickets.administer', summary: 'Change the portal settings',
      description: 'Changing `enabled` (the portal\'s feature switch) needs `admin.administer` and a recent identity confirmation (403 `reauth_required` otherwise), so an API token cannot do it.',
      body: '{ enabled? (administrators only), title?, intro?, reopen_days?, banner?: { message, tone } | null, on_behalf?: "nobody" | "department" | "anyone", safety_reports?: boolean }',
    });

    // Agents' public replies reach the requester, who follows them in the portal.
    tellRequester(ctx);
  },

  async seed(ctx, opts) {
    if (!ctx.resources.get('ticket')) return;
    return seedPortal(ctx, opts);
  },
};

/** Tells the requester when an agent writes them a public comment. */
function tellRequester(ctx: ModuleContext) {
  // Before the answer is sent (onSend), so whoever reads the requester's notifications next sees it.
  ctx.app.addHook('onSend', async (req, reply, payload) => {
    if (req.method !== 'POST' || reply.statusCode !== 201 || req.url.split('?')[0] !== '/api/comments' || !req.user) return payload;
    const b = (req.body ?? {}) as Row;
    if (b.record_type !== 'ticket' || b.internal !== false || !ctx.app.hasDecorator('notify') || !(await isEnabled(ctx))) return payload;
    try {
      const t = await ctx.db.one<Row>('select id, ref, title, requester_id from tickets where id::text = $1 and deleted_at is null', [String(b.record_id)]);
      if (!t?.requester_id || t.requester_id === req.user.id) return payload;
      await (ctx.app as unknown as { notify: (i: Row) => Promise<unknown> }).notify({
        userIds: [t.requester_id], kind: 'general', title: `New reply on your request ${t.ref}`,
        body: String(b.body ?? '').trim().slice(0, 300), route: `/portal/requests/${t.id}`,
      });
    } catch (err) {
      console.error('[portal] could not tell the requester:', err);
    }
    return payload;
  });
}

export default mod;
