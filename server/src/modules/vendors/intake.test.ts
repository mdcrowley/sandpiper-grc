import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { DEFAULT_INTAKE, parseIntakeConfig, tierFor } from './intake.ts';

// Vendor intake with risk tiers and required checks (E41-10): the organization's questionnaire and
// rules set a vendor's tier, each tier needs checks, and a contract cannot become active until they
// are done or waived with a reason.
let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let editor: Client;   // vendors and contracts view, create and edit; no approve
let lead: Client;     // security lead: vendors.* (approve included) and contracts.*
let agent: Client;    // vendors.view only
const before = process.env.GRC_MODULES;
const ORDER = ['low', 'moderate', 'high', 'critical'];

beforeAll(async () => {
  process.env.GRC_MODULES = 'vendors,notifications,holds,admin';
  t = await testApp();
  const role = (await t.db.one<Row>(`insert into roles (key, name) values ('intake_editor', 'Intake editor (test)') returning id`))!;
  for (const p of ['vendors.view', 'vendors.edit', 'vendors.create', 'contracts.view', 'contracts.edit', 'contracts.create']) {
    await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [role.id, p]);
  }
  editor = await t.as('intake_editor');
  lead = await t.as('security_lead');
  agent = await t.as('agent');
}, 90_000);
afterAll(async () => {
  await t?.close();
  if (before === undefined) delete process.env.GRC_MODULES; else process.env.GRC_MODULES = before;
});

async function newVendor(name: string, extra: Row = {}): Promise<Row> {
  const res = await t.api.post('/api/vendors', { name, ...extra });
  expect(res.status).toBe(201);
  return res.body;
}
const answersOf = (over: Record<string, string> = {}) => ({ data: 'none', access: 'none', service: 'none', spend: 'small', ...over });

describe('tier rules', () => {
  it('gives the highest tier of any matching rule, never below the default', () => {
    expect(tierFor(DEFAULT_INTAKE, answersOf(), ORDER)).toEqual({ tier: 'low', reasons: [] });
    const r = tierFor(DEFAULT_INTAKE, answersOf({ data: 'personal', spend: 'large' }), ORDER);
    expect(r.tier).toBe('high');
    expect(r.reasons.map((x) => x.tier)).toEqual(['high', 'moderate']);
    expect(r.reasons[0]).toMatchObject({ question: 'data', answer: 'personal', answer_label: 'Personal data about riders or staff' });
    expect(tierFor(DEFAULT_INTAKE, answersOf({ service: 'major', access: 'remote' }), ORDER).tier).toBe('critical');
    expect(tierFor({ ...DEFAULT_INTAKE, default_tier: 'moderate' }, answersOf(), ORDER).tier).toBe('moderate');
  });

  it('validates a questionnaire typed on the settings page', () => {
    const checks = ['exclusion_list', 'insurance'];
    expect(parseIntakeConfig({ questions: [] }, ORDER, checks)).toMatchObject({ field: 'questions' });
    expect(parseIntakeConfig({ questions: [{ text: 'One answer only', options: [{ label: 'Yes' }] }], default_tier: 'low' }, ORDER, checks))
      .toMatchObject({ field: 'questions' });
    const ok = parseIntakeConfig({
      questions: [{ text: 'Will it reach rider data?', options: [{ label: 'Yes' }, { label: 'No' }] }],
      rules: [{ question: 'will_it_reach_rider_data', answers: ['yes'], tier: 'high' }],
      default_tier: 'low', required_checks: { high: ['insurance'] },
    }, ORDER, checks);
    expect(ok).toMatchObject({ config: { questions: [{ key: 'will_it_reach_rider_data', options: [{ value: 'yes' }, { value: 'no' }] }], rules: [{ tier: 'high' }] } });
    expect(parseIntakeConfig({ ...(ok as { config: Row }).config, rules: [{ question: 'will_it_reach_rider_data', answers: ['maybe'], tier: 'high' }] }, ORDER, checks))
      .toMatchObject({ field: 'rules' });
    expect(parseIntakeConfig({ ...(ok as { config: Row }).config, required_checks: { high: ['not_a_check'] } }, ORDER, checks))
      .toMatchObject({ field: 'required_checks' });
  });
});

