import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ROLES, defaultGrantDifferences } from '../../core/services.ts';
import { testApp } from '../../test/helpers.ts';
import { chooseHome, parseHome } from './home.ts';

// Wave 26: where people land by role (E44-09), the waiting count on My work, "Report a problem" for
// everyone, and default roles that do their job. Invented people and records only.

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let nobody: Client;
const before = process.env.GRC_MODULES;

const SAFETY = {
  title: 'Invented loose handrail on platform 2', description: 'The handrail moves when leaned on.', event_type: 'slip_trip_fall',
  harm: 'none', occurred_at: '2026-11-20T09:00:00Z', where: 'Invented Central station',
};
const HELP = { title: 'Invented depot printer will not print', details: 'Paper jam light stays on.', affects: 'team', how_urgent: 'slowed' };

beforeAll(async () => {
  process.env.GRC_MODULES = 'work,safety,tickets,portal,workflows,notifications,admin,inventory,fleet,training,people,continuity,audits,condition,reports,risks,attachments,policies,projects,funding';
  t = await testApp();
  // A person with no role at all: a role with no grants stands in for "no role" in the client helper, so
  // the person is then taken out of it.
  await t.db.query(`insert into roles (key, name, description, enabled) values ('test_nothing', 'Invented nothing', '', true)`);
  nobody = await t.as('test_nothing');
  await t.db.query('delete from user_roles where user_id = $1', [nobody.userId]);
}, 120_000);
afterAll(async () => {
  await t?.close();
  process.env.GRC_MODULES = before;
});

describe('where people land (E44-09)', () => {
  it('chooses by role: My work first, then a dashboard, the Overview and the portal', () => {
    expect(parseHome('mywork')).toEqual({ kind: 'mywork' });
    expect(parseHome('dashboard:nope')).toBeNull();
    expect(chooseHome([], {})).toBe('mywork');
    expect(chooseHome(['agent'], {})).toBe('overview');
    expect(chooseHome(['requester'], {})).toBe('portal');
    expect(chooseHome(['requester', 'agent'], { agent: 'overview' })).toBe('overview');
    expect(chooseHome(['a', 'b'], { a: 'overview', b: 'mywork' })).toBe('mywork');
  });

  it('sends people with no role to My work, administrators to the Overview, and follows the administrator\'s choice', async () => {
    expect((await nobody.get('/api/work/home')).body).toMatchObject({ home: 'mywork', route: '/my-work' });
    expect((await t.api.get('/api/work/home')).body).toMatchObject({ home: 'overview', route: '/' });

    const safety = await t.as('safety_manager');
    expect((await safety.put('/api/work/role-homes', { homes: { safety_manager: 'mywork' } })).status).toBe(403);
    const bad = await t.api.put('/api/work/role-homes', { homes: { safety_manager: 'somewhere', not_a_role: 'mywork' } });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['not_a_role', 'safety_manager']);

    const board = await t.db.one<{ id: string }>(`insert into dashboards (key, name, widgets, filters, layout, sharing) values ('test_home', 'Invented home board', '[]', '[]', '{}', 'everyone') returning id`);
    const saved = await t.api.put('/api/work/role-homes', { homes: { safety_manager: `dashboard:${board!.id}`, _none: 'overview' } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await safety.get('/api/work/home')).body).toMatchObject({ home: 'dashboard', route: `/dashboards/${board!.id}`, dashboard: { name: 'Invented home board' } });
    expect((await nobody.get('/api/work/home')).body.home).toBe('overview');
    const audit = await t.db.one<{ n: number }>(`select count(*)::int as n from audit_events where action = 'setting.change' and summary like '%home.role_homes%'`);
    expect(audit!.n).toBeGreaterThan(0);

    // A choice that cannot be used falls back to the Overview: the portal while it is off.
    await t.api.put('/api/work/role-homes', { homes: { safety_manager: 'portal', _none: null } });
    expect((await safety.get('/api/work/home')).body.home).toBe('overview');
    expect((await nobody.get('/api/work/home')).body.home).toBe('mywork');
    await t.api.put('/api/work/role-homes', { homes: { safety_manager: null } });
  });
});

describe('the waiting count on My work', () => {
  it('adds up My work\'s lists, the same way the page counts them', async () => {
    const admin = await t.db.one<{ id: string }>(`select id from users where username = 'admin'`);
    await t.db.query(`insert into actions (ref, title, status, owner_id) values ('ACT-9301', 'Invented fence check', 'open', $1)`, [admin!.id]);
    const res = await t.api.get('/api/work/waiting');
    expect(res.status).toBe(200);
    expect(res.body.parts['my-actions']).toBeGreaterThanOrEqual(1);
    expect(res.body.count).toBe(Object.values(res.body.parts as Record<string, number>).reduce((a, b) => a + b, 0));
    // Someone with no role has no tickets or actions list, but still has their own approvals, training and documents.
    const mine = (await nobody.get('/api/work/waiting')).body;
    expect(mine.parts['my-actions']).toBeUndefined();
    expect(mine.parts['my-tickets']).toBeUndefined();
    expect(mine.count).toBe(0);
  });
});

