import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// An invented two-function framework. Nothing here comes from seed/.
let t: Awaited<ReturnType<typeof testApp>>;
let fw: string;
const ids: Record<string, string> = {};

beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const outcome = (code: string, extra: Record<string, unknown> = {}) =>
  t.api.post('/api/framework-outcomes', { framework_id: fw, code, official_text: `Official wording for ${code}`, ...extra });

describe('frameworks and outcomes', () => {
  it('creates a framework with functions and categories', async () => {
    const made = await t.api.post('/api/frameworks', { key: 'tiny', name: 'Tiny Framework', version: '1.0' });
    expect(made.status).toBe(201);
    fw = made.body.id;
    expect((await t.api.post('/api/frameworks', { key: 'TINY', name: 'Again' })).body.error.fields.key).toBeTruthy();

    const bad = await t.api.post(`/api/frameworks/${fw}/structure`, { functions: [{ code: 'AA' }] });
    expect(bad.status).toBe(400);
    const saved = await t.api.post(`/api/frameworks/${fw}/structure`, {
      functions: [
        { code: 'AA', name: 'Plan', color: 'purple', categories: [{ code: 'AA.XX', name: 'Basics' }, { code: 'AA.YY', name: 'People' }] },
        { code: 'BB', name: 'Do', color: 'teal', categories: [{ code: 'BB.ZZ', name: 'Doing' }] },
      ],
    });
    expect(saved.body).toMatchObject({ ok: true, functions: 2, categories: 3 });
    const shape = await t.api.get(`/api/frameworks/${fw}/structure`);
    expect(shape.body.functions.map((f: any) => [f.code, f.categories.length])).toEqual([['AA', 2], ['BB', 1]]);
  });

  it('creates outcomes whose reference is their own code', async () => {
    const a = await outcome('AA.XX-01', { priority: true, description: 'We know what matters most' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({
      code: 'AA.XX-01', function_code: 'AA', category_code: 'AA.XX', status: 'not_evidenced', priority: true,
      title: 'We know what matters most',
    });
    expect(a.body._display.status).toBe('Not evidenced');
    ids['AA.XX-01'] = a.body.id;
    for (const [code, extra] of [
      ['AA.XX-02', { priority: true }], ['AA.YY-01', {}], ['BB.ZZ-01', { priority: true, phase: 'now' }],
    ] as const) {
      const res = await outcome(code, extra);
      expect(res.status).toBe(201);
      ids[code] = res.body.id;
    }
    expect((await t.api.get(`/api/framework-outcomes/${ids['AA.XX-02']}`)).body.title).toBe('Official wording for AA.XX-02');
    expect((await outcome('AA.XX-01')).body.error.fields.code).toMatch(/already/);
    expect((await t.api.post('/api/framework-outcomes', { framework_id: fw })).body.error.fields.code).toBeTruthy();
    expect((await outcome('AA.XX-09', { status: 'excellent' })).body.error.fields.status).toBeTruthy();
  });

  it('updates, audits and soft-deletes', async () => {
    const id = ids['AA.YY-01'];
    const res = await t.api.patch(`/api/framework-outcomes/${id}`, { status: 'partial', description: 'People know their part' });
    expect(res.body.status).toBe('partial');
    expect(res.body.title).toBe('People know their part');
    const history = await t.api.get(`/api/history?record_type=framework_outcome&record_id=${id}`);
    expect(history.body.map((h: any) => h.action)).toEqual(['framework_outcome.update', 'framework_outcome.create']);
    expect(history.body[0].before.status).toBe('not_evidenced');
    expect(history.body[0].after.status).toBe('partial');
    await t.api.patch(`/api/framework-outcomes/${id}`, { status: 'not_evidenced' });

    const doomed = await outcome('BB.ZZ-09');
    expect((await t.api.del(`/api/framework-outcomes/${doomed.body.id}`)).status).toBe(200);
    expect((await t.api.get(`/api/framework-outcomes/${doomed.body.id}`)).status).toBe(404);
    expect((await outcome('BB.ZZ-09')).status).toBe(201); // the code is free again
    await t.api.del(`/api/framework-outcomes/${(await t.api.get('/api/framework-outcomes?q=BB.ZZ-09')).body.rows[0].id}`);
    expect((await t.api.get('/api/framework-outcomes?f.priority=true')).body.total).toBe(3);
    expect((await t.api.get('/api/framework-outcomes?format=csv')).text).toContain('AA.XX-01');
    expect((await t.api.get('/api/search?q=matters most')).body[0]).toMatchObject({ type: 'framework_outcome', ref: 'AA.XX-01' });
  });

  it('respects permissions', async () => {
    const agent = await t.as('agent'); // frameworks.view only
    expect((await agent.get('/api/framework-outcomes')).status).toBe(200);
    expect((await agent.get(`/api/frameworks/${fw}/board`)).status).toBe(200);
    expect((await agent.patch(`/api/framework-outcomes/${ids['AA.XX-01']}`, { status: 'met' })).status).toBe(403);
    expect((await agent.post(`/api/framework-outcomes/${ids['AA.XX-01']}/evidence`, { title: 'x' })).status).toBe(403);
    expect((await agent.post('/api/assessments', { name: 'x' })).status).toBe(403);
    const pm = await t.as('project_manager'); // no frameworks access at all
    expect((await pm.get(`/api/frameworks/${fw}/board`)).status).toBe(403);
    expect((await pm.get(`/api/frameworks/${fw}/progress`)).status).toBe(403);
    expect((await t.anon.get(`/api/frameworks/${fw}/board`)).status).toBe(401);
  });
});

describe('board', () => {
  it('groups outcomes by function then category with counts by status', async () => {
    const owner = await t.as('security_lead');
    await owner.patch(`/api/framework-outcomes/${ids['BB.ZZ-01']}`, { owner_id: owner.userId, status: 'largely_met' });
    const res = await t.api.get(`/api/frameworks/${fw}/board`);
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.framework).toMatchObject({ key: 'tiny', name: 'Tiny Framework' });
    expect(b.statuses.map((s: any) => s.value)).toEqual(['not_evidenced', 'partial', 'largely_met', 'met']);
    expect(b.statuses.map((s: any) => s.weight)).toEqual([0, 0.33, 0.67, 1]);
    expect(b.target).toMatchObject({ status: 'largely_met', score: 67 });
    expect(b.functions.map((f: any) => f.code)).toEqual(['AA', 'BB']);
    const [aa, bb] = b.functions;
    expect(aa).toMatchObject({ name: 'Plan', color: 'purple' });
    expect(aa.all).toMatchObject({ total: 3, counts: { not_evidenced: 3, partial: 0, largely_met: 0, met: 0 }, score: 0 });
    expect(aa.priority.total).toBe(2);
    expect(aa.categories.map((c: any) => [c.code, c.name, c.outcomes.length])).toEqual([['AA.XX', 'Basics', 2], ['AA.YY', 'People', 1]]);
    expect(bb.all.counts.largely_met).toBe(1);
    expect(bb.categories[0].outcomes[0]).toMatchObject({
      code: 'BB.ZZ-01', status: 'largely_met', priority: true, phase: 'now', owner_id: owner.userId,
    });
    expect(bb.categories[0].outcomes[0].owner_name).toMatch(/security_lead/);
    expect(b.summary.all).toMatchObject({ total: 4, atTarget: 1, atTargetPct: 25 });
    expect(b.summary.priority).toMatchObject({ total: 3, atTarget: 1, atTargetPct: 33 });
    expect((await t.api.get('/api/frameworks/00000000-0000-4000-8000-000000000000/board')).status).toBe(404);
    await t.api.patch(`/api/framework-outcomes/${ids['BB.ZZ-01']}`, { status: 'not_evidenced' });
  });
});

describe('evidence and cross-mappings', () => {
  it('adds, lists and removes evidence with expiry state, audited on the outcome', async () => {
    const id = ids['AA.XX-01'];
    const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    expect((await t.api.post(`/api/framework-outcomes/${id}/evidence`, { collected_on: 'yesterday' })).body.error.fields)
      .toMatchObject({ title: expect.any(String), collected_on: expect.any(String) });
    const a = await t.api.post(`/api/framework-outcomes/${id}/evidence`, {
      title: 'Signed statement', description: 'Approved at the spring meeting', location: 'Shared drive / Governance', collected_on: '2020-01-01', expires_on: '2020-12-31',
    });
    expect(a.status).toBe(201);
    await t.api.post(`/api/framework-outcomes/${id}/evidence`, { title: 'Expiring soon', expires_on: soon });
    await t.api.post(`/api/framework-outcomes/${id}/evidence`, { title: 'No expiry' });
    const list = await t.api.get(`/api/framework-outcomes/${id}/evidence`);
    expect(Object.fromEntries(list.body.map((e: any) => [e.title, e.state]))).toEqual({
      'Signed statement': 'expired', 'Expiring soon': 'expiring', 'No expiry': 'current',
    });
    expect(list.body.find((e: any) => e.title === 'Signed statement')).toMatchObject({ location: 'Shared drive / Governance', collected_on: '2020-01-01' });
    expect((await t.api.del(`/api/framework-outcomes/${ids['AA.XX-02']}/evidence/${a.body.id}`)).status).toBe(404);
    expect((await t.api.del(`/api/framework-outcomes/${id}/evidence/${a.body.id}`)).status).toBe(200);
    expect((await t.api.get(`/api/framework-outcomes/${id}/evidence`)).body.length).toBe(2);
    const actions = (await t.api.get(`/api/history?record_type=framework_outcome&record_id=${id}`)).body.map((h: any) => h.action);
    expect(actions.filter((x: string) => x === 'framework_outcome.evidence_add').length).toBe(3);
    expect(actions[0]).toBe('framework_outcome.evidence_remove');
  });

  it('maps one outcome to several other frameworks without duplicates', async () => {
    const id = ids['AA.XX-01'];
    expect((await t.api.post(`/api/framework-outcomes/${id}/mappings`, { reference: '1.2' })).status).toBe(400);
    const a = await t.api.post(`/api/framework-outcomes/${id}/mappings`, { framework_name: 'PCI DSS', reference: '12.1' });
    expect(a.status).toBe(201);
    await t.api.post(`/api/framework-outcomes/${id}/mappings`, { framework_name: 'Harbour Privacy Rule', reference: '164.308' });
    await t.api.post(`/api/framework-outcomes/${id}/mappings`, { framework_name: 'Insurer conditions' });
    expect((await t.api.post(`/api/framework-outcomes/${id}/mappings`, { framework_name: 'pci dss', reference: '12.1' })).status).toBe(400);
    const list = await t.api.get(`/api/framework-outcomes/${id}/mappings`);
    expect(list.body.map((m: any) => m.framework_name)).toEqual(['Harbour Privacy Rule', 'Insurer conditions', 'PCI DSS']);
    expect((await t.api.get('/api/framework-mappings/names')).body).toContain('PCI DSS');
    expect((await t.api.del(`/api/framework-outcomes/${id}/mappings/${a.body.id}`)).status).toBe(200);
    expect((await t.api.get(`/api/framework-outcomes/${id}/mappings`)).body.length).toBe(2);
    const history = (await t.api.get(`/api/history?record_type=framework_outcome&record_id=${id}`)).body;
    expect(history[0]).toMatchObject({ action: 'framework_outcome.mapping_remove', before: { framework_name: 'PCI DSS', reference: '12.1' } });
  });

  it('gives an outcome its place in the framework', async () => {
    const res = await t.api.get(`/api/framework-outcomes/${ids['AA.YY-01']}/context`);
    expect(res.body).toMatchObject({ framework: { key: 'tiny' }, function: { code: 'AA', name: 'Plan' }, category: { code: 'AA.YY', name: 'People' } });
  });
});

describe('assessments', () => {
  let first: string;
  let second: string;

  it('takes a snapshot of every outcome status', async () => {
    expect((await t.api.post('/api/assessments', { date: '2025-01-10' })).body.error.fields.name).toBeTruthy();
    const res = await t.api.post('/api/assessments', { name: 'Winter', date: '2025-01-10', notes: 'Starting point' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Winter', taken_on: '2025-01-10', framework_id: fw });
    expect(res.body.all).toMatchObject({ total: 4, counts: { not_evidenced: 4 }, score: 0 });
    first = res.body.id;
    const got = await t.api.get(`/api/assessments/${first}`);
    expect(got.body.outcomes.map((o: any) => o.code)).toEqual(['AA.XX-01', 'AA.XX-02', 'AA.YY-01', 'BB.ZZ-01']);
    expect(got.body.functions.map((f: any) => [f.code, f.total])).toEqual([['AA', 3], ['BB', 1]]);
    expect(got.body.framework_name).toBe('Tiny Framework');
    const audit = await t.api.get(`/api/history?record_type=assessment_snapshot&record_id=${first}`);
    expect(audit.body.map((e: any) => e.action).sort()).toEqual(['assessment_snapshot.capture', 'assessment_snapshot.create']);
    expect(audit.body.find((e: any) => e.action === 'assessment_snapshot.capture').summary).toMatch(/4 outcome/);
  });

  it('refuses a snapshot date that is not a real day, is in the future or is absurdly old', async () => {
    const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    for (const date of ['2025-02-30', 'not-a-date', tomorrow, '2031-01-10', '1899-12-31']) {
      const res = await t.api.post('/api/assessments', { name: 'Bad date', date });
      expect(res.status, date).toBe(400);
      expect(res.body.error.fields.taken_on, date).toBeTruthy();
    }
    expect((await t.api.patch(`/api/assessment-snapshots/${first}`, { taken_on: tomorrow })).status).toBe(400);
    expect((await t.api.get('/api/assessment-snapshots')).body.total).toBe(1);
    // With no date given, the snapshot is dated today in the organisation's time zone.
    const today = await t.api.post('/api/assessments', { name: 'Undated' });
    expect(today.body.taken_on).toBe(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()));
    expect((await t.api.del(`/api/assessment-snapshots/${today.body.id}`)).status).toBe(200);
  });

  it('shows change over time between two snapshots', async () => {
    await t.api.patch(`/api/framework-outcomes/${ids['AA.XX-01']}`, { status: 'largely_met' });
    await t.api.patch(`/api/framework-outcomes/${ids['BB.ZZ-01']}`, { status: 'partial' });
    second = (await t.api.post('/api/assessments', { name: 'Spring', date: '2025-04-10', framework_id: fw })).body.id;
    // A later change must not leak into either snapshot.
    await t.api.patch(`/api/framework-outcomes/${ids['AA.YY-01']}`, { status: 'met' });

    const cmp = await t.api.get(`/api/assessments/compare?from=${first}&to=${second}`);
    expect(cmp.status).toBe(200);
    expect(cmp.body.from).toMatchObject({ name: 'Winter', date: '2025-01-10' });
    expect(cmp.body.to).toMatchObject({ name: 'Spring', date: '2025-04-10' });
    expect(cmp.body.overall.from.all.counts).toEqual({ not_evidenced: 4, partial: 0, largely_met: 0, met: 0 });
    expect(cmp.body.overall.to.all.counts).toEqual({ not_evidenced: 2, partial: 1, largely_met: 1, met: 0 });
    expect(cmp.body.overall.to.all.score).toBe(25);
    expect(cmp.body.overall.to.priority).toMatchObject({ total: 3, atTarget: 1 });
    const aa = cmp.body.functions.find((f: any) => f.code === 'AA');
    expect(aa.from.counts.not_evidenced).toBe(3);
    expect(aa.to.counts).toMatchObject({ not_evidenced: 2, largely_met: 1 });
    expect(cmp.body.changed.map((c: any) => [c.code, c.from, c.to, c.direction])).toEqual([
      ['AA.XX-01', 'not_evidenced', 'largely_met', 'improved'],
      ['BB.ZZ-01', 'not_evidenced', 'partial', 'improved'],
    ]);

    const back = await t.api.get(`/api/assessments/compare?from=${second}&to=${first}`);
    expect(back.body.changed.every((c: any) => c.direction === 'declined')).toBe(true);
    const now = await t.api.get(`/api/assessments/compare?from=${second}&to=now`);
    expect(now.body.to.id).toBeNull();
    expect(now.body.changed.map((c: any) => c.code)).toEqual(['AA.YY-01']);
    expect((await t.api.get('/api/assessments/compare?from=nonsense')).status).toBe(404);
  });

  it('charts progress across snapshots and now, for priority and all outcomes', async () => {
    const res = await t.api.get(`/api/frameworks/${fw}/progress`);
    expect(res.status).toBe(200);
    expect(res.body.target).toMatchObject({ status: 'largely_met', score: 67 });
    expect(res.body.series.map((p: any) => [p.name, p.current])).toEqual([['Winter', false], ['Spring', false], ['Now', true]]);
    expect(res.body.series.map((p: any) => p.all.score)).toEqual([0, 25, 50]);
    // Priority outcomes: AA.XX-01 largely met (0.67), BB.ZZ-01 partial (0.33), AA.XX-02 not evidenced.
    expect(res.body.series.map((p: any) => p.priority.score)).toEqual([0, 33, 33]);
    expect(res.body.series.map((p: any) => p.all.atTarget)).toEqual([0, 1, 2]);
    expect(res.body.series[2].all.counts).toEqual({ not_evidenced: 1, partial: 1, largely_met: 1, met: 1 });
  });

  it('lists, renames and removes snapshots through the generic routes', async () => {
    const list = await t.api.get('/api/assessment-snapshots');
    expect(list.body.rows.map((r: any) => r.name)).toEqual(['Spring', 'Winter']);
    const renamed = await t.api.patch(`/api/assessment-snapshots/${second}`, { name: 'Spring review' });
    expect(renamed.body.name).toBe('Spring review');
    expect((await t.api.del(`/api/assessment-snapshots/${second}`)).status).toBe(200);
    expect((await t.api.get(`/api/assessments/${second}`)).status).toBe(404);
    expect((await t.api.get(`/api/frameworks/${fw}/progress`)).body.series.length).toBe(2);
  });

  it('follows the configurable target status', async () => {
    await t.ctx.settings.set('frameworks.target_status', 'met');
    const res = await t.api.get(`/api/frameworks/${fw}/progress`);
    expect(res.body.target).toMatchObject({ status: 'met', score: 100 });
    expect(res.body.series[1].all.atTarget).toBe(1);
  });
});

describe('configurable lists', () => {
  it('ties the outcome lists to the frameworks module (E01-23)', async () => {
    const rows = await t.db.query<{ list_key: string; module: string }>(
      `select list_key, module from lookup_lists where list_key in ('outcome_status', 'outcome_phase') order by list_key`);
    expect(rows).toEqual([{ list_key: 'outcome_phase', module: 'frameworks' }, { list_key: 'outcome_status', module: 'frameworks' }]);
  });
});
