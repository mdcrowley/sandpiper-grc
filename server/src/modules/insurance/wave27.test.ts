// Insurance, wave 27: claim payments one by one (E46-62), the contract's insurance (E46-63), premium
// allocation and the property schedule of values (E46-64), and asking vendors for certificates of
// insurance by email with a personal upload link (E46-65). Invented data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef, Row } from '../../core/module.ts';
import { startSmtpSink, type SmtpSink } from '../../core/mail/smtp-sink.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { split } from './allocation.ts';
import { HOLD_TYPE } from './requests.ts';

let t: Awaited<ReturnType<typeof testApp>>;
let sink: SmtpSink;
// Stands in for the notifications module, which these tests do not load.
const notified: Row[] = [];
const notifyStub: ModuleDef = {
  key: 'testnotify',
  async register(ctx) {
    if (!ctx.app.hasDecorator('notify')) (ctx.app as any).decorate('notify', async (input: Row) => { notified.push(input); return { sent: 1, skipped: 0 }; });
  },
};
const before = process.env.GRC_MODULES;
const loadMode = (on: boolean) => (on
  ? t.db.query(`insert into settings (key, value) values ('data_load.mode', $1::jsonb) on conflict (key) do update set value = excluded.value`,
    [JSON.stringify({ until: new Date(Date.now() + 86_400_000).toISOString() })])
  : t.db.query(`delete from settings where key = 'data_load.mode'`));

beforeAll(async () => {
  process.env.GRC_MODULES = 'insurance,vendors,attachments,inventory,people,fleet';
  t = await testApp({ extraModules: [notifyStub] });
  sink = await startSmtpSink();
  await t.db.query('update sessions set confirmed_at = now()');
}, 120_000);
afterAll(async () => {
  await t?.close();
  await sink?.close();
  if (before === undefined) delete process.env.GRC_MODULES; else process.env.GRC_MODULES = before;
});

const ok = (res: { status: number; body: any }, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};