describe('intake, checks and the block on active contracts', () => {
  it('sets the tier from the intake, lists the required checks and blocks activation until they are done or waived', async () => {
    const v = await newVendor('Intake Signals', { owner_id: lead.userId });
    // No intake yet: no tier, nothing required, a contract may become active.
    expect((await editor.get(`/api/vendors/${v.id}/checks`)).body).toMatchObject({ tier: null, required: [], outstanding: 0 });

    // Not every question answered.
    const partial = await editor.post(`/api/vendors/${v.id}/intake`, { answers: { data: 'personal' } });
    expect(partial.status).toBe(400);
    expect(partial.body.error.fields.answers).toMatch(/Answer every question/);

    const preview = await agent.post('/api/vendors/intake/preview', { answers: answersOf({ data: 'personal' }) });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ tier: 'high', tier_label: 'High' });
    expect(preview.body.required_checks.map((c: Row) => c.key)).toEqual(['exclusion_list', 'insurance', 'security_assessment', 'data_agreement']);

    const done = await editor.post(`/api/vendors/${v.id}/intake`, { answers: answersOf({ data: 'personal' }), notes: 'Handles the rider help desk.' });
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ tier: 'high', reasons: [{ question: 'data', tier: 'high' }] });
    const vendor = (await t.api.get(`/api/vendors/${v.id}`)).body;
    expect(vendor).toMatchObject({ risk_tier: 'high', risk_tier_on: dayInZone() });
    // The tier is read-only to people.
    await t.api.patch(`/api/vendors/${v.id}`, { risk_tier: 'low' });
    expect((await t.api.get(`/api/vendors/${v.id}`)).body.risk_tier).toBe('high');
    // The owner is told what is still needed.
    const note = await t.db.one<Row>('select title from notifications where user_id = $1 and record_id = $2', [lead.userId, v.id]);
    expect(note?.title).toMatch(/High risk tier, 4 checks to do/);
    const audit = await t.db.one<Row>(`select summary from audit_events where action = 'vendor.intake' and record_id = $1`, [v.id]);
    expect(audit?.summary).toMatch(/High risk tier/);

    const intake = (await agent.get(`/api/vendors/${v.id}/intake`)).body;
    expect(intake).toMatchObject({ tier: 'high', tier_label: 'High', can_complete: false, latest: { notes: 'Handles the rider help desk.' } });
    expect(intake.history).toHaveLength(1);

    let checks = (await editor.get(`/api/vendors/${v.id}/checks`)).body;
    expect(checks).toMatchObject({ tier: 'high', outstanding: 4, can_record: true, can_waive: false });
    expect(checks.required.map((r: Row) => r.state)).toEqual(['missing', 'missing', 'missing', 'missing']);

    // A contract cannot be created active, nor made active, while checks are outstanding.
    const blocked = await editor.post('/api/contracts', { title: 'Intake help desk', vendor_id: v.id, status: 'active' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.fields.status).toMatch(/High risk tier needs these checks.*Exclusion-list check, Insurance certificate received/);
    const draft = await editor.post('/api/contracts', { title: 'Intake help desk', vendor_id: v.id, status: 'draft' });
    expect(draft.status).toBe(201);
    expect((await editor.patch(`/api/contracts/${draft.body.id}`, { status: 'active' })).status).toBe(400);

    // Done, one with a reference and an expiry.
    for (const key of ['exclusion_list', 'insurance', 'security_assessment']) {
      const res = await editor.post(`/api/vendors/${v.id}/checks`, { check_key: key, reference: `REF-${key}`, expires_on: dayInZone(365) });
      expect(res.status, key).toBe(201);
    }
    // Waiving needs vendors.approve and a reason.
    expect((await editor.post(`/api/vendors/${v.id}/checks`, { check_key: 'data_agreement', outcome: 'waived', note: 'Covered by the master agreement.' })).status).toBe(403);
    const noReason = await lead.post(`/api/vendors/${v.id}/checks`, { check_key: 'data_agreement', outcome: 'waived' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.fields.note).toMatch(/reason/);
    const waived = await lead.post(`/api/vendors/${v.id}/checks`, { check_key: 'data_agreement', outcome: 'waived', note: 'Covered by the master agreement.' });
    expect(waived.status).toBe(201);
    checks = (await editor.get(`/api/vendors/${v.id}/checks`)).body;
    expect(checks.required.map((r: Row) => r.state)).toEqual(['done', 'done', 'done', 'waived']);
    expect(checks.outstanding).toBe(0);
    expect((await t.db.one<Row>(`select summary from audit_events where action = 'vendor.check_waived' and record_id = $1`, [v.id]))?.summary)
      .toMatch(/Data protection terms agreed \(Covered by the master agreement\.\)/);

    expect((await editor.patch(`/api/contracts/${draft.body.id}`, { status: 'active' })).status).toBe(200);

    // Removing a waiver needs approve too; then the next activation is blocked again.
    expect((await editor.del(`/api/vendors/${v.id}/checks/${waived.body.id}`)).status).toBe(403);
    expect((await lead.del(`/api/vendors/${v.id}/checks/${waived.body.id}`)).status).toBe(200);
    expect((await editor.get(`/api/vendors/${v.id}/checks`)).body.outstanding).toBe(1);
    expect((await editor.post('/api/contracts', { title: 'Second order', vendor_id: v.id, status: 'active' })).status).toBe(400);
  });

  it('checks the new vendor when an active contract moves to another vendor (W23 F3)', async () => {
    const clean = await newVendor('Intake Move From');
    const needy = await newVendor('Intake Move To');
    expect((await editor.post(`/api/vendors/${needy.id}/intake`, { answers: answersOf({ data: 'personal' }) })).status).toBe(201);
    const active = await editor.post('/api/contracts', { title: 'Moved contract', vendor_id: clean.id, status: 'active' });
    expect(active.status).toBe(201);
    // Without vendors.approve the checks cannot be waived, and moving the contract does not get around them.
    const moved = await editor.patch(`/api/contracts/${active.body.id}`, { vendor_id: needy.id });
    expect(moved.status).toBe(400);
    expect(moved.body.error.fields.vendor_id).toMatch(/High risk tier needs these checks/);
    expect((await t.api.get(`/api/contracts/${active.body.id}`)).body.vendor_id).toBe(clean.id);
    // A contract that is not active may move; it is checked when it becomes active.
    const draft = await editor.post('/api/contracts', { title: 'Moved draft', vendor_id: clean.id, status: 'draft' });
    expect((await editor.patch(`/api/contracts/${draft.body.id}`, { vendor_id: needy.id })).status).toBe(200);
    expect((await editor.patch(`/api/contracts/${draft.body.id}`, { status: 'active' })).status).toBe(400);
    // Other changes to an active contract are not held up.
    expect((await editor.patch(`/api/contracts/${active.body.id}`, { title: 'Moved contract (renamed)' })).status).toBe(200);
  });

  it('counts an expired check as needed again, and future or invalid dates are refused', async () => {
    const v = await newVendor('Intake Expiry');
    await editor.post(`/api/vendors/${v.id}/intake`, { answers: answersOf() });
    expect((await t.api.get(`/api/vendors/${v.id}`)).body.risk_tier).toBe('low');
    const future = await editor.post(`/api/vendors/${v.id}/checks`, { check_key: 'exclusion_list', done_on: dayInZone(3) });
    expect(future.status).toBe(400);
    expect(future.body.error.fields.done_on).toBeTruthy();
    expect((await editor.post(`/api/vendors/${v.id}/checks`, { check_key: 'nope' })).status).toBe(400);
    await editor.post(`/api/vendors/${v.id}/checks`, { check_key: 'exclusion_list', done_on: dayInZone(-400), expires_on: dayInZone(-35) });
    const checks = (await editor.get(`/api/vendors/${v.id}/checks`)).body;
    expect(checks.required).toMatchObject([{ key: 'exclusion_list', state: 'expired' }]);
    expect((await editor.post('/api/contracts', { title: 'Expiry contract', vendor_id: v.id, status: 'active' })).status).toBe(400);
    // The figure counts vendors still needing checks, the same for everyone.
    expect((await agent.get('/api/vendors/lifecycle-summary')).body.checks_outstanding).toBeGreaterThanOrEqual(1);
  });

  it('can require an intake before any contract becomes active, and only an administrator changes the questionnaire', async () => {
    const v = await newVendor('Intake Required');
    expect((await editor.post('/api/contracts', { title: 'Before the setting', vendor_id: v.id, status: 'active' })).status).toBe(201);
    expect((await editor.put('/api/vendors/intake-settings', { intake_before_contract: true })).status).toBe(403);
    const on = await t.api.put('/api/vendors/intake-settings', { intake_before_contract: true });
    expect(on.status).toBe(200);
    expect(on.body.intake_before_contract).toBe(true);
    try {
      const res = await editor.post('/api/contracts', { title: 'After the setting', vendor_id: v.id, status: 'active' });
      expect(res.status).toBe(400);
      expect(res.body.error.fields.status).toMatch(/intake questionnaire/);
    } finally {
      await t.api.put('/api/vendors/intake-settings', { intake_before_contract: false });
    }

    // A new questionnaire: completed intakes keep what they were asked.
    const settings = (await agent.get('/api/vendors/intake-settings')).body;
    expect(settings.can_edit).toBe(false);
    expect(settings.tiers.map((x: Row) => x.value)).toEqual(ORDER);
    const config = {
      questions: [{ key: 'reach', text: 'Will it reach the depot network?', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] }],
      rules: [{ question: 'reach', answers: ['yes'], tier: 'critical' }],
      default_tier: 'moderate', required_checks: { critical: ['references'], moderate: [] },
    };
    const bad = await t.api.put('/api/vendors/intake-settings', { config: { ...config, default_tier: 'nope' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.default_tier).toBeTruthy();
    expect((await t.api.put('/api/vendors/intake-settings', { config })).status).toBe(200);
    try {
      const old = (await agent.get(`/api/vendors/${(await newVendor('Intake Old Questions')).id}/intake`)).body;
      expect(old.questions.map((q: Row) => q.key)).toEqual(['reach']);
      const w = await newVendor('Intake New Questions');
      const res = await editor.post(`/api/vendors/${w.id}/intake`, { answers: { reach: 'no' } });
      expect(res.body.tier).toBe('moderate');
      expect((await editor.get(`/api/vendors/${w.id}/checks`)).body.required).toEqual([]);
      // The first vendor's intake still holds the questions it was answered against.
      const first = (await t.db.one<Row>(`select questions from vendor_intakes i join vendors v on v.id = i.vendor_id where v.name = 'Intake Signals'`))!;
      expect((first.questions as Row[]).map((q) => q.key)).toEqual(['data', 'access', 'service', 'spend']);
    } finally {
      await t.api.put('/api/vendors/intake-settings', { config: DEFAULT_INTAKE });
    }
  });

  it('refuses removing a check while the vendor is under a legal hold', async () => {
    const v = await newVendor('Intake Held');
    const c = await editor.post(`/api/vendors/${v.id}/checks`, { check_key: 'references', note: 'Spoke to two transit agencies (invented).' });
    const h = (await t.api.post('/api/legal-holds', { matter: 'Invented matter: vendor dispute' })).body;
    expect((await t.api.post(`/api/legal-holds/${h.id}/records`, { records: [{ type: 'vendor', id: v.id }] })).status).toBe(201);
    const res = await editor.del(`/api/vendors/${v.id}/checks/${c.body.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('on_hold');
  });

  it('keeps everything out of reach without vendors.view and when the area is off', async () => {
    const v = await newVendor('Intake Hidden');
    const nobody = await t.as('requester');
    for (const url of [`/api/vendors/${v.id}/checks`, `/api/vendors/${v.id}/intake`, '/api/vendors/intake-settings']) {
      expect((await nobody.get(url)).status, url).toBe(403);
    }
    const admin = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
    await t.db.query('update sessions set confirmed_at = now() where user_id = $1', [admin]);
    expect((await t.api.patch('/api/admin/features', { features: { vendors: false } })).status).toBe(200);
    try {
      for (const url of [`/api/vendors/${v.id}/checks`, '/api/vendors/intake-settings']) {
        const r = await t.api.get(url);
        expect(r.status, url).toBe(404);
        expect(r.body.error.code, url).toBe('switched_off');
      }
      const meta = (await t.api.get('/api/meta')).body;
      expect(meta.lookups.vendor_risk_tier).toBeUndefined();
      expect(meta.lookups.vendor_check).toBeUndefined();
    } finally {
      await t.api.patch('/api/admin/features', { features: { vendors: true } });
    }
  });
});