describe('Report a problem, for everyone', () => {
  it('lets a person with no role report a safety hazard and ask for help, with the portal off', async () => {
    const options = (await nobody.get('/api/work/report/options')).body;
    expect(options.safety.types.map((o: any) => o.value)).toContain('slip_trip_fall');
    expect(options.help.affects.map((o: any) => o.value)).toEqual(['me', 'team', 'service']);

    const bad = await nobody.post('/api/work/report/safety', { title: '' });
    expect(bad.status).toBe(400);
    const made = await nobody.post('/api/work/report/safety', SAFETY);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const event = (await t.api.get(`/api/safety-events/${made.body.id}`)).body;
    expect(event).toMatchObject({ status: 'reported', reported_by_id: nobody.userId, confidential_reporter: false });
    expect(event.notes).toContain('My work');
    // The reporter still cannot open the safety screens.
    expect((await nobody.get(`/api/safety-events/${made.body.id}`)).status).toBe(403);

    const help = await nobody.post('/api/work/report/help', HELP);
    expect(help.status, JSON.stringify(help.body)).toBe(201);
    const ticket = (await t.api.get(`/api/tickets/${help.body.id}`)).body;
    expect(ticket).toMatchObject({ requester_id: nobody.userId, title: HELP.title, type: 'incident' });

    const mine = (await nobody.get('/api/work/report/mine')).body;
    expect(mine.safety.map((r: any) => r.ref)).toContain(made.body.ref);
    expect(mine.help.map((r: any) => r.ref)).toContain(help.body.ref);
  });

  it('keeps a confidential reporter apart from the event, as the portal does', async () => {
    const made = await nobody.post('/api/work/report/safety', { ...SAFETY, title: 'Invented near miss in the yard', confidential: true });
    expect(made.status).toBe(201);
    const event = (await t.api.get(`/api/safety-events/${made.body.id}`)).body;
    expect(event.reported_by_id).toBeNull();
    expect(event.created_by ?? null).toBeNull();
    expect(event.notes).not.toContain('Test test_nothing');
    const kept = await t.db.one<{ user_id: string }>('select user_id from safety_confidential_reporters where event_id = $1', [made.body.id]);
    expect(kept!.user_id).toBe(nobody.userId);
    // The reporter follows it in My reports.
    expect((await nobody.get('/api/work/report/mine')).body.safety.find((r: any) => r.ref === made.body.ref).confidential).toBe(true);
  });

  it('offers only the kinds whose area is on', async () => {
    expect((await t.api.patch('/api/admin/features', { features: { safety: false } })).status).toBe(200);
    try {
      expect((await nobody.get('/api/work/report/options')).body.safety).toBeNull();
      expect((await nobody.post('/api/work/report/safety', SAFETY)).status).toBe(404);
      expect((await nobody.get('/api/work/report/mine')).body.safety).toBeNull();
    } finally {
      await t.api.patch('/api/admin/features', { features: { safety: true } });
    }
  });
});

describe('default roles that do their job (wave 26)', () => {
  it('lets the continuity manager plan exercises, the asset manager open inspections and the safety manager record certifications and activations', async () => {
    const continuity = await t.as('continuity_manager');
    expect((await continuity.post('/api/exercises', {})).status).not.toBe(403);
    const assets = await t.as('asset_manager');
    expect((await assets.get('/api/inspections')).status).toBe(200);
    expect((await assets.post('/api/inspections', {})).status).not.toBe(403);
    const safety = await t.as('safety_manager');
    expect((await safety.post('/api/certifications', {})).status).not.toBe(403);
    expect((await safety.post('/api/emergency-activations', {})).status).not.toBe(403);
  });

  it('gives the executive viewer the register-level figures of safety, fleet, condition, continuity, risks, funding and projects, read only', async () => {
    const exec = await t.as('executive_viewer');
    for (const path of ['/api/safety/summary', '/api/vehicles/stats?group=status', '/api/condition/summary', '/api/continuity/summary', '/api/projects', '/api/funding-awards', '/api/inspections']) {
      expect((await exec.get(path)).status, path).toBe(200);
    }
    expect((await exec.post('/api/safety-events', {})).status).toBe(403);
    expect((await nobody.get('/api/safety/summary')).status).toBe(403);
    const def = DEFAULT_ROLES.find((r) => r.key === 'executive_viewer')!;
    expect(def.enabled).toBe(false);
    expect(def.describe!((a) => a !== 'safety')).not.toMatch(/safety/);
  });

  it('offers the new default permissions to an existing installation, once', async () => {
    const role = await t.db.one<{ id: string }>(`select id from roles where key = 'continuity_manager'`);
    await t.db.query(`delete from role_permissions where role_id = $1 and permission = 'exercises.*'`, [role!.id]);
    await t.db.query(`delete from role_default_grants where role_key = 'continuity_manager' and permission = 'exercises.*'`);
    const diff = (await defaultGrantDifferences(t.db)).find((d) => d.key === 'continuity_manager')!;
    expect(diff.missing).toContain('exercises.*');
    expect((await t.api.post('/api/admin/roles/sync-default-grants', {})).status).toBe(200);
    expect((await defaultGrantDifferences(t.db)).find((d) => d.key === 'continuity_manager')!.missing).toEqual([]);
  });
});
