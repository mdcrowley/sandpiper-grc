import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { loadCsf2 } from './reference.ts';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

describe('frameworks settings screen (E07-23)', () => {
  it('reads and changes the target status, weights and reminder lead time, with audit', async () => {
    const before = (await t.api.get('/api/frameworks/settings')).body;
    expect(before).toMatchObject({ target_status: 'largely_met', review_reminder_days: 14, can_administer: true });
    expect(before.statuses.map((s: any) => [s.value, s.weight])).toEqual([['not_evidenced', 0], ['partial', 0.33], ['largely_met', 0.67], ['met', 1]]);

    const saved = await t.api.put('/api/frameworks/settings', { target_status: 'met', weights: { partial: 0.4 }, review_reminder_days: 21 });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ target_status: 'met', review_reminder_days: 21 });
    expect(saved.body.statuses.find((s: any) => s.value === 'partial').weight).toBe(0.4);

    const audit = await t.db.query<{ action: string }>(
      `select action from audit_events where action = 'frameworks.weights_change' or (action = 'setting.change' and record_id like 'frameworks.%') order by id`);
    expect(audit.map((a) => a.action)).toEqual(['frameworks.weights_change', 'setting.change', 'setting.change']);
  });

  it('refuses values that make no sense', async () => {
    const bad = await t.api.put('/api/frameworks/settings', { target_status: 'not_evidenced', weights: { met: 2, nope: 1 }, review_reminder_days: 400 });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['review_reminder_days', 'target_status', 'weights.met', 'weights.nope']);
  });

  it('needs frameworks.administer to change, frameworks.view to read', async () => {
    const viewer = await t.as('executive_viewer');
    expect((await viewer.get('/api/frameworks/settings')).body.can_administer).toBe(false);
    expect((await viewer.put('/api/frameworks/settings', { review_reminder_days: 3 })).status).toBe(403);
  });
});

describe('refreshing the shipped NIST CSF 2.0 wording (E18-03)', () => {
  it('fixes wording only, and leaves statuses and extra outcomes alone', async () => {
    const ref = loadCsf2();
    const gv = ref.functions[0];
    const oc = gv.categories[0];
    // An older load: one outcome with drifted wording, a category name typed differently, and an outcome of the organization's own.
    const file = {
      key: ref.key, name: ref.name, version: ref.version, description: ref.description,
      functions: [{
        code: gv.code, name: gv.name, description: gv.description, color: 'purple', categories: [
          { code: oc.code, name: 'Organisational context', description: oc.description, outcomes: [
            { code: oc.outcomes[0].code, text: 'An older wording of the mission outcome' },
            { code: oc.outcomes[1].code, text: oc.outcomes[1].text },
          ] },
          { code: 'GV.ZZ', name: 'Our own', outcomes: [{ code: 'GV.ZZ-01', text: 'Something of our own' }] },
        ],
      }],
    };
    const loaded = await t.api.post('/api/frameworks/import', file);
    expect(loaded.status).toBe(201);
    const fw = loaded.body.framework_id;
    const first = (await t.api.get(`/api/framework-outcomes?q=${oc.outcomes[0].code}`)).body.rows[0];
    await t.api.patch(`/api/framework-outcomes/${first.id}`, { status: 'partial', target: 'Ours' });

    const preview = await t.api.post(`/api/frameworks/${fw}/refresh-text`, { dryRun: true });
    expect(preview.status).toBe(200);
    expect(preview.body.outcomes).toEqual([{ code: oc.outcomes[0].code, before: 'An older wording of the mission outcome', after: oc.outcomes[0].text }]);
    expect(preview.body.structure).toEqual([{ code: oc.code, field: 'name', before: 'Organisational context', after: oc.name }]);
    expect((await t.api.get(`/api/framework-outcomes/${first.id}`)).body.official_text).toBe('An older wording of the mission outcome');

    const done = await t.api.post(`/api/frameworks/${fw}/refresh-text`, {});
    expect(done.body.outcomes).toHaveLength(1);
    const after = (await t.api.get(`/api/framework-outcomes/${first.id}`)).body;
    expect(after).toMatchObject({ official_text: oc.outcomes[0].text, status: 'partial', target: 'Ours' });
    expect((await t.api.get('/api/framework-outcomes?q=GV.ZZ-01')).body.rows[0].official_text).toBe('Something of our own');
    expect((await t.api.post(`/api/frameworks/${fw}/refresh-text`, {})).body).toMatchObject({ outcomes: [], structure: [] });
    expect(await t.db.one(`select 1 from audit_events where action = 'framework.text_refresh' and record_id = $1`, [fw])).toBeTruthy();

    const lead = await t.as('agent');
    expect((await lead.post(`/api/frameworks/${fw}/refresh-text`, {})).status).toBe(403);
    const other = await t.api.post('/api/frameworks/import', { key: 'small', name: 'Small', functions: [{ code: 'A', name: 'A', categories: [{ code: 'A.1', name: 'One', outcomes: [{ code: 'A.1-1', text: 'x' }] }] }] });
    expect((await t.api.post(`/api/frameworks/${other.body.framework_id}/refresh-text`, {})).status).toBe(409);
  });
});
