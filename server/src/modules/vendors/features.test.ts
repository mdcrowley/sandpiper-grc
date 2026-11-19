// Tests for the later vendor features: bulk checklist edits, the missing-dates queue, reminder
// settings and delivery, evidence reminders, value by year, the assessment questionnaire, and
// files on contracts and evidence. Invented data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE, createSession } from '../../core/auth.ts';
import { testApp } from '../../test/helpers.ts';
import { DEFAULT_QUESTIONS, gapsOf, parseQuestions, scoreAnswers } from './assessments.ts';
import { addDays, displayDate, localDate } from './dates.ts';
import { parseThresholds, runContractReminders, runEvidenceReminders } from './reminders.ts';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const today = localDate();
const vendor = async (name: string, extra: Record<string, unknown> = {}) => (await t.api.post('/api/vendors', { name, ...extra })).body.id as string;
const notificationsFor = async (userId: string, recordId: string) =>
  t.db.query<{ title: string; body: string; kind: string }>('select title, body, kind from notifications where user_id = $1 and record_id = $2', [userId, recordId]);

describe('security terms in bulk', () => {
  it('marks the clauses not yet assessed as absent, each audited, and leaves the others alone', async () => {
    const v = await vendor('Ivy Bridge Hosting');
    const c = (await t.api.post('/api/contracts', { title: 'Ivy hosting', vendor_id: v })).body.id;
    await t.api.patch(`/api/contracts/${c}/clauses/mfa`, { status: 'present', clause_text: 'Required for all staff.' });

    expect((await t.api.post(`/api/contracts/${c}/clauses/bulk`, { status: 'maybe' })).status).toBe(400);
    const res = await t.api.post(`/api/contracts/${c}/clauses/bulk`, { status: 'absent' });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(8);
    expect(res.body.clauses.find((x: any) => x.clause_key === 'mfa')).toMatchObject({ status: 'present', clause_text: 'Required for all staff.' });
    expect(res.body.clauses.filter((x: any) => x.status === 'absent')).toHaveLength(8);
    // Running it again changes nothing.
    expect((await t.api.post(`/api/contracts/${c}/clauses/bulk`, { status: 'absent' })).body.changed).toBe(0);
    const events = (await t.api.get(`/api/history?record_type=contract&record_id=${c}`)).body.filter((h: any) => h.action === 'contract.clause_check');
    expect(events).toHaveLength(9);

    const all = await t.api.post(`/api/contracts/${c}/clauses/bulk`, { status: 'partial', scope: 'all' });
    expect(all.body.changed).toBe(9);
    expect((await (await t.as('agent')).post(`/api/contracts/${c}/clauses/bulk`, { status: 'absent' })).status).toBe(403);

    const overview = await t.api.get('/api/vendors/overview');
    expect(overview.body.vendors[v]).toMatchObject({ contracts: 1, notice_date: null, terms: { present: 0, partial: 9, absent: 0, not_assessed: 0 } });
  });
});

describe('contract value by year', () => {
  it('stores a year-and-amount map and rejects anything else', async () => {
    const v = await vendor('Juniper Print');
    const made = await t.api.post('/api/contracts', { title: 'Juniper print', vendor_id: v, total_value: 30000, value_by_year: { 2031: 10000, 2032: 20000.5 } });
    expect(made.status).toBe(201);
    expect(made.body.value_by_year).toEqual({ 2031: 10000, 2032: 20000.5 });
    const upd = await t.api.patch(`/api/contracts/${made.body.id}`, { value_by_year: { 2031: 10000, 2032: 20000, 2033: 500 }, total_value: 30500 });
    expect(upd.body.total_value).toBe(30500);
    expect(Object.keys(upd.body.value_by_year)).toEqual(['2031', '2032', '2033']);
    expect((await t.api.patch(`/api/contracts/${made.body.id}`, { value_by_year: { 31: 5 } })).status).toBe(400);
    expect((await t.api.patch(`/api/contracts/${made.body.id}`, { value_by_year: { 2031: '5' } })).status).toBe(400);
    const cleared = await t.api.patch(`/api/contracts/${made.body.id}`, { value_by_year: null });
    expect(cleared.body.value_by_year).toBeNull();
  });
});

