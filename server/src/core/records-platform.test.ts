import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from './module.ts';
import { EVIDENCE_TYPES } from './resource.ts';
import { ensureCommentSearch, SEARCH_CONFIG } from './search.ts';
import { cleanView } from './views.ts';
import { testApp } from '../test/helpers.ts';

// Records platform, wave 4: shared list views (E01-24), the evidence flag in metadata (E14-18),
// retention review lists under row-level restriction (E14-20) and the comments search language
// (E14-21). Exercised through a throwaway module with invented data.

const widgets: ModuleDef = {
  key: 'testwidgets',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists test_widgets (
        id uuid primary key default gen_random_uuid(), name text not null, owner_id uuid,
        restricted boolean not null default false,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists test_proofs (
        id uuid primary key default gen_random_uuid(), title text not null,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'widget', table: 'test_widgets', module: 'tickets', label: 'Widget', plural: 'Widgets',
      path: '/api/widgets', route: '/widgets', titleField: 'name', restricted: 'flag',
      fields: {
        name: { label: 'Name', type: 'text', required: true },
        owner_id: { label: 'Owner', type: 'user' },
        restricted: { label: 'Restricted', type: 'boolean', default: false },
      },
    });
    ctx.defineResource({
      type: 'proof', table: 'test_proofs', module: 'tickets', label: 'Proof', plural: 'Proofs',
      path: '/api/proofs', route: '/proofs', titleField: 'title', evidence: true,
      fields: { title: { label: 'Title', type: 'text', required: true } },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
let agent: Awaited<ReturnType<typeof t.as>>;
let colleague: Awaited<ReturnType<typeof t.as>>;
let outsider: Awaited<ReturnType<typeof t.as>>;
const audited = async (action: string) => t.db.query<any>('select * from audit_events where action = $1 order by id', [action]);

beforeAll(async () => {
  t = await testApp({ extraModules: [widgets] });
  agent = await t.as('agent');          // tickets.* but not security.view
  colleague = await t.as('agent');
  outsider = await t.as('requester');   // cannot view tickets
});
afterAll(async () => { await t.app.close(); });

describe('shared list views (E01-24)', () => {
  it('cleans a view down to search, filters and sort, dropping labels', () => {
    expect(cleanView({ q: '  printer ', sort: 'name', dir: 'desc', filters: { status: ['open', ''], 'due_at.lt': '2026-12-01' }, labels: { owner_id: 'Secret name' } }))
      .toEqual({ q: 'printer', sort: 'name', dir: 'desc', filters: { status: ['open'], 'due_at.lt': ['2026-12-01'] } });
    expect(() => cleanView({ filters: { 'x; drop': ['a'] } })).toThrow();
    expect(() => cleanView({ sort: 'name desc' })).toThrow();
    expect(() => cleanView([])).toThrow();
  });

  it('shares a view with everyone who can see the list, audited, without labels', async () => {
    const made = await agent.post('/api/views', {
      record_type: 'widget', name: '  Mine   open ', view: { q: 'pump', sort: 'name', dir: 'asc', filters: { owner_id: [agent.userId] }, labels: { owner_id: 'Somebody' } },
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: 'Mine open', recordType: 'widget', mine: true, canManage: true, view: { q: 'pump', filters: { owner_id: [agent.userId] } } });
    expect(made.body.view.labels).toBeUndefined();
    expect((await audited('view.share')).at(-1)).toMatchObject({ record_type: 'shared_view', record_id: made.body.id });

    const seen = (await colleague.get('/api/views?record_type=widget')).body.views;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ name: 'Mine open', mine: false, canManage: false, createdBy: { id: agent.userId } });

    // Names are unique on a list, whatever their case.
    const again = await colleague.post('/api/views', { record_type: 'widget', name: 'MINE OPEN', view: { q: '' } });
    expect(again.status).toBe(409);
    expect(again.body.error.fields.name).toBeTruthy();
    expect((await colleague.post('/api/views', { record_type: 'widget', name: '', view: {} })).body.error.fields.name).toBeTruthy();
  });

  it('lets only the author or an administrator change or remove a shared view', async () => {
    const [view] = (await agent.get('/api/views?record_type=widget')).body.views;
    expect((await colleague.patch(`/api/views/${view.id}`, { name: 'Taken over' })).status).toBe(403);
    expect((await colleague.del(`/api/views/${view.id}`)).status).toBe(403);
    const renamed = await agent.patch(`/api/views/${view.id}`, { name: 'Pumps I own' });
    expect(renamed.body.name).toBe('Pumps I own');
    expect((await audited('view.update')).at(-1).summary).toMatch(/Pumps I own/);
    const other = (await colleague.post('/api/views', { record_type: 'widget', name: 'Everything', view: { q: '' } })).body;
    expect((await agent.patch(`/api/views/${view.id}`, { name: 'everything' })).status).toBe(409);
    expect((await t.api.get('/api/views?record_type=widget')).body.views.every((v: any) => v.canManage)).toBe(true);
    expect((await t.api.del(`/api/views/${other.id}`)).status).toBe(200);
    expect((await audited('view.unshare')).at(-1).summary).toMatch(/Everything/);
  });

  it('answers 404 for a list the caller may not see', async () => {
    const [view] = (await agent.get('/api/views?record_type=widget')).body.views;
    expect((await outsider.get('/api/views?record_type=widget')).status).toBe(404);
    expect((await outsider.post('/api/views', { record_type: 'widget', name: 'Nope', view: {} })).status).toBe(404);
    expect((await outsider.del(`/api/views/${view.id}`)).status).toBe(404);
    expect((await agent.get('/api/views?record_type=no_such_type')).status).toBe(404);
  });
});

describe('evidence files in metadata (E14-18)', () => {
  it('marks evidence-bearing record types', async () => {
    const meta = (await t.api.get('/api/meta')).body.resources;
    expect(meta.proof.evidence).toBe(true);
    expect(meta.widget.evidence).toBe(false);
    for (const type of ['evidence_item', 'framework_outcome', 'policy', 'exercise', 'risk']) expect(EVIDENCE_TYPES.has(type)).toBe(true);
    if (meta.ticket) expect(meta.ticket.evidence).toBe(false);
  });
});

describe('retention reviews under row-level restriction (E14-20)', () => {
  it('lists only the rows a reviewer may see, while the pending counts are the same for everyone', async () => {
    // An administrator role without security.view.
    const role = await t.db.one<{ id: string }>(`insert into roles (key, name) values ('test_admin_nosec', 'Administrator without security') returning id`);
    for (const p of ['admin.administer', 'tickets.view']) await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [role!.id, p]);
    const reviewer = await t.as('test_admin_nosec');

    const open = (await t.api.post('/api/widgets', { name: 'Old open widget' })).body.id;
    const secret = (await t.api.post('/api/widgets', { name: 'Old restricted widget', restricted: true })).body.id;
    await t.db.query(`update test_widgets set updated_at = now() - interval '40 months' where id = any($1::uuid[])`, [[open, secret]]);
    expect((await t.api.put('/api/admin/retention/widget', { periodMonths: 24 })).status).toBe(200);
    await t.core.retention.sweep();

    const all = (await t.api.get('/api/admin/retention/reviews?record_type=widget')).body;
    expect(all.rows.map((r: any) => r.record_id).sort()).toEqual([open, secret].sort());
    const mine = (await reviewer.get('/api/admin/retention/reviews?record_type=widget')).body;
    expect(mine.total).toBe(1);
    expect(mine.rows.map((r: any) => r.record_id)).toEqual([open]);
    // A decision on the hidden row is refused like a missing review.
    const hidden = all.rows.find((r: any) => r.record_id === secret);
    expect((await reviewer.post(`/api/admin/retention/reviews/${hidden.id}/extend`, { reason: 'Keep it a while', months: 6 })).status).toBe(404);
    const visible = all.rows.find((r: any) => r.record_id === open);
    expect((await reviewer.post(`/api/admin/retention/reviews/${visible.id}/extend`, { reason: 'Keep it a while', months: 6 })).status).toBe(200);

    const count = async (api: typeof t.api) => (await api.get('/api/admin/retention')).body.types.find((x: any) => x.type === 'widget').pendingReviews;
    expect(await count(reviewer)).toBe(await count(t.api));
  });
});

