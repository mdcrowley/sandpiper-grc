import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// E41-12: written test steps per control, each step's result in a control test, and importing
// coverage from a spreadsheet. A stand-in for the risks module's restricted `risk` type; hazards come
// from the real safety module. Invented data only.
const standIn: ModuleDef = {
  key: 'stepstandins',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists s_risks (
        id uuid primary key default gen_random_uuid(), ref text, title text not null, owner_id uuid, review_on date, status text,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'risk', table: 's_risks', module: 'risks', label: 'Risk', plural: 'Risks', restricted: true,
      path: '/api/risks', route: '/risks', titleField: 'title', ref: { field: 'ref', prefix: 'RSK-' },
      fields: { ref: { label: 'Reference', type: 'text', readOnly: true }, title: { label: 'Risk', type: 'text', required: true }, review_on: { label: 'Next review', type: 'date' } },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let lead: Client;      // security lead: controls.*, risks, security.view, safety.view
let auditLead: Client; // controls, safety and risks, but no security.view
let auditor: Client;   // controls.view only
let controlId: string;
let control2: Row;
let riskRef: string;
let hazard: Row;

const ok = <T = Row>(res: { status: number; body: T }, status = 200): T => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};

beforeAll(async () => {
  process.env.GRC_MODULES = 'controls,safety,notifications';
  t = await testApp({ extraModules: [standIn] });
  lead = await t.as('security_lead');
  // Controls, hazards and risks, but not restricted records (no security.view): the risk stays hidden.
  const role = (await t.db.one<Row>(`insert into roles (key, name) values ('steps_tester', 'Invented steps tester') returning id`))!;
  for (const p of ['controls.view', 'controls.edit', 'safety.view', 'risks.view']) await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [role.id, p]);
  auditLead = await t.as('steps_tester');
  auditor = await t.as('auditor');
  riskRef = (await t.ctx.resources.create('risk', { title: 'Invented risk of a depot network outage' })).ref;
  hazard = await t.ctx.resources.create('hazard', { title: 'Invented hazard at the wash bay', review_date: dayInZone(90) });
  controlId = ok(await lead.post('/api/controls', { title: 'Invented wash bay lockout check', status: 'active' }), 201).id;
  control2 = ok(await lead.post('/api/controls', { title: 'Invented server room door alarm', status: 'active' }), 201);
});
afterAll(async () => { await t.close(); delete process.env.GRC_MODULES; });

describe('written test steps on a control', () => {
  it('adds, changes, orders and removes steps, with history; only editors change them', async () => {
    const a = ok(await lead.post(`/api/controls/${controlId}/steps`, { step: 'Pick five shifts from the roster.', expected: 'Each shift has a lockout record.' }), 201);
    const b = ok(await lead.post(`/api/controls/${controlId}/steps`, { step: 'Check the lockout tags on the bay.' }), 201);
    const c = ok(await lead.post(`/api/controls/${controlId}/steps`, { step: 'Ask the supervisor how a missing tag is reported.' }), 201);
    expect((await lead.post(`/api/controls/${controlId}/steps`, { step: '  ' })).body.error.fields.step).toBeTruthy();
    expect((await auditor.post(`/api/controls/${controlId}/steps`, { step: 'Not allowed' })).status).toBe(403);
    ok(await lead.patch(`/api/controls/${controlId}/steps/${b.id}`, { expected: 'Every tag names its owner.' }));
    const ordered = ok(await lead.put(`/api/controls/${controlId}/steps/order`, { ids: [c.id, a.id, b.id] }));
    expect(ordered.rows.map((r: Row) => r.id)).toEqual([c.id, a.id, b.id]);
    expect((await lead.put(`/api/controls/${controlId}/steps/order`, { ids: [c.id, a.id] })).status).toBe(400);
    ok(await lead.del(`/api/controls/${controlId}/steps/${c.id}`));
    const seen = ok(await auditor.get(`/api/controls/${controlId}/steps`));
    expect(seen.rows.map((r: Row) => [r.step, r.expected])).toEqual([
      ['Pick five shifts from the roster.', 'Each shift has a lockout record.'],
      ['Check the lockout tags on the bay.', 'Every tag names its owner.'],
    ]);
    const history = await t.db.query<Row>(`select action from audit_events where record_type = 'control' and record_id = $1 and action like 'control.step%' order by id`, [controlId]);
    expect(history.map((h) => h.action)).toEqual(['control.step_add', 'control.step_add', 'control.step_add', 'control.step_update', 'control.step_order', 'control.step_remove']);
  });
});

