import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// E46-53: a change of the risk appetite through the "Risk appetite change" approval workflow, beside the
// change recorded by hand or from a committee decision. All people and figures are invented.

const loaded = !process.env.GRC_MODULES || process.env.GRC_MODULES.split(',').includes('workflows');
type T = Awaited<ReturnType<typeof testApp>>;
let t: T;
let asker: Awaited<ReturnType<T['as']>>; // administers risks, asks
let approver: Awaited<ReturnType<T['as']>>; // decides
let viewer: Awaited<ReturnType<T['as']>>; // risks.view only

const waiting = async (client: T['api']) => (await client.get('/api/workflows/approvals')).body.rows as any[];
const ask = (client: T['api'], body: Record<string, unknown>) =>
  client.post('/api/risks/appetite/changes', { category: 'enterprise', reason: 'Invented: the service plan changed', ...body });
const appetite = async () => (await t.api.get('/api/risks/appetite')).body;
const category = async (key: string) => (await appetite()).categories.find((c: any) => c.category === key);
const decide = async (client: T['api'], id: string, decision: 'approved' | 'rejected', comment?: string) => {
  const item = (await waiting(client)).find((a) => a.record_id === id);
  expect(item, 'waiting for this approver').toBeDefined();
  return client.post(`/api/workflows/steps/${item.step_id}/decision`, { decision, ...(comment ? { comment } : {}) });
};