describe('comment search language (E14-21)', () => {
  it('rebuilds the comments trigger in the configured language, once', async () => {
    const widget = (await t.api.post('/api/widgets', { name: 'Ticket machine' })).body.id;
    await t.api.post('/api/comments', { record_type: 'widget', record_id: widget, body: 'Les maisons sont fermées' });
    const matches = async (config: string, word: string) =>
      (await t.db.one<{ n: number }>(`select count(*)::int n from comments where record_id = $1 and search_vector @@ to_tsquery('${config}', $2)`, [widget, word]))!.n;

    expect(await ensureCommentSearch(t.db, 'french')).toBe(true);
    expect(await matches('french', 'maison')).toBe(1); // stemmed in French: "maisons" -> "maison"
    const state = await t.db.one<{ built_at: string }>(`select built_at from search_index_state where table_name = '__comments'`);
    expect(await ensureCommentSearch(t.db, 'french')).toBe(true);
    expect((await t.db.one<{ built_at: string }>(`select built_at from search_index_state where table_name = '__comments'`))!.built_at).toEqual(state!.built_at);
    // New comments follow it too.
    await t.api.post('/api/comments', { record_type: 'widget', record_id: widget, body: 'Deux voitures' });
    expect(await matches('french', 'voitur')).toBe(1);

    expect(await ensureCommentSearch(t.db, 'no such language')).toBe(false);
    expect(await ensureCommentSearch(t.db, SEARCH_CONFIG)).toBe(true);
  });
});