describe('contracts with missing dates', () => {
  it('lists open contracts with no end date or notice period, with the text as recorded', async () => {
    const v = await vendor('Kestrel Fibre');
    const mk = async (title: string, extra: Record<string, unknown>) => (await t.api.post('/api/contracts', { title, vendor_id: v, ...extra })).body.id as string;
    const nothing = await mk('Kestrel nothing', { term_and_renewal: 'Three years from signature; 60 days notice.' });
    const noNotice = await mk('Kestrel no notice', { end_date: addDays(today, 400) });
    const complete = await mk('Kestrel complete', { end_date: addDays(today, 400), notice_days: 30 });
    const evergreen = await mk('Kestrel rolling', { renewal_mechanism: 'evergreen', notice_days: 30 });
    const ended = await mk('Kestrel ended', { status: 'terminated' });

    const res = await t.api.get('/api/contracts/missing-dates');
    expect(res.status).toBe(200);
    const byId = new Map<string, any>(res.body.rows.map((r: any) => [r.id, r]));
    expect(byId.get(nothing)).toMatchObject({ missing: ['end_date', 'notice_days'], term_and_renewal: 'Three years from signature; 60 days notice.', vendor_name: 'Kestrel Fibre' });
    expect(byId.get(noNotice).missing).toEqual(['notice_days']);
    expect(byId.has(complete)).toBe(false);
    expect(byId.has(evergreen)).toBe(false);
    expect(byId.has(ended)).toBe(false);

    // Filling in the dates takes the contract out of the queue.
    await t.api.patch(`/api/contracts/${nothing}`, { end_date: addDays(today, 700), notice_days: 60 });
    const after = await t.api.get('/api/contracts/missing-dates');
    expect(after.body.rows.some((r: any) => r.id === nothing)).toBe(false);
    expect((await (await t.as('requester')).get('/api/contracts/missing-dates')).status).toBe(403);

    // The calendar still reports contracts it cannot place.
    const cal = await t.api.get('/api/contracts/renewals');
    expect(cal.body.undated.map((c: any) => c.id)).toContain(evergreen);
    expect(cal.body.can_administer).toBe(true);
  });
});

describe('reminder settings', () => {
  it('validates lists of days', () => {
    expect(parseThresholds([30, 90, '60'])).toEqual({ days: [90, 60, 30] });
    expect(parseThresholds([])).toHaveProperty('error');
    expect(parseThresholds([30, 30])).toHaveProperty('error');
    expect(parseThresholds([1.5])).toHaveProperty('error');
    expect(parseThresholds([0])).toHaveProperty('error');
    expect(parseThresholds('30')).toHaveProperty('error');
  });

  it('shows, changes and audits the reminder days, for people who may administer contracts', async () => {
    const before = await t.api.get('/api/contracts/reminder-settings');
    expect(before.body).toMatchObject({ contract_days: [120, 90, 60, 30], evidence_days: [60, 30, 7], can_edit: true });
    const agent = await t.as('agent');
    expect((await agent.get('/api/contracts/reminder-settings')).body.can_edit).toBe(false);
    expect((await agent.patch('/api/contracts/reminder-settings', { contract_days: [10] })).status).toBe(403);

    const bad = await t.api.patch('/api/contracts/reminder-settings', { contract_days: [90, 'soon'], evidence_days: [] });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['contract_days', 'evidence_days']);

    const changes = async () => (await t.db.query(
      `select 1 from audit_events where action = 'setting.change' and record_id = 'contracts.reminder_days'`)).length;
    const audited = await changes();
    const ok = await t.api.patch('/api/contracts/reminder-settings', { contract_days: [45, 180, 90] });
    expect(ok.body.contract_days).toEqual([180, 90, 45]);
    expect((await t.api.get('/api/contracts/renewals')).body.thresholds).toEqual([180, 90, 45]);
    expect(await changes()).toBe(audited + 1);
    // Saving the same list again is not a change.
    await t.api.patch('/api/contracts/reminder-settings', { contract_days: [180, 90, 45] });
    expect(await changes()).toBe(audited + 1);
    await t.api.patch('/api/contracts/reminder-settings', { contract_days: [120, 90, 60, 30] });
  });
});

