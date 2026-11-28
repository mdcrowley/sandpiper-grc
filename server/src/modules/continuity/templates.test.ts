import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.ts';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';
import { seedContinuity } from './seed.ts';
import { PLAN_TEMPLATES } from './templates.ts';

// Wave 26: plan templates (invented, generic, jurisdiction-neutral), creating a plan from one, and the
// dev samples loading on a database where nobody has signed up yet.
let t: Awaited<ReturnType<typeof testApp>>;
let former = '';

beforeAll(async () => {
  t = await testApp();
  former = (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status) values ('tplclerk', 'tpl.clerk@example.test', 'Casey Planner', 'disabled') returning id`))!.id;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('plan templates', () => {
  it('are listed with their sections and starter checklist', async () => {
    const res = await t.api.get('/api/continuity/plan-templates');
    expect(res.status).toBe(200);
    const keys = (res.body as Row[]).map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['business_continuity', 'disaster_recovery']));
    const dr = (res.body as Row[]).find((x) => x.key === 'disaster_recovery')!;
    expect(dr).toMatchObject({ label: 'Disaster recovery plan', plan_type: 'it_disaster_recovery' });
    for (const heading of ['## Systems in scope', '## Recovery tiers', '## Backup and restore procedures', '## Failover steps', '## Testing']) expect(dr.body).toContain(heading);
    expect(dr.checklist[0]).toMatchObject({ phase: 'activate', item: expect.any(String), role: expect.any(String) });
    const bcp = PLAN_TEMPLATES.find((x) => x.key === 'business_continuity')!;
    for (const heading of ['## Roles and responsibilities', '## Communications and call tree', '## Alternate sites and resources', '## Return to normal', '## Plan maintenance and exercising']) expect(bcp.body).toContain(heading);
  });

  it('fill a new plan and its checklist, keeping what was given', async () => {
    const res = await t.api.post('/api/continuity-plans', { title: 'Invented depot continuity plan', template_key: 'business_continuity', scope: 'Depot North only.' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ plan_type: 'continuity', scope: 'Depot North only.', template_key: 'business_continuity', review_months: 12, status: 'draft' });
    expect(res.body.activation_criteria).toContain('tolerable downtime');
    expect(res.body.body).toContain('## Recovery priorities and objectives');
    const list = (await t.api.get(`/api/continuity-plans/${res.body.id}/checklist`)).body as Row[];
    expect(list).toHaveLength(PLAN_TEMPLATES[0].checklist.length);
    expect(list.map((i) => i.phase)).toContain('stand_down');
    // The template cannot be swapped afterward; the plan's own text can change freely.
    expect((await t.api.patch(`/api/continuity-plans/${res.body.id}`, { template_key: 'disaster_recovery' })).status).toBe(400);
    expect((await t.api.patch(`/api/continuity-plans/${res.body.id}`, { body: '## Purpose\nOur own words.' })).status).toBe(200);
    // A plan without a template starts blank, as before.
    const blank = await t.api.post('/api/continuity-plans', { title: 'Invented blank plan' });
    expect(blank.status).toBe(201);
    expect(blank.body.body ?? null).toBeNull();
    expect((await t.api.get(`/api/continuity-plans/${blank.body.id}/checklist`)).body).toHaveLength(0);
  });

  it('refuse an unknown template and a person without create permission', async () => {
    const bad = await t.api.post('/api/continuity-plans', { title: 'Invented plan', template_key: 'no_such_template' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.template_key).toMatch(/Choose a template/);
    const nobody = await t.as('requester');
    expect((await nobody.get('/api/continuity/plan-templates')).status).toBe(403);
    expect((await nobody.post('/api/continuity-plans', { title: 'Invented plan', template_key: 'disaster_recovery' })).status).toBe(403);
  });

  it('in a data load, the checklist is recorded as created by the person named', async () => {
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const res = await t.api.post('/api/continuity-plans', {
      title: 'Invented 2021 recovery plan', template_key: 'disaster_recovery', on_behalf_of: 'tplclerk', created_at: '2021-03-01T09:00:00Z',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const items = await t.db.query<Row>('select created_by from continuity_checklist_items where plan_id = $1', [res.body.id]);
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) expect(i.created_by).toBe(former);
    expect((await t.api.post('/api/admin/data-load', { on: false })).status).toBe(200);
  });
});

describe('dev samples before the first account', () => {
  it('load on an empty database and leave setup open', async () => {
    const built = await buildApp({ dataDir: 'memory', serveWeb: false });
    try {
      expect(await built.db.one('select 1 from users where password_hash is not null')).toBeUndefined();
      expect(await seedContinuity(built.ctx, { profile: 'dev', seedDir: 'none', organization: {} })).toMatch(/^10 sample business processes/);
      expect((await built.db.query('select 1 from continuity_plans where title like $1', ['[Sample] %'])).length).toBe(3);
      const state = await built.app.inject({ method: 'GET', url: '/api/auth/state' });
      expect(state.json().setupRequired).toBe(true);
    } finally {
      await built.close();
    }
  }, 120_000);
});