describe('step results in a control test', () => {
  let testId: string;
  it('copies the control\'s steps into a new test, and later steps on request', async () => {
    testId = ok(await lead.post('/api/control-tests', { control_id: controlId, test_type: 'operating', status: 'in_progress' }), 201).id;
    let steps = ok(await auditor.get(`/api/control-tests/${testId}/steps`));
    expect(steps).toMatchObject({ total: 2, done: 0, failed: 0, not_copied: 0 });
    ok(await lead.post(`/api/controls/${controlId}/steps`, { step: 'Look at the incident log for the period.' }), 201);
    // Changing the control's steps does not rewrite the test's copy.
    const first = (await lead.get(`/api/controls/${controlId}/steps`)).body.rows[0];
    ok(await lead.patch(`/api/controls/${controlId}/steps/${first.id}`, { step: 'Pick ten shifts from the roster.' }));
    steps = ok(await lead.get(`/api/control-tests/${testId}/steps`));
    expect(steps.rows[0].step).toBe('Pick five shifts from the roster.');
    expect(steps.not_copied).toBe(1);
    const copied = ok(await lead.post(`/api/control-tests/${testId}/steps/copy`, {}));
    expect(copied).toMatchObject({ added: 1, total: 3, not_copied: 0 });
    expect(ok(await lead.post(`/api/control-tests/${testId}/steps/copy`, {})).added).toBe(0);
  });

  it('records each step\'s result and note, and needs every result before the testing is finished', async () => {
    const rows = (await lead.get(`/api/control-tests/${testId}/steps`)).body.rows as Row[];
    expect((await lead.patch(`/api/control-tests/${testId}/steps/${rows[0].id}`, { result: 'maybe' })).body.error.fields.result).toBeTruthy();
    expect((await auditor.patch(`/api/control-tests/${testId}/steps/${rows[0].id}`, { result: 'pass' })).status).toBe(403);
    const done = ok(await lead.patch(`/api/control-tests/${testId}/steps/${rows[0].id}`, { result: 'pass', note: 'Five records found.' }));
    expect(done).toMatchObject({ result: 'pass', note: 'Five records found.', done_by: lead.userId });
    ok(await lead.patch(`/api/control-tests/${testId}/steps/${rows[1].id}`, { result: 'fail', note: 'Two tags had no owner.' }));
    const finish = await lead.patch(`/api/control-tests/${testId}`, { status: 'complete', result: 'partly_effective', performed_on: dayInZone(), conclusion: 'Tags missing owners.' });
    expect(finish.status).toBe(400);
    expect(finish.body.error.fields.status).toMatch(/every test step/);
    ok(await lead.patch(`/api/control-tests/${testId}/steps/${rows[2].id}`, { result: 'not_applicable' }));
    const summary = ok(await lead.get(`/api/control-tests/${testId}/steps`));
    expect(summary).toMatchObject({ total: 3, done: 3, failed: 1 });
    ok(await lead.patch(`/api/control-tests/${testId}`, { status: 'complete', result: 'partly_effective', performed_on: dayInZone(), conclusion: 'Tags missing owners.' }));
    // Clearing a result clears who gave it.
    const cleared = ok(await lead.patch(`/api/control-tests/${testId}/steps/${rows[2].id}`, { result: null }));
    expect(cleared).toMatchObject({ result: null, done_by: null, done_at: null });
    ok(await lead.patch(`/api/control-tests/${testId}/steps/${rows[2].id}`, { result: 'not_applicable' }));
    const audits = await t.db.query<Row>(`select summary from audit_events where action = 'control_test.step_result' and record_id = $1 order by id`, [testId]);
    expect(audits[0].summary).toMatch(/Passed/);
  });

  it('locks the steps once the test is reviewed', async () => {
    const reviewer = await t.as('security_lead');
    ok(await reviewer.post(`/api/control-tests/${testId}/review`, { note: 'Checked.' }));
    const rows = (await lead.get(`/api/control-tests/${testId}/steps`)).body.rows as Row[];
    expect((await lead.patch(`/api/control-tests/${testId}/steps/${rows[0].id}`, { result: 'fail' })).status).toBe(409);
    expect((await lead.post(`/api/control-tests/${testId}/steps/copy`, {})).status).toBe(409);
  });

  it('a test of a control with no steps is unaffected', async () => {
    const id = ok(await lead.post('/api/control-tests', { control_id: control2.id, test_type: 'design' }), 201).id;
    expect(ok(await lead.get(`/api/control-tests/${id}/steps`))).toMatchObject({ total: 0 });
    ok(await lead.patch(`/api/control-tests/${id}`, { status: 'complete', result: 'effective', performed_on: dayInZone() }));
  });
});