describe('reminders reach people', () => {
  const noon = (date: string) => new Date(`${date}T17:00:00Z`);

  it('tells the contract owner and people who may edit contracts, once per threshold', async () => {
    const lead = await t.as('security_lead'); // contracts.*
    const owner = await t.as('agent');        // contracts.view only: told because they own the contract
    const bystander = await t.as('agent');
    const v = await vendor('Larch Lane Telecom');
    const owned = (await t.api.post('/api/contracts', { title: 'Larch lines', vendor_id: v, end_date: '2050-08-28', notice_days: 60, owner_id: owner.userId })).body;
    const unowned = (await t.api.post('/api/contracts', { title: 'Larch support', vendor_id: v, end_date: '2050-08-28', notice_days: 60 })).body;
    expect(owned.notice_date).toBe('2050-06-29');

    const fired = (await runContractReminders(t.ctx, noon('2050-03-01'))).filter((f) => [owned.id, unowned.id].includes(f.contract_id));
    expect(fired.map((f) => f.threshold_days)).toEqual([120, 120]);
    expect((await t.api.get(`/api/contracts/${owned.id}/reminders`)).body.thresholds).toEqual([120, 90, 60, 30]);

    if (!t.app.hasDecorator('notify')) {
      // Notifications module not loaded: the reminder is still an audit event and nobody is told.
      expect(fired.every((f) => f.notified === 0)).toBe(true);
      return;
    }
    expect(fired.every((f) => f.notified >= 2)).toBe(true);
    const toOwner = await notificationsFor(owner.userId, owned.id);
    expect(toOwner).toHaveLength(1);
    expect(toOwner[0].kind).toBe('reminder');
    expect(toOwner[0].title).toMatch(/Notice date in 120 days: CON-\d+ Larch lines/);
    expect(toOwner[0].body).toContain(displayDate('2050-06-29'));
    expect(await notificationsFor(lead.userId, owned.id)).toHaveLength(1);
    // A contract with no owner still reaches the people who look after contracts.
    expect(await notificationsFor(lead.userId, unowned.id)).toHaveLength(1);
    expect(await notificationsFor(owner.userId, unowned.id)).toHaveLength(0);
    expect(await notificationsFor(bystander.userId, owned.id)).toHaveLength(0);

    // Nothing more until the next threshold.
    await runContractReminders(t.ctx, noon('2050-03-20'));
    expect(await notificationsFor(owner.userId, owned.id)).toHaveLength(1);
    await runContractReminders(t.ctx, noon('2050-03-31'));
    expect(await notificationsFor(owner.userId, owned.id)).toHaveLength(2);
  });

  it('reminds about evidence before it expires, once per threshold, and re-arms when the date moves', async () => {
    const lead = await t.as('security_lead'); // vendors.*
    const v = await vendor('Maple Assurance');
    const item = (await t.api.post('/api/evidence', { title: 'Maple assurance report', vendor_id: v, type: 'assurance_report', expires_on: '2051-06-30' })).body;
    const old = (await t.api.post('/api/evidence', { title: 'Maple old certificate', vendor_id: v, expires_on: '2049-01-01' })).body;
    const mine = (list: Awaited<ReturnType<typeof runEvidenceReminders>>) => list.filter((f) => f.evidence_id === item.id);
    const events = async () => (await t.api.get(`/api/history?record_type=evidence_item&record_id=${item.id}`)).body.filter((h: any) => h.action === 'evidence.reminder');

    expect(mine(await runEvidenceReminders(t.ctx, noon('2051-04-01')))).toEqual([]);
    const first = await runEvidenceReminders(t.ctx, noon('2051-05-01')); // 60 days before
    expect(mine(first).map((f) => f.threshold_days)).toEqual([60]);
    // Evidence that ran out long ago is not announced.
    expect(first.some((f) => f.evidence_id === old.id)).toBe(false);
    expect(mine(await runEvidenceReminders(t.ctx, noon('2051-05-02')))).toEqual([]);
    expect(mine(await runEvidenceReminders(t.ctx, noon('2051-06-25'))).map((f) => f.threshold_days)).toEqual([7]); // 30 superseded
    expect(await events()).toHaveLength(2);
    expect((await events())[0].summary).toMatch(/Maple assurance report from Maple Assurance expires in 5 days/);

    await t.api.patch(`/api/evidence/${item.id}`, { expires_on: '2052-06-30' });
    expect(mine(await runEvidenceReminders(t.ctx, noon('2051-07-01')))).toEqual([]);
    expect(mine(await runEvidenceReminders(t.ctx, noon('2052-06-01'))).map((f) => f.threshold_days)).toEqual([30]);

    if (t.app.hasDecorator('notify')) {
      const got = await notificationsFor(lead.userId, item.id);
      expect(got).toHaveLength(3);
      expect(got.map((n) => n.kind)).toEqual(['reminder', 'reminder', 'reminder']);
      expect(got.some((n) => /Evidence expires in 60 days: Maple assurance report \(Maple Assurance\)/.test(n.title))).toBe(true);
    } else {
      expect(mine(first)[0].notified).toBe(0);
    }
  });
});