describe.runIf(loaded)('risk appetite change through an approval workflow', () => {
  beforeAll(async () => {
    t = await testApp();
    asker = await t.as('security_lead');
    approver = await t.as('security_lead');
    const role = await t.db.one<{ id: string }>(`insert into roles (key, name) values ('risk_reader_probe', 'Risk reader') returning id`);
    await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'risks.view')`, [role!.id]);
    viewer = await t.as('risk_reader_probe');
  }, 60_000);
  afterAll(async () => { await t?.close(); });

  it('installs the default workflow once and offers it on the appetite page', async () => {
    const defs = (await t.api.get('/api/workflows/definitions?record_type=risk_appetite_change')).body.rows.filter((d: any) => d.kind === 'risk_appetite_change');
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({ name: 'Risk appetite change', trigger: 'module' });
    expect((await appetite()).workflow_available).toBe(true);
  });

  it('asks, approves and records the next version with the approval', async () => {
    const before = await category('enterprise');
    // Only someone who administers risks asks; the proposal is checked like a direct change.
    expect((await ask(viewer, { max_rating: 'low' })).status).toBe(403);
    expect((await ask(asker, { max_rating: 'nonsense' })).body.error.fields.max_rating).toBeDefined();
    expect((await ask(asker, { max_rating: 'low', reason: '' })).body.error.fields.reason).toBeDefined();
    expect((await ask(asker, {})).body.error.fields.statement).toBeDefined();

    const res = await ask(asker, { statement: 'Invented: little tolerance for missed trips.', max_rating: 'medium', max_score: 9 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ status: 'awaiting_approval', requested_by: asker.userId, title: 'Change of the enterprise risk appetite' });
    expect(res.body.ref).toMatch(/^RAC-/);
    // One request per category at a time; what was asked cannot be edited.
    expect((await ask(asker, { max_rating: 'low' })).body.error.code).toBe('already_requested');
    expect((await asker.patch(`/api/risks/appetite/changes/${res.body.id}`, { max_rating: 'low' })).status).toBe(409);
    // The appetite page shows it waiting; the appetite in force is unchanged.
    const shown = await category('enterprise');
    expect(shown.request).toMatchObject({ id: res.body.id, max_rating: 'medium', workflow: 'Risk appetite change', requested_by_name: expect.any(String) });
    expect(shown.version ?? null).toBe(before.version ?? null);
    expect(shown.max_rating ?? null).toBe(before.max_rating ?? null);

    // The person who asked does not decide it.
    expect((await waiting(asker)).some((a) => a.record_id === res.body.id)).toBe(false);
    const decided = await decide(approver, res.body.id, 'approved');
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    expect(decided.body.instance.outcome_error ?? null).toBeNull();

    const after = await category('enterprise');
    expect(after).toMatchObject({ statement: 'Invented: little tolerance for missed trips.', max_rating: 'medium', max_score: 9, reference: res.body.ref, approval_body: 'Approval workflow "Risk appetite change"', request: null });
    expect(after.version).toBe((before.version ?? 0) + 1);
    expect(String(after.approved_on).slice(0, 10)).toBe(dayInZone());
    expect(after.reason).toMatch(/service plan changed/);
    const req = (await t.api.get(`/api/risks/appetite/changes/${res.body.id}`)).body;
    expect(req).toMatchObject({ status: 'approved', version: after.version });
    expect(req.decided_by_name).toBeTruthy();
    const versions = (await t.api.get('/api/risks/appetite/versions?category=enterprise')).body;
    expect(versions[0]).toMatchObject({ version: after.version, reference: res.body.ref });
  });

  it('a rejection leaves the appetite as it was, with the reason on the request', async () => {
    const before = await category('compliance');
    const res = await ask(asker, { category: 'compliance', max_rating: 'high' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await decide(approver, res.body.id, 'rejected', 'Invented: keep it as approved last year')).status).toBe(200);
    const after = await category('compliance');
    expect([after.version ?? null, after.max_rating ?? null, after.request]).toEqual([before.version ?? null, before.max_rating ?? null, null]);
    expect((await t.api.get(`/api/risks/appetite/changes/${res.body.id}`)).body).toMatchObject({ status: 'rejected', decision_note: 'Invented: keep it as approved last year' });
    // It can be asked for again.
    const again = await ask(asker, { category: 'compliance', max_rating: 'high' });
    expect(again.status).toBe(201);
    // Withdrawn by the person who asked: the workflow ends.
    expect((await viewer.post(`/api/risks/appetite/changes/${again.body.id}/withdraw`, {})).status).toBe(403);
    const w = await asker.post(`/api/risks/appetite/changes/${again.body.id}/withdraw`, { reason: 'Invented: wrong category' });
    expect(w.status, JSON.stringify(w.body)).toBe(200);
    expect(w.body.status).toBe('withdrawn');
    expect((await waiting(approver)).some((a) => a.record_id === again.body.id)).toBe(false);
    expect((await asker.post(`/api/risks/appetite/changes/${again.body.id}/withdraw`, {})).status).toBe(409);
  });

  it('a version recorded directly supersedes a request still waiting', async () => {
    const res = await ask(asker, { category: 'compliance', statement: 'Invented: moderate appetite.' });
    expect(res.status).toBe(201);
    const direct = await t.api.put('/api/risks/appetite', {
      reason: 'Invented: decided at the board meeting',
      categories: [{ category: 'compliance', max_rating: 'low', approved_on: dayInZone(-1), approved_by_name: 'Invented chair', approval_body: 'Invented board' }],
    });
    expect(direct.status, JSON.stringify(direct.body)).toBe(200);
    expect((await t.api.get(`/api/risks/appetite/changes/${res.body.id}`)).body.status).toBe('superseded');
    expect((await waiting(approver)).some((a) => a.record_id === res.body.id)).toBe(false);
  });

  it('asks to remove an appetite, and refuses one that is not there or already in force', async () => {
    await t.api.put('/api/risks/appetite', { reason: 'Invented: clean slate', categories: [{ category: 'third_party' }] });
    expect((await ask(asker, { category: 'third_party', remove_appetite: true })).body.error.fields.remove_appetite).toBeDefined();
    const op = await category('enterprise');
    expect((await ask(asker, { statement: op.statement, max_rating: op.max_rating, max_score: op.max_score })).body.error.fields.statement).toMatch(/in force already/);
    const res = await ask(asker, { remove_appetite: true, reason: 'Invented: covered by the enterprise appetite' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.title).toBe('Remove the enterprise risk appetite');
    expect((await decide(approver, res.body.id, 'approved')).status).toBe(200);
    const after = await category('enterprise');
    expect([after.statement, after.max_rating, after.max_score]).toEqual([null, null, null]);
    expect((await t.api.get('/api/risks/appetite/versions?category=enterprise')).body[0]).toMatchObject({ removed: true, reference: res.body.ref });
  });

  it('with no active workflow, asking is refused and recording by hand still works', async () => {
    const def = (await t.api.get('/api/workflows/definitions?record_type=risk_appetite_change')).body.rows.find((d: any) => d.kind === 'risk_appetite_change');
    await t.api.patch(`/api/workflows/definitions/${def.id}`, { active: false });
    try {
      expect((await appetite()).workflow_available).toBe(false);
      const res = await ask(asker, { category: 'third_party', max_rating: 'medium' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('no_workflow');
      expect((await t.db.one<{ n: number }>(`select count(*)::int as n from risk_appetite_changes where category = 'third_party'`))!.n).toBe(0);
    } finally {
      await t.api.patch(`/api/workflows/definitions/${def.id}`, { active: true });
    }
  });

  it('loads a past request with its outcome in data load mode, and starts no workflow', async () => {
    const mode = (on: boolean) => (on
      ? t.db.query(`insert into settings (key, value) values ('data_load.mode', $1::jsonb) on conflict (key) do update set value = excluded.value`,
        [JSON.stringify({ until: new Date(Date.now() + 86_400_000).toISOString() })])
      : t.db.query(`delete from settings where key = 'data_load.mode'`));
    await mode(true);
    try {
      const pending = await t.api.post('/api/risks/appetite/changes', { category: 'third_party', max_rating: 'low', reason: 'Invented: 2021 review' });
      expect(pending.status).toBe(400);
      expect(pending.body.error.fields.status).toBeDefined();
      const res = await t.api.post('/api/risks/appetite/changes', {
        category: 'third_party', max_rating: 'low', reason: 'Invented: 2021 review', status: 'approved', decided_on: '2021-03-04',
        decided_by_name: 'Invented chair', created_at: '2021-02-01T10:00:00Z',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body).toMatchObject({ status: 'approved', decided_by_name: 'Invented chair' });
      expect(String(res.body.decided_on).slice(0, 10)).toBe('2021-03-04');
      expect((await t.api.get(`/api/workflows/records/risk_appetite_change/${res.body.id}`)).body.instances).toHaveLength(0);
    } finally {
      await mode(false);
    }
  });
});