describe('claim payments one by one (E46-62)', () => {
  let claimId = '';
  it('lists each payment and recovery and works the claim totals out from them', async () => {
    const claim = ok(await t.api.post('/api/insurance/claims', { title: 'Invented depot gate struck', claim_kind: 'property_damage', incident_on: dayInZone(-30), reserve: 9000, paid: 777 }), 201);
    claimId = claim.id;
    // The totals are worked out, never typed.
    expect(Number(claim.paid ?? 0)).toBe(0);
    const bad = await t.api.post('/api/insurance/claim-payments', { claim_id: claimId, kind: 'repair', paid_on: dayInZone(-40), amount: 0 });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['amount', 'paid_on']);
    const p1 = ok(await t.api.post('/api/insurance/claim-payments', { claim_id: claimId, kind: 'repair', payee: 'Invented Gate Repairs', paid_on: dayInZone(-20), amount: 4200, reference: 'CHK-1' }), 201);
    expect(p1).toMatchObject({ title: 'Repair or replacement: Invented Gate Repairs', recorded_by_name: expect.any(String), restricted: false });
    ok(await t.api.post('/api/insurance/claim-payments', { claim_id: claimId, kind: 'expense', payee: 'Invented Adjusters', paid_on: dayInZone(-18), amount: 800 }), 201);
    const rec = ok(await t.api.post('/api/insurance/claim-payments', { claim_id: claimId, kind: 'subrogation', payee: 'Invented Carrier', paid_on: dayInZone(-5), amount: 3000 }), 201);
    let c = ok(await t.api.get(`/api/insurance/claims/${claimId}`));
    expect([Number(c.paid), Number(c.recovered)]).toEqual([5000, 3000]);
    // A change and a deletion are counted again.
    ok(await t.api.patch(`/api/insurance/claim-payments/${rec.id}`, { amount: 3500 }));
    ok(await t.api.del(`/api/insurance/claim-payments/${p1.id}`));
    c = ok(await t.api.get(`/api/insurance/claims/${claimId}`));
    expect([Number(c.paid), Number(c.recovered)]).toEqual([800, 3500]);
    // A payment stays with its claim; the list filters by claim and exports.
    const other = ok(await t.api.post('/api/insurance/claims', { title: 'Invented other claim', claim_kind: 'liability', incident_on: dayInZone(-3) }), 201);
    expect((await t.api.patch(`/api/insurance/claim-payments/${rec.id}`, { claim_id: other.id })).status).toBe(400);
    const list = ok(await t.api.get(`/api/insurance/claim-payments?f.claim_id=${claimId}`));
    expect(list.total).toBe(2);
    const csv = await t.api.get(`/api/insurance/claim-payments?f.claim_id=${claimId}&format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Invented Carrier');
    const s = ok(await t.api.get('/api/insurance/summary'));
    expect(s.claims).toMatchObject({ paid: 800, recovered: 3500 });
  });

  it('keeps the payments of a restricted claim from people who cannot see it, but counts them', async () => {
    const injury = ok(await t.api.post('/api/insurance/claims', { title: 'Invented passenger fall', claim_kind: 'bodily_injury', incident_on: dayInZone(-10) }), 201);
    expect(injury.restricted).toBe(true);
    const pay = ok(await t.api.post('/api/insurance/claim-payments', { claim_id: injury.id, kind: 'medical', payee: 'Invented Clinic', paid_on: dayInZone(-2), amount: 600 }), 201);
    expect(pay.restricted).toBe(true);
    const coord = await t.as('insurance_coordinator');
    expect((await coord.get(`/api/insurance/claim-payments/${pay.id}`)).status).toBe(404);
    expect((await coord.post('/api/insurance/claim-payments', { claim_id: injury.id, kind: 'medical', paid_on: dayInZone(-1), amount: 10 })).status).toBe(400);
    expect((await coord.get('/api/insurance/summary')).body.claims).toEqual((await t.api.get('/api/insurance/summary')).body.claims);
    // Lifting the claim's restriction lifts its payments'.
    ok(await t.api.patch(`/api/insurance/claims/${injury.id}`, { restricted: false }));
    expect((await coord.get(`/api/insurance/claim-payments/${pay.id}`)).status).toBe(200);
  });

  it('turns totals given in a data load into opening rows, recorded as the person named', async () => {
    await loadMode(true);
    const c = ok(await t.api.post('/api/insurance/claims', {
      title: 'Invented hail damage 2019', claim_kind: 'property_damage', status: 'closed', incident_on: '2019-08-02', reported_on: '2019-08-05', closed_on: '2020-01-15',
      paid: 12000, recovered: 9000,
    }), 201);
    expect([Number(c.paid), Number(c.recovered)]).toEqual([12000, 9000]);
    const rows = ok(await t.api.get(`/api/insurance/claim-payments?f.claim_id=${c.id}&sort=paid_on`)).rows;
    expect(rows.map((r: Row) => [r.kind, Number(r.amount), String(r.paid_on).slice(0, 10)])).toEqual([
      ['opening_paid', 12000, '2019-08-05'], ['opening_recovery', 9000, '2020-01-15'],
    ]);
    const named = ok(await t.api.post('/api/insurance/claim-payments', {
      claim_id: c.id, kind: 'expense', paid_on: '2019-09-01', amount: 150, created_at: '2019-09-01T10:00:00Z', on_behalf_of: 'admin',
    }), 201);
    expect(named.recorded_by).toBeTruthy();
    expect(String(named.created_at).slice(0, 10)).toBe('2019-09-01');
    await loadMode(false);
  });
});

describe('premium allocation (E46-64)', () => {
  it('splits a premium so the cents add up', () => {
    const parts = split(100, [1, 1, 1], false);
    expect(parts.map((p) => p.amount).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    expect(parts.map((p) => p.share_pct)).toEqual([33.3333, 33.3333, 33.3333]);
    expect(split(1000, [60, 30], true).map((p) => p.amount)).toEqual([600, 300]);
    expect(split(500, [0, 0], false).map((p) => p.amount)).toEqual([0, 0]);
  });

  let policyId = '';
  let sites: string[] = [];
  let deptId = '';
  it('splits equally, by a measure, by hand and by insured value, and follows premium changes', async () => {
    const p = ok(await t.api.post('/api/insurance/policies', { title: 'Invented property program', line: 'property', premium: 90000, effective_on: dayInZone(-10), expires_on: dayInZone(355) }), 201);
    policyId = p.id;
    sites = [];
    for (const n of ['Invented East Depot', 'Invented West Depot', 'Invented Harbor Station']) sites.push(ok(await t.api.post('/api/sites', { name: n }), 201).id);
    deptId = ok(await t.api.post('/api/departments', { name: 'Invented Maintenance' }), 201).id;

    // One target per share, never twice.
    expect((await t.api.post('/api/insurance/premium-shares', { policy_id: policyId })).status).toBe(400);
    expect((await t.api.post('/api/insurance/premium-shares', { policy_id: policyId, site_id: sites[0], department_id: deptId })).status).toBe(400);
    const a = ok(await t.api.post('/api/insurance/premium-shares', { policy_id: policyId, site_id: sites[0], measure: 30, percent: 50 }), 201);
    expect(a.title).toBe('Invented East Depot');
    expect((await t.api.post('/api/insurance/premium-shares', { policy_id: policyId, site_id: sites[0] })).status).toBe(400);
    const b = ok(await t.api.post('/api/insurance/premium-shares', { policy_id: policyId, site_id: sites[1], measure: 10, percent: 30 }), 201);
    const c = ok(await t.api.post('/api/insurance/premium-shares', { policy_id: policyId, department_id: deptId, measure: 20 }), 201);
    const amounts = async () => {
      const rows = ok(await t.api.get(`/api/insurance/premium-shares?f.policy_id=${policyId}`)).rows as Row[];
      return [a, b, c].map((x) => Number(rows.find((r) => r.id === x.id)!.amount));
    };
    // Equally (the default).
    expect(await amounts()).toEqual([30000, 30000, 30000]);
    // By a measure.
    ok(await t.api.patch(`/api/insurance/policies/${policyId}`, { allocation_method: 'measure', allocation_measure: 'Vehicles' }));
    expect(await amounts()).toEqual([45000, 15000, 30000]);
    // By hand: what is not given is not allocated; more than 100% is refused.
    ok(await t.api.patch(`/api/insurance/policies/${policyId}`, { allocation_method: 'manual' }));
    expect(await amounts()).toEqual([45000, 27000, 0]);
    const over = await t.api.patch(`/api/insurance/premium-shares/${c.id}`, { percent: 25 });
    expect(over.status).toBe(400);
    expect(over.body.error.fields.percent).toMatch(/more than 100%/);
    const summary = ok(await t.api.get(`/api/insurance/policies/${policyId}/allocation`));
    expect(summary).toMatchObject({ method: 'manual', premium: 90000, allocated: 72000, unallocated: 18000, allocated_pct: 80 });
    // The premium changes: the shares follow.
    ok(await t.api.patch(`/api/insurance/policies/${policyId}`, { premium: 100000 }));
    expect(await amounts()).toEqual([50000, 30000, 0]);

    // By insured value: from the schedule of values of this policy.
    ok(await t.api.post('/api/insurance/schedule', { title: 'Invented East Depot buildings', policy_id: policyId, site_id: sites[0], building_value: 600000, contents_value: 150000 }), 201);
    ok(await t.api.post('/api/insurance/schedule', { title: 'Invented West Depot shop', policy_id: policyId, site_id: sites[1], building_value: 250000 }), 201);
    ok(await t.api.post('/api/insurance/schedule', { title: 'Invented maintenance equipment', policy_id: policyId, department_id: deptId, equipment_value: 0 }), 201);
    ok(await t.api.patch(`/api/insurance/policies/${policyId}`, { allocation_method: 'insured_value' }));
    expect(await amounts()).toEqual([75000, 25000, 0]);
    // A new value on the schedule moves the split.
    const eq = ok(await t.api.get(`/api/insurance/schedule?f.department_id=${deptId}`)).rows[0];
    ok(await t.api.patch(`/api/insurance/schedule/${eq.id}`, { equipment_value: 1000000 }));
    expect(await amounts()).toEqual([37500, 12500, 50000]);
  });

  it('sums premiums by department or site across policies in force, the same for everyone, and downloads them', async () => {
    const by = ok(await t.api.get('/api/insurance/allocation?by=site'));
    expect(by.rows.find((r: Row) => r.target_id === sites[0])).toMatchObject({ label: 'Invented East Depot', amount: 37500, lines: { property: 37500 } });
    const dept = ok(await t.api.get('/api/insurance/allocation?by=department'));
    expect(dept.rows[0]).toMatchObject({ target_id: deptId, amount: 50000 });
    const coord = await t.as('insurance_coordinator');
    expect((await coord.get('/api/insurance/allocation?by=site')).body.rows).toEqual(by.rows);
    const csv = await t.api.get('/api/insurance/allocation?by=site&format=csv');
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Invented East Depot,37500.00');
  });

  it('adds covered records to the shares and the schedule in one step, and carries shares into a renewal', async () => {
    const p = ok(await t.api.post('/api/insurance/policies', { title: 'Invented fleet policy', line: 'auto_liability', premium: 1000, effective_on: dayInZone(-10), expires_on: dayInZone(355) }), 201);
    for (const s of sites) ok(await t.api.post(`/api/insurance/policies/${p.id}/covered`, { record_type: 'site', record_id: s }), 201);
    expect(ok(await t.api.post(`/api/insurance/policies/${p.id}/allocation/from-covered`, {}), 201)).toEqual({ added: 3, skipped: 0 });
    expect(ok(await t.api.post(`/api/insurance/policies/${p.id}/allocation/from-covered`, {}), 201)).toEqual({ added: 0, skipped: 3 });
    expect(ok(await t.api.post(`/api/insurance/policies/${p.id}/schedule/from-covered`, {}), 201)).toEqual({ added: 3, skipped: 0 });
    const next = ok(await t.api.post(`/api/insurance/policies/${p.id}/renew`, { premium: 1200 }), 201);
    const shares = ok(await t.api.get(`/api/insurance/premium-shares?f.policy_id=${next.id}`)).rows as Row[];
    expect(shares.length).toBe(3);
    expect(shares.map((s) => Number(s.amount)).reduce((x, y) => x + y, 0)).toBeCloseTo(1200, 6);
  });
});

describe('the property schedule of values (E46-64)', () => {
  it('works out the total insured value, checks the values and gives the summary', async () => {
    const bad = await t.api.post('/api/insurance/schedule', { title: 'Invented shed', building_value: -1, year_built: 12 });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['building_value', 'year_built']);
    const item = ok(await t.api.post('/api/insurance/schedule', {
      title: 'Invented bus wash', building_value: 100000, contents_value: 2500.5, equipment_value: 40000, income_value: 10000, valued_on: dayInZone(-2000), year_built: 2001,
    }), 201);
    expect(item).toMatchObject({ ref: expect.stringMatching(/^SOV-/), total_value: 152500.5 });
    const changed = ok(await t.api.patch(`/api/insurance/schedule/${item.id}`, { income_value: 0 }));
    expect(Number(changed.total_value)).toBe(142500.5);
    const s = ok(await t.api.get('/api/insurance/schedule/summary'));
    expect(s.items).toBeGreaterThanOrEqual(1);
    expect(s.valuation_due).toBeGreaterThanOrEqual(1);
    const xlsx = await t.api.get('/api/insurance/schedule?format=xlsx');
    expect(xlsx.status).toBe(200);
  });
});

describe('certificate requests by email (E46-65)', () => {
  let vendorId = '';
  let contractId = '';
  let requestId = '';
  let token = '';
  const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
  const pub = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, opts: { body?: unknown; file?: Buffer; token?: string; ip?: string } = {}) => t.app.inject({
    method, url,
    headers: {
      'x-grc-csrf': '1', 'x-upload-token': opts.token ?? token, 'x-forwarded-for': opts.ip ?? '198.51.100.30',
      ...(opts.file ? { 'content-type': 'application/octet-stream' } : opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    payload: opts.file ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });

  beforeAll(async () => {
    vendorId = ok(await t.api.post('/api/vendors', { name: 'Invented Paving Contractor' }), 201).id;
    contractId = ok(await t.api.post('/api/contracts', { title: 'Invented paving contract', vendor_id: vendorId }), 201).id;
    ok(await t.api.post('/api/insurance/requirements', { contract_id: contractId, line: 'general_liability', min_per_occurrence: 1000000, additional_insured: true }), 201);
    ok(await t.api.post('/api/insurance/requirements', { contract_id: contractId, line: 'auto_liability', min_per_occurrence: 500000 }), 201);
  });

  it('makes a request from the contract with the lines it requires', async () => {
    const r = ok(await t.api.post('/api/insurance/certificate-requests', { contract_id: contractId, email: 'Insurance@Paving.example', needed_by: dayInZone(14) }), 201);
    expect(r).toMatchObject({ ref: expect.stringMatching(/^CIR-/), vendor_id: vendorId, status: 'draft', email: 'insurance@paving.example', title: 'Certificates of insurance from Invented Paving Contractor' });
    expect([...r.lines].sort()).toEqual(['auto_liability', 'general_liability']);
    expect(r.token_hash).toBeUndefined();
    expect(r.token_sealed).toBeUndefined();
    requestId = r.id;
    expect((await t.api.post('/api/insurance/certificate-requests', { email: 'x@y.example' })).body.error.fields.vendor_id).toBeTruthy();
    expect((await t.api.post('/api/insurance/certificate-requests', { vendor_id: vendorId, email: 'not an address' })).body.error.fields.email).toBeTruthy();
  });

  it('sends only when requests are switched on and email is set up', async () => {
    let r = await t.api.post(`/api/insurance/certificate-requests/${requestId}/send`, {});
    expect([r.status, r.body.error.code]).toEqual([409, 'disabled']);
    ok(await t.api.put('/api/insurance/certificate-requests/settings', { enabled: true, days: 10 }));
    r = await t.api.post(`/api/insurance/certificate-requests/${requestId}/send`, {});
    expect([r.status, r.body.error.code]).toEqual([409, 'email_off']);
    ok(await t.api.put('/api/admin/mail/settings', { enabled: true, host: '127.0.0.1', port: sink.port, tlsMode: 'none', fromAddress: 'grc@example.test', baseUrl: 'https://grc.example.test' }));
    const coordAgent = await t.as('agent');
    expect((await coordAgent.post(`/api/insurance/certificate-requests/${requestId}/send`, {})).status).toBe(403);
  });

  it('emails a personal link that is nowhere else in the clear', async () => {
    const before = sink.messages.length;
    const sent = ok(await t.api.post(`/api/insurance/certificate-requests/${requestId}/send`, {}));
    expect(sent).toMatchObject({ status: 'sent' });
    expect(sent.link_expires_at).toBeTruthy();
    expect(JSON.stringify(sent)).not.toMatch(/certificate-upload#/);
    const job = await t.db.one<Row>(`select j.id, j.payload::text as payload from jobs j join mail_log m on m.job_id = j.id where m.to_address = 'insurance@paving.example' order by m.created_at desc limit 1`);
    expect(job!.payload).not.toMatch(/certificate-upload#/);
    await t.db.query(`update jobs set run_at = now() - interval '1 second' where id = $1`, [job!.id]);
    await t.app.jobs.runDue({ types: ['mail.send'] });
    await sink.waitFor(before + 1);
    const m = sink.messages[before];
    expect(m.to).toEqual(['insurance@paving.example']);
    expect(m.body).toContain('General liability');
    const found = /https:\/\/grc\.example\.test\/certificate-upload#([A-Za-z0-9_-]{43})/.exec(m.body.replace(/=\r?\n/g, ''));
    expect(found).not.toBeNull();
    token = found![1];
    const audit = await t.db.query<Row>(`select summary, after::text as after from audit_events where record_id = $1`, [requestId]);
    expect(JSON.stringify(audit)).not.toContain(token);
  });

  it('refuses a wrong or missing link the same way', async () => {
    const none = await pub('GET', '/api/insurance/certificate-upload', { token: '' });
    const wrong = await pub('GET', '/api/insurance/certificate-upload', { token: 'A'.repeat(43) });
    expect([none.statusCode, wrong.statusCode]).toEqual([404, 404]);
    expect(JSON.parse(wrong.body).error.message).toBe(JSON.parse(none.body).error.message);
  });

  it('lets the vendor send each certificate with its file, which lands for review', async () => {
    const view = JSON.parse((await pub('GET', '/api/insurance/certificate-upload')).body);
    expect(view).toMatchObject({ vendor_name: 'Invented Paving Contractor', contract_title: 'Invented paving contract', submitted_at: null });
    expect(view.lines.find((l: Row) => l.line === 'general_liability')).toMatchObject({ min_per_occurrence: 1000000, additional_insured: true });
    expect(view.upload.available).toBe(true);
    expect((await t.api.get(`/api/insurance/certificate-requests/${requestId}`)).body.opened_at).toBeTruthy();

    const refused = await pub('PUT', '/api/insurance/certificate-upload/files?name=run.exe', { file: PDF });
    expect(refused.statusCode).toBe(415);
    const up = await pub('PUT', '/api/insurance/certificate-upload/files?name=gl-certificate.pdf', { file: PDF });
    expect(up.statusCode, up.body).toBe(201);
    const file = JSON.parse(up.body);
    // Waiting files are on no record.
    expect((await t.db.one<Row>('select record_type from attachments where id = $1', [file.id]))!.record_type).toBe(HOLD_TYPE);

    const missing = await pub('POST', '/api/insurance/certificate-upload/certificates', { body: { line: 'general_liability' } });
    expect(missing.statusCode).toBe(400);
    expect(Object.keys(JSON.parse(missing.body).error.fields).sort()).toEqual(['expires_on', 'file_id', 'insurer_name', 'responder_name']);
    const sent = await pub('POST', '/api/insurance/certificate-upload/certificates', {
      body: {
        file_id: file.id, line: 'general_liability', insurer_name: 'Invented Casualty Co', policy_number: 'GL-9', effective_on: dayInZone(-5), expires_on: dayInZone(360),
        limit_per_occurrence: '1,000,000', limit_aggregate: 2000000, additional_insured: true, responder_name: 'Invented Broker',
      },
    });
    expect(sent.statusCode, sent.body).toBe(201);
    expect(JSON.parse(sent.body).certificates).toHaveLength(1);
    const cert = (await t.db.one<Row>(`select * from insurance_certificates where request_id = $1`, [requestId]))!;
    expect(cert).toMatchObject({ status: 'to_review', vendor_id: vendorId, contract_id: contractId, line: 'general_liability' });
    // To review: not yet counted as on file.
    expect(cert.check_result ?? 'none').toBe('none');
    expect((await t.db.one<Row>('select record_type, record_id, kind from attachments where id = $1', [file.id]))).toMatchObject({ record_type: 'insurance_certificate', record_id: cert.id, kind: 'evidence' });
    expect(notified.some((n) => n.recordId === cert.id)).toBe(true);
    expect(ok(await t.api.get('/api/insurance/summary')).certificates).toMatchObject({ to_review: 1, requests_open: 1 });

    // Accepted by staff, it is checked against the contract.
    const accepted = ok(await t.api.patch(`/api/insurance/certificates/${cert.id}`, { status: 'accepted' }));
    expect(accepted.status).toBe('accepted');
    const check = ok(await t.api.get(`/api/insurance/contracts/${contractId}/check`));
    expect(check.requirements.find((r: Row) => r.line === 'general_liability').state).toBe('met');
    expect(check.requests[0]).toMatchObject({ id: requestId, status: 'sent', certificates: 1 });
  });

  it('reminds the vendor with the same link, once per step', async () => {
    const before = sink.messages.length;
    ok(await t.api.post(`/api/insurance/certificate-requests/${requestId}/remind`, {}));
    await t.db.query(`update jobs set run_at = now() - interval '1 second' where type = 'mail.send' and status = 'queued'`);
    await t.app.jobs.runDue({ types: ['mail.send'] });
    await sink.waitFor(before + 1);
    expect(sink.messages[before].subject).toMatch(/^Reminder: /);
    expect(sink.messages[before].body.replace(/=\r?\n/g, '')).toContain(`certificate-upload#${token}`);
    const r = ok(await t.api.get(`/api/insurance/certificate-requests/${requestId}`));
    expect(r.reminders).toBe(1);
    // The link still works after a reminder.
    expect((await pub('GET', '/api/insurance/certificate-upload')).statusCode).toBe(200);
  });

  it('closes the link once the vendor is done', async () => {
    const done = await pub('POST', '/api/insurance/certificate-upload/done', { body: { responder_name: 'Invented Broker' } });
    expect(done.statusCode, done.body).toBe(200);
    expect(JSON.parse(done.body).done).toBe(true);
    expect((await pub('GET', '/api/insurance/certificate-upload')).statusCode).toBe(404);
    const r = ok(await t.api.get(`/api/insurance/certificate-requests/${requestId}`));
    expect(r).toMatchObject({ status: 'received', responder_name: 'Invented Broker' });
    expect(r.submitted_at).toBeTruthy();
  });

  it('stops every link when requests are switched off, and when a request is canceled', async () => {
    const r = ok(await t.api.post('/api/insurance/certificate-requests', { vendor_id: vendorId, email: 'second@paving.example', lines: ['property'] }), 201);
    ok(await t.api.post(`/api/insurance/certificate-requests/${r.id}/send`, {}));
    const hashed = (await t.db.one<Row>('select token_hash, token_sealed from insurance_certificate_requests where id = $1', [r.id]))!;
    expect(hashed.token_hash).toBeTruthy();
    ok(await t.api.patch(`/api/insurance/certificate-requests/${r.id}`, { status: 'canceled' }));
    expect((await t.db.one<Row>('select token_hash from insurance_certificate_requests where id = $1', [r.id]))!.token_hash).toBeNull();
    const r2 = ok(await t.api.post('/api/insurance/certificate-requests', { vendor_id: vendorId, email: 'third@paving.example' }), 201);
    ok(await t.api.post(`/api/insurance/certificate-requests/${r2.id}/send`, {}));
    ok(await t.api.put('/api/insurance/certificate-requests/settings', { enabled: false }));
    expect((await t.db.one<Row>('select token_hash from insurance_certificate_requests where id = $1', [r2.id]))!.token_hash).toBeNull();
  });

  it('sends nothing in a data load, which keeps the request as given', async () => {
    ok(await t.api.put('/api/insurance/certificate-requests/settings', { enabled: true }));
    await loadMode(true);
    const r = ok(await t.api.post('/api/insurance/certificate-requests', { vendor_id: vendorId, email: 'old@paving.example', status: 'received', created_at: '2024-03-01T09:00:00Z' }), 201);
    expect(r.status).toBe('received');
    const send = await t.api.post(`/api/insurance/certificate-requests/${r.id}/send`, {});
    expect([send.status, send.body.error.code]).toEqual([409, 'data_load']);
    await loadMode(false);
  });
});