describe('vendor assessment questionnaire', () => {
  it('scores and validates as pure functions', () => {
    const qs = [
      { key: 'a', section: null, text: 'A', guidance: null, weight: 3 },
      { key: 'b', section: null, text: 'B', guidance: null, weight: 1 },
      { key: 'c', section: null, text: 'C', guidance: null, weight: 2 },
    ];
    expect(scoreAnswers(qs, { a: { answer: 'yes' }, b: { answer: 'no' }, c: { answer: 'partial' } })).toBe(67); // (3 + 0 + 1) / 6
    expect(scoreAnswers(qs, { a: { answer: 'yes' }, b: { answer: 'na' }, c: { answer: 'na' } })).toBe(100);
    expect(scoreAnswers(qs, { a: { answer: 'na' } })).toBeNull();
    expect(gapsOf(qs, { a: { answer: 'partial' }, b: { answer: 'no' }, c: { answer: 'yes' } }).map((g) => g.key)).toEqual(['a', 'b']);
    expect(parseQuestions([{ text: ' One ', weight: 2 }, { text: 'Two', key: 'kept' }])).toEqual({
      questions: [
        { key: 'q1', section: null, text: 'One', guidance: null, weight: 2 },
        { key: 'kept', section: null, text: 'Two', guidance: null, weight: 1 },
      ],
    });
    expect(parseQuestions([{ text: '' }])).toHaveProperty('error');
    expect(parseQuestions([{ text: 'x', weight: 9 }])).toHaveProperty('error');
    expect(parseQuestions([])).toHaveProperty('error');
  });

  it('keeps question sets as versions', async () => {
    const first = await t.api.get('/api/vendors/question-sets');
    expect(first.body.active).toMatchObject({ version: 1 });
    expect(first.body.active.questions).toHaveLength(DEFAULT_QUESTIONS.length);
    expect((await (await t.as('agent')).post('/api/vendors/question-sets', { questions: [{ text: 'x' }] })).status).toBe(403);
    expect((await t.api.post('/api/vendors/question-sets', { questions: [{ text: '' }] })).status).toBe(400);
  });

  it('records answers, scores the result, keeps history and saves evidence', async () => {
    const v = await vendor('Nettle Cloud');
    const agent = await t.as('agent');
    expect((await agent.post(`/api/vendors/${v}/assessments`)).status).toBe(403);

    const started = await t.api.post(`/api/vendors/${v}/assessments`);
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({ status: 'draft', version: 1, answered: 0, total: DEFAULT_QUESTIONS.length, score: null });
    const id = started.body.id;
    // Starting again carries on with the same draft.
    expect((await t.api.post(`/api/vendors/${v}/assessments`)).body.id).toBe(id);

    expect((await t.api.patch(`/api/vendor-assessments/${id}`, { answers: { made_up: { answer: 'yes' } } })).status).toBe(400);
    expect((await t.api.patch(`/api/vendor-assessments/${id}`, { answers: { mfa: { answer: 'perhaps' } } })).status).toBe(400);
    const one = await t.api.patch(`/api/vendor-assessments/${id}`, { answers: { mfa: { answer: 'no', note: 'Password only for support staff.' } } });
    expect(one.body).toMatchObject({ answered: 1, gaps: 1 });
    // Not every question is answered yet.
    const early = await t.api.post(`/api/vendor-assessments/${id}/complete`);
    expect(early.status).toBe(400);
    expect(early.body.error.message).toMatch(/11 questions have no answer/);

    const answers: Record<string, unknown> = {};
    for (const q of DEFAULT_QUESTIONS) answers[q.key] = { answer: 'yes' };
    answers.mfa = { answer: 'no' };
    answers.backups = { answer: 'partial', note: 'Restores not tested.' };
    answers.staff_training = { answer: 'na' };
    await t.api.patch(`/api/vendor-assessments/${id}`, { answers, notes: 'Completed on a call with their service manager.' });

    expect((await t.api.post(`/api/vendor-assessments/${id}/complete`, { assessed_on: addDays(today, 3) })).status).toBe(400);
    const done = await t.api.post(`/api/vendor-assessments/${id}/complete`, { assessed_on: today, save_evidence: true, evidence_expires_on: addDays(today, 365) });
    expect(done.status).toBe(200);
    // Weights: total 26, less training (1) = 25; lost mfa (3) and half of backups (1) -> 21 / 25.
    expect(done.body).toMatchObject({ status: 'completed', assessed_on: today, score: 84, gaps: 2 });
    expect(done.body.gap_list.map((g: any) => g.key)).toEqual(['mfa', 'backups']);
    expect(done.body.gap_list[0].note).toBe('Password only for support staff.');
    expect(done.body.evidence_item_id).toBeTruthy();
    const evidence = await t.api.get(`/api/evidence/${done.body.evidence_item_id}`);
    expect(evidence.body).toMatchObject({ vendor_id: v, type: 'questionnaire', received_on: today, expires_on: addDays(today, 365) });
    expect(evidence.body.note).toMatch(/Score 84 out of 100; 2 gaps/);

    // Completed assessments are history: they cannot be changed or removed.
    expect((await t.api.patch(`/api/vendor-assessments/${id}`, { answers: { mfa: { answer: 'yes' } } })).status).toBe(409);
    expect((await t.api.del(`/api/vendor-assessments/${id}`)).status).toBe(409);

    // A new version of the questions applies to the next assessment only.
    const v2 = await t.api.post('/api/vendors/question-sets', {
      title: 'Short set', questions: [{ key: 'mfa', text: 'Is multi-factor sign-in enforced?', weight: 5 }, { text: 'Is our data encrypted?', section: 'Data', weight: 1 }],
    });
    expect(v2.status).toBe(201);
    expect(v2.body).toMatchObject({ version: 2, active: true });
    const sets = await t.api.get('/api/vendors/question-sets');
    expect(sets.body.versions.map((s: any) => [s.version, s.active])).toEqual([[2, true], [1, false]]);

    const second = (await t.api.post(`/api/vendors/${v}/assessments`)).body;
    expect(second).toMatchObject({ version: 2, total: 2 });
    await t.api.patch(`/api/vendor-assessments/${second.id}`, { answers: { mfa: { answer: 'yes' }, q2: { answer: 'yes' } } });
    const draftList = await t.api.get(`/api/vendors/${v}/assessments`);
    expect(draftList.body.rows.map((r: any) => [r.status, r.version])).toEqual([['draft', 2], ['completed', 1]]);
    expect((await t.api.post(`/api/vendor-assessments/${second.id}/complete`)).body.score).toBe(100);

    const history = await t.api.get(`/api/vendors/${v}/assessments`);
    expect(history.body.rows.map((r: any) => [r.version, r.score])).toEqual(expect.arrayContaining([[2, 100], [1, 84]]));
    expect((await t.api.get(`/api/vendor-assessments/${id}`)).body.questions).toHaveLength(DEFAULT_QUESTIONS.length);

    const summary = await t.api.get(`/api/vendors/${v}/summary`);
    expect(summary.body.assessment).toMatchObject({ assessed_on: today, draft_id: null });
    expect([84, 100]).toContain(summary.body.assessment.score);

    const actions = (await t.api.get(`/api/history?record_type=vendor&record_id=${v}`)).body.map((h: any) => h.action);
    expect(actions).toEqual(expect.arrayContaining(['vendor.assessment_start', 'vendor.assessment_answer', 'vendor.assessment_complete']));

    // Gaps become actions when the action tracker is loaded.
    const raised = await t.api.post(`/api/vendor-assessments/${id}/gaps/mfa/action`);
    if (t.ctx.resources.get('action')) {
      expect(raised.status).toBe(201);
      const action = await t.api.get(`/api/actions/${raised.body.id}`);
      expect(action.body).toMatchObject({ source: 'assessment', source_type: 'vendor', source_id: v, priority: 'high' });
      expect(action.body.title).toMatch(/^Nettle Cloud: /);
      expect((await t.api.post(`/api/vendor-assessments/${id}/gaps/mfa/action`)).status).toBe(409);
      expect((await t.api.post(`/api/vendor-assessments/${id}/gaps/encryption/action`)).status).toBe(404);
      expect((await t.api.get(`/api/vendor-assessments/${id}`)).body.gap_list[0].action_id).toBe(raised.body.id);
    } else {
      expect(raised.status).toBe(409);
    }
  });

  it('discards a draft', async () => {
    const v = await vendor('Oakfield Supplies');
    const draft = (await t.api.post(`/api/vendors/${v}/assessments`)).body;
    expect((await t.api.del(`/api/vendor-assessments/${draft.id}`)).status).toBe(200);
    expect((await t.api.get(`/api/vendor-assessments/${draft.id}`)).status).toBe(404);
    expect((await t.api.get(`/api/vendors/${v}/assessments`)).body.rows).toEqual([]);
  });
});