describe('importing coverage from a spreadsheet', () => {
  const csv = (rows: string[][]) => rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n');

  it('checks first, row by row, then adds only new links; repeated rows and links already there change nothing', async () => {
    const control = (await lead.get(`/api/controls/${controlId}`)).body;
    const text = csv([
      ['Control', 'Kind of record', 'Record'],
      [control.ref, 'Risk', riskRef],
      [control2.title, 'hazard', hazard.title],
      [control.ref, '', hazard.ref],
      [control.ref, 'Risk', riskRef],
      ['CTL-99999', 'Risk', riskRef],
      [control.ref, 'Vendor', 'Anything'],
      [control.ref, 'Hazard', 'No such hazard'],
      ['', '', ''],
    ]);
    const check = ok(await lead.post('/api/controls/coverage/import', { fileName: 'coverage.csv', text }));
    expect(check).toMatchObject({ dryRun: true, rows: 7, added: 3, existing: 1, errors: 3, columns: { control: 'Control', type: 'Kind of record', record: 'Record' } });
    expect(check.results.map((r: Row) => r.outcome)).toEqual(['add', 'add', 'add', 'exists', 'error', 'error', 'error']);
    expect(check.results[4].message).toMatch(/No control "CTL-99999"/);
    expect(check.results[5].message).toMatch(/not a kind of record/);
    expect(check.results[2].record).toMatchObject({ type: 'hazard', id: hazard.id });
    expect((await t.db.one<Row>(`select count(*)::int as n from record_links where from_type = 'control' and relation = 'covers'`))!.n).toBe(0);

    const done = ok(await lead.post('/api/controls/coverage/import', { fileName: 'coverage.csv', text, dryRun: false }));
    expect(done).toMatchObject({ dryRun: false, added: 3, existing: 1, errors: 3 });
    expect((await t.db.one<Row>(`select count(*)::int as n from record_links where from_type = 'control' and relation = 'covers'`))!.n).toBe(3);
    const again = ok(await lead.post('/api/controls/coverage/import', { fileName: 'coverage.csv', text, dryRun: false }));
    expect(again).toMatchObject({ added: 0, existing: 4 });
    // The restricted risk's coverage is in the risk's own history, never the control's.
    const riskAudit = await t.db.query<Row>(`select record_type, summary from audit_events where action = 'control.coverage_add' order by id`);
    expect(riskAudit.find((a) => a.record_type === 'risk')!.summary).toMatch(/Now covered by control/);
    expect(riskAudit.filter((a) => a.record_type === 'control').every((a) => !/network outage/.test(a.summary))).toBe(true);
    const whole = await t.db.query<Row>(`select summary from audit_events where action = 'control.coverage_import' order by id`);
    expect(whole).toHaveLength(2);
    expect(whole[0].summary).toMatch(/3 added, 1 already there, 3 with errors/);
  });

  it('matches only records the person may see, and says nothing more about the others', async () => {
    const control = (await lead.get(`/api/controls/${control2.id}`)).body;
    const text = csv([['Control', 'Record'], [control.ref, riskRef], [control.ref, hazard.ref]]);
    const seen = ok(await auditLead.post('/api/controls/coverage/import', { text }));
    // The restricted risk reads exactly as a record that does not exist; the hazard is found.
    expect(seen.results.map((r: Row) => r.outcome)).toEqual(['error', 'exists']); // the hazard is already covered
    expect(seen.results[0].message).toBe(`No record with the reference "${riskRef}" was found among the records you may see. Give its reference, or add the kind of record and use its title.`);
    expect(seen.results[0].record).toBeNull();
    expect((await auditor.post('/api/controls/coverage/import', { text })).status).toBe(403);
  });

  it('explains a file it cannot use, and offers a template', async () => {
    const bad = await lead.post('/api/controls/coverage/import', { text: 'Name,Value\r\nA,B\r\n' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/No column names the control/);
    const template = await auditor.get('/api/controls/coverage/import-template');
    expect(template.status).toBe(200);
    expect(template.text).toContain('Control,Kind of record,Record');
  });
});