describe('vendor profile summary', () => {
  it('gives incident contacts, contract status and evidence freshness', async () => {
    const v = await vendor('Pinewood Systems', { criticality: 'critical' });
    await t.api.post(`/api/vendors/${v}/contacts`, { name: 'Sorrel Vane', role: 'Duty manager', phone: '555-0142', is_incident_contact: true });
    await t.api.post(`/api/vendors/${v}/contacts`, { name: 'Account person' });
    const c = (await t.api.post('/api/contracts', { title: 'Pinewood licence', vendor_id: v, end_date: addDays(today, 200), notice_days: 60, renewal_mechanism: 'auto_renew' })).body;
    await t.api.post('/api/contracts', { title: 'Pinewood old', vendor_id: v, status: 'terminated' });
    await t.api.post('/api/contracts', { title: 'Pinewood undated', vendor_id: v });
    await t.api.post('/api/evidence', { title: 'Report', vendor_id: v, received_on: addDays(today, -30), expires_on: addDays(today, 335) });
    await t.api.post('/api/evidence', { title: 'Old report', vendor_id: v, received_on: addDays(today, -400), expires_on: addDays(today, -35) });

    const s = (await t.api.get(`/api/vendors/${v}/summary`)).body;
    expect(s).toMatchObject({
      sees_contracts: true, contracts: 3, contracts_open: 2, contracts_undated: 1,
      next_notice_date: addDays(today, 140),
      next_notice_contract: { id: c.id, title: 'Pinewood licence', renewal_mechanism: 'auto_renew' },
      evidence: 2, evidence_current: 1, evidence_expired: 1, evidence_latest_received: addDays(today, -30),
      assessment: { id: null, score: null, draft_id: null },
    });
    expect(s.incident_contacts).toEqual([{ name: 'Sorrel Vane', role: 'Duty manager', email: null, phone: '555-0142' }]);
    expect((await t.api.get('/api/vendors/overview')).body.vendors[v].notice_date).toBe(addDays(today, 140));
  });
});

describe('files on contracts and evidence', () => {
  it('accepts a document on a contract and an evidence file on an evidence item', async () => {
    const probe = await t.api.get('/api/attachments/config');
    if (probe.status === 404) return; // attachments module not loaded in this run
    const v = await vendor('Quince Works');
    const contract = (await t.api.post('/api/contracts', { title: 'Quince agreement', vendor_id: v })).body;
    const item = (await t.api.post('/api/evidence', { title: 'Quince certificate', vendor_id: v, contract_id: contract.id })).body;
    const admin = await t.db.one<{ id: string }>(`select id from users where username = 'admin'`);
    const token = await createSession(t.db, admin!.id);
    const put = async (params: Record<string, string>) => {
      const res = await t.app.inject({
        method: 'PUT', url: `/api/attachments/upload?${new URLSearchParams(params)}`,
        headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-grc-csrf': '1', 'content-type': 'application/octet-stream' },
        payload: Buffer.from('Invented contract text.\n'),
      });
      return { status: res.statusCode, body: res.json() };
    };
    const signed = await put({ record_type: 'contract', record_id: contract.id, name: 'signed-agreement.txt' });
    expect(signed.status).toBeLessThan(300);
    const cert = await put({
      record_type: 'evidence_item', record_id: item.id, name: 'certificate.txt', kind: 'evidence',
      collected_on: today, expires_on: addDays(today, 300),
    });
    expect(cert.status).toBeLessThan(300);
    const onContract = await t.api.get(`/api/attachments?record_type=contract&record_id=${contract.id}`);
    expect(onContract.body.rows.map((r: any) => r.file_name)).toEqual(['signed-agreement.txt']);
    const onEvidence = await t.api.get(`/api/attachments?record_type=evidence_item&record_id=${item.id}`);
    expect(onEvidence.body.rows[0]).toMatchObject({ file_name: 'certificate.txt', kind: 'evidence', expires_on: addDays(today, 300) });
    expect(onEvidence.body.canEdit).toBe(true);
    // An agent can read vendors, so may see the file list but not add to it.
    expect((await (await t.as('agent')).get(`/api/attachments?record_type=evidence_item&record_id=${item.id}`)).body.canEdit).toBe(false);
  });
});
