import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { validateReference } from './importer.ts';
import { composeMappings, parseMapping, parseMappings } from './mappings.ts';

// An invented framework throughout. Nothing here comes from seed/.
const FILE = {
  key: 'small-standard', name: 'Small Standard', version: '3',
  functions: [
    { code: 'PL', name: 'Plan', color: 'purple', categories: [
      { code: 'PL.A', name: 'Aims', outcomes: [{ code: 'PL.A-1', text: 'Aims are written down' }, { code: 'PL.A-2', text: 'Aims are reviewed' }] },
      { code: 'PL.B', name: 'People', outcomes: [{ code: 'PL.B-1', text: 'People know their part' }] },
    ] },
    { code: 'DO', name: 'Do', color: 'teal', categories: [
      { code: 'DO.A', name: 'Work', outcomes: [{ code: 'DO.A-1', text: 'Work follows the plan' }] },
      { code: 'DO.Z', name: 'Spare', outcomes: [] },
    ] },
  ],
};

let t: Awaited<ReturnType<typeof testApp>>;
let fw: string;
const ids: Record<string, string> = {};

beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

describe('"also satisfies" parser (E18-09)', () => {
  it('splits a name that contains a number when the name is known', () => {
    expect(parseMapping('Example Standard 2 4.1.3', ['Example Standard 2'])).toEqual({ framework_name: 'Example Standard 2', reference: '4.1.3' });
    // The longest known name wins, and the stored spelling is the known one.
    expect(parseMapping('example standard 2 part 9', ['Example Standard', 'Example Standard 2']))
      .toEqual({ framework_name: 'Example Standard 2', reference: 'part 9' });
    expect(parseMapping('SOC 2 CC6.1')).toEqual({ framework_name: 'SOC 2', reference: 'CC6.1' });
    expect(parseMapping('SOC 2')).toEqual({ framework_name: 'SOC 2', reference: '' });
  });

  it('accepts an explicit separator, whatever the name holds', () => {
    expect(parseMapping('Rule 7 of 2019: section 4 (records)')).toEqual({ framework_name: 'Rule 7 of 2019', reference: 'section 4 (records)' });
    expect(parseMapping('Charter 21:')).toEqual({ framework_name: 'Charter 21', reference: '' });
  });

  it('keeps the general rule for everything else', () => {
    expect(parseMapping('Example Guild 12.10.1')).toEqual({ framework_name: 'Example Guild', reference: '12.10.1' });
    expect(parseMapping('Insurer conditions')).toEqual({ framework_name: 'Insurer conditions', reference: '' });
    expect(parseMapping('   ')).toBeNull();
  });

  it('writes rows back as text that reads to the same rows', () => {
    const rows = [
      { framework_name: 'Rule 7 of 2019', reference: 'section 4 (records)' },
      { framework_name: 'Charter 21', reference: '' },
      { framework_name: 'Insurer conditions', reference: '' },
      { framework_name: 'Example Guild', reference: 'XY-1, XY-2' },
    ];
    const text = composeMappings(rows)!;
    expect(text).toBe('Charter 21:; Example Guild: XY-1, XY-2; Insurer conditions; Rule 7 of 2019: section 4 (records)');
    const back = parseMappings(text, []);
    expect(back).toHaveLength(4);
    expect(back).toEqual(expect.arrayContaining(rows));
    expect(composeMappings([])).toBeNull();
  });
});

describe('loading a framework from a reference file (E07-14)', () => {
  it('explains what is wrong with a file', () => {
    expect(validateReference([]).errors[0]).toMatch(/one JSON object/);
    const bad = validateReference({
      key: 'bad key!', functions: [
        { code: 'A', name: 'One', outcomes: [{ code: 'x', text: 'y' }], categories: [{ code: 'A.1', name: 'Cat', outcomes: [{ code: 'A.1-1', text: 'ok' }, { code: 'A.1-1', text: 'again' }, { code: 'A.1-2' }] }] },
        { code: 'A', name: 'Two', categories: [{ code: 'A.1', name: 'Dup' }, { name: 'No code' }] },
      ],
    });
    const all = bad.errors.join('\n');
    expect(bad.ref).toBeUndefined();
    expect(all).toMatch(/"key" may hold only/);
    expect(all).toMatch(/"name" is missing/);
    expect(all).toMatch(/Every outcome must sit under a category/);
    expect(all).toMatch(/Outcome code A.1-1 is used more than once/);
    expect(all).toMatch(/A.1-2: an outcome needs its "text"/);
    expect(all).toMatch(/Function code A is used more than once/);
    expect(all).toMatch(/Category code A.1 is used more than once/);
    expect(all).toMatch(/a category needs a "code" and a "name"/);
    expect(validateReference(FILE).ref?.functions[0].categories[0].outcomes).toHaveLength(2);
  });

  it('checks a file without loading it, then loads it', async () => {
    const refused = await t.api.post('/api/frameworks/import', { key: 'x' });
    expect(refused.status).toBe(400);
    expect(refused.body.error.problems.length).toBeGreaterThan(0);

    const dry = await t.api.post('/api/frameworks/import', { file: FILE, dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ created: true, dry_run: true, framework_id: null, functions: 2, categories: 4, outcomes: { total: 4, added: 4, updated: 0 } });
    expect((await t.api.get('/api/frameworks')).body.total).toBe(0);

    const made = await t.api.post('/api/frameworks/import', FILE);
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ created: true, outcomes: { added: 4, updated: 0, unchanged: 0 } });
    fw = made.body.framework_id;
    const board = (await t.api.get(`/api/frameworks/${fw}/board`)).body;
    expect(board.functions.map((f: any) => [f.code, f.all.total])).toEqual([['PL', 3], ['DO', 1]]);
    for (const o of board.functions.flatMap((f: any) => f.categories.flatMap((c: any) => c.outcomes))) ids[o.code] = o.id;
    expect(Object.keys(ids).sort()).toEqual(['DO.A-1', 'PL.A-1', 'PL.A-2', 'PL.B-1']);
    const history = (await t.api.get(`/api/history?record_type=framework&record_id=${fw}`)).body;
    expect(history.map((h: any) => h.action)).toContain('framework.import');
  });

  it('loading again updates wording and adds outcomes without touching statuses', async () => {
    await t.api.patch(`/api/framework-outcomes/${ids['PL.A-1']}`, { status: 'met', description: 'Our aims are on one page' });
    const next = structuredClone(FILE);
    next.name = 'Small Standard (revised)';
    next.functions[0].categories[0].outcomes[0].text = 'Aims are written down and agreed';
    next.functions[1].categories[0].outcomes.push({ code: 'DO.A-2', text: 'Work is checked' });
    next.functions[0].categories[1].outcomes = [];
    const again = await t.api.post('/api/frameworks/import', next);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ created: false, framework_id: fw, outcomes: { total: 4, added: 1, updated: 1, unchanged: 2 }, not_in_file: ['PL.B-1'] });
    const first = (await t.api.get(`/api/framework-outcomes/${ids['PL.A-1']}`)).body;
    expect(first).toMatchObject({ status: 'met', official_text: 'Aims are written down and agreed', description: 'Our aims are on one page', title: 'Our aims are on one page' });
    expect((await t.api.get(`/api/framework-outcomes/${ids['PL.B-1']}`)).status).toBe(200); // left alone
    expect((await t.api.get(`/api/frameworks/${fw}`)).body.name).toBe('Small Standard (revised)');
    expect((await t.api.get('/api/frameworks')).body.total).toBe(1);

    const out = (await t.api.get(`/api/frameworks/${fw}/reference`)).body;
    expect(out).toMatchObject({ key: 'small-standard', version: '3' });
    expect(validateReference(out).errors).toEqual([]);
    expect(out.functions[1].categories[0].outcomes.map((o: any) => o.code)).toEqual(['DO.A-1', 'DO.A-2']);
  });

  it('needs Create for a new framework and Edit to reload one', async () => {
    const viewer = await t.as('agent'); // frameworks.view only
    expect((await viewer.post('/api/frameworks/import', FILE)).status).toBe(403);
    expect((await viewer.post('/api/frameworks/import', { ...FILE, key: 'another' })).status).toBe(403);
    expect((await viewer.get(`/api/frameworks/${fw}/reference`)).status).toBe(200);
  });
});

describe('editing the structure (E07-13)', () => {
  it('renames and reorders through the structure route', async () => {
    const shape = (await t.api.get(`/api/frameworks/${fw}/structure`)).body.functions;
    const [pl, doing] = shape;
    const saved = await t.api.post(`/api/frameworks/${fw}/structure`, {
      functions: [
        { code: doing.code, name: 'Deliver', color: 'green', categories: doing.categories.map((c: any) => ({ code: c.code, name: c.name })) },
        { code: pl.code, name: pl.name, color: pl.color, categories: [...pl.categories].reverse().map((c: any) => ({ code: c.code, name: c.name })) },
        { code: 'CK', name: 'Check', categories: [{ code: 'CK.A', name: 'Review' }] },
      ],
    });
    expect(saved.status).toBe(200);
    const after = (await t.api.get(`/api/frameworks/${fw}/structure`)).body.functions;
    expect(after.map((f: any) => [f.code, f.name])).toEqual([['DO', 'Deliver'], ['PL', 'Plan'], ['CK', 'Check']]);
    expect(after[1].categories.map((c: any) => c.code)).toEqual(['PL.B', 'PL.A']);
  });

  it('refuses to remove a category or function that is still in use', async () => {
    const inUse = await t.api.del(`/api/frameworks/${fw}/categories/PL.A`);
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.message).toMatch(/still has 2 outcomes/);
    expect((await t.api.del(`/api/frameworks/${fw}/functions/CK`)).status).toBe(409); // still has a category
    expect((await t.api.del(`/api/frameworks/${fw}/categories/NOPE`)).status).toBe(404);
    expect((await (await t.as('agent')).del(`/api/frameworks/${fw}/categories/CK.A`)).status).toBe(403);

    expect((await t.api.del(`/api/frameworks/${fw}/categories/CK.A`)).status).toBe(200);
    expect((await t.api.del(`/api/frameworks/${fw}/functions/CK`)).status).toBe(200);
    expect((await t.api.del(`/api/frameworks/${fw}/categories/DO.Z`)).status).toBe(200);
    const after = (await t.api.get(`/api/frameworks/${fw}/structure`)).body.functions;
    expect(after.map((f: any) => f.code)).toEqual(['DO', 'PL']);
    const actions = (await t.api.get(`/api/history?record_type=framework&record_id=${fw}`)).body.map((h: any) => h.action);
    expect(actions).toEqual(expect.arrayContaining(['framework.category_remove', 'framework.function_remove', 'framework.structure']));
  });
});

describe('editing evidence and mappings', () => {
  it('edits an evidence entry, audited with before and after', async () => {
    const id = ids['PL.A-1'];
    const made = await t.api.post(`/api/framework-outcomes/${id}/evidence`, { title: 'Aims leaflet', collected_on: '2026-01-10' });
    const base = `/api/framework-outcomes/${id}/evidence/${made.body.id}`;
    expect((await t.api.patch(base, { title: ' ' })).body.error.fields.title).toBeTruthy();
    expect((await t.api.patch(base, { expires_on: '2025-12-31' })).body.error.fields.expires_on).toMatch(/before/);
    const ok = await t.api.patch(base, { title: 'Aims leaflet, signed', expires_on: '2027-01-10', location: 'Shared drive / Aims' });
    expect(ok.status).toBe(200);
    const list = (await t.api.get(`/api/framework-outcomes/${id}/evidence`)).body;
    expect(list[0]).toMatchObject({ title: 'Aims leaflet, signed', collected_on: '2026-01-10', expires_on: '2027-01-10', location: 'Shared drive / Aims' });
    const last = (await t.api.get(`/api/history?record_type=framework_outcome&record_id=${id}`)).body[0];
    expect(last).toMatchObject({ action: 'framework_outcome.evidence_edit', before: { title: 'Aims leaflet', expires_on: null }, after: { title: 'Aims leaflet, signed', expires_on: '2027-01-10' } });
    expect((await t.api.patch(`/api/framework-outcomes/${ids['PL.A-2']}/evidence/${made.body.id}`, { title: 'x' })).status).toBe(404);
    expect((await (await t.as('agent')).patch(base, { title: 'x' })).status).toBe(403);
  });

  it('keeps the "also satisfies" text in step with the mapping rows', async () => {
    const id = ids['PL.A-1'];
    const base = `/api/framework-outcomes/${id}/mappings`;
    const text = async () => (await t.api.get(`/api/framework-outcomes/${id}`)).body.also_satisfies;
    const a = await t.api.post(base, { framework_name: 'Example Standard 2', reference: '4.1' });
    await t.api.post(base, { framework_name: 'Insurer conditions' });
    expect(await text()).toBe('Example Standard 2: 4.1; Insurer conditions');
    expect((await t.api.post(base, { framework_name: 'Bad; name' })).body.error.fields.framework_name).toBeTruthy();
    expect((await t.api.post(base, { framework_name: 'Fine', reference: 'a; b' })).body.error.fields.reference).toBeTruthy();

    // Edit a row: the text follows.
    const edited = await t.api.patch(`${base}/${a.body.id}`, { reference: '4.2 (records)' });
    expect(edited.body).toMatchObject({ framework_name: 'Example Standard 2', reference: '4.2 (records)' });
    expect(await text()).toBe('Example Standard 2: 4.2 (records); Insurer conditions');
    expect((await t.api.patch(`${base}/${a.body.id}`, { framework_name: 'Insurer conditions', reference: '' })).body.error.fields.reference).toMatch(/already/);
    const last = (await t.api.get(`/api/history?record_type=framework_outcome&record_id=${id}`)).body[0];
    expect(last).toMatchObject({ action: 'framework_outcome.mapping_edit', before: { reference: '4.1' }, after: { reference: '4.2 (records)' } });

    // Edit the text: the rows follow. "Example Standard 2" is already in use, so its number stays in the name.
    const patched = await t.api.patch(`/api/framework-outcomes/${id}`, { also_satisfies: 'Example Standard 2 5.5; Example Guild 12.10.1' });
    expect(patched.status).toBe(200);
    expect((await t.api.get(base)).body.map((m: any) => [m.framework_name, m.reference])).toEqual([
      ['Example Guild', '12.10.1'], ['Example Standard 2', '5.5'],
    ]);
    const sync = (await t.api.get(`/api/history?record_type=framework_outcome&record_id=${id}`)).body[0];
    expect(sync.action).toBe('framework_outcome.mapping_sync');
    expect(sync.summary).toMatch(/2 added, 2 removed/);

    // Remove a row: the text follows; clearing the text clears the rows.
    const rows = (await t.api.get(base)).body;
    await t.api.del(`${base}/${rows[0].id}`);
    expect(await text()).toBe('Example Standard 2: 5.5');
    await t.api.patch(`/api/framework-outcomes/${id}`, { also_satisfies: null });
    expect((await t.api.get(base)).body).toEqual([]);
  });
});

describe('coverage of another framework', () => {
  it('lists the requirements of another framework with the outcomes that satisfy them', async () => {
    await t.api.patch(`/api/framework-outcomes/${ids['PL.A-1']}`, { also_satisfies: 'Example Guild 12.1 (aims), 12.2; Insurer conditions' });
    await t.api.patch(`/api/framework-outcomes/${ids['PL.A-2']}`, { also_satisfies: 'Example Guild 12.2' });
    await t.api.patch(`/api/framework-outcomes/${ids['DO.A-1']}`, { also_satisfies: 'Example Guild' });

    const all = await t.api.get(`/api/frameworks/${fw}/coverage`);
    expect(all.status).toBe(200);
    expect(all.body.requirements).toBeUndefined();
    expect(all.body.names).toEqual([
      { name: 'Example Guild', outcomes: 3, at_target: 1, requirements: 2 },
      { name: 'Insurer conditions', outcomes: 1, at_target: 1, requirements: 0 },
    ]);

    const one = (await t.api.get(`/api/frameworks/${fw}/coverage?name=example%20guild`)).body;
    expect(one.name).toBe('Example Guild');
    expect(one.requirements.map((r: any) => [r.reference, r.outcomes.map((o: any) => o.code), r.at_target])).toEqual([
      ['12.1', ['PL.A-1'], 1],
      ['12.2', ['PL.A-1', 'PL.A-2'], 1],
      ['', ['DO.A-1'], 0],
    ]);
    expect(one.requirements[0].outcomes[0]).toMatchObject({ status: 'met', at_target: true, note: 'aims' });
    expect((await (await t.as('project_manager')).get(`/api/frameworks/${fw}/coverage`)).status).toBe(403);
  });
});

describe('status timeline', () => {
  it('lists status changes from the history and the status in each snapshot', async () => {
    const id = ids['PL.A-2'];
    await t.api.patch(`/api/framework-outcomes/${id}`, { status: 'partial' });
    const older = await t.api.post('/api/assessments', { name: 'Earlier', date: '2024-03-01', framework_id: fw });
    const newer = await t.api.post('/api/assessments', { name: 'Later', date: '2025-03-01', framework_id: fw });
    await t.api.patch(`/api/framework-outcomes/${id}`, { status: 'largely_met', target: 'unrelated change' });
    await t.api.patch(`/api/framework-outcomes/${id}`, { first_action: 'not a status change' });

    const res = await t.api.get(`/api/framework-outcomes/${id}/timeline`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('largely_met');
    expect(res.body.events.map((e: any) => [e.kind, e.from, e.to, e.name])).toEqual([
      ['snapshot', null, 'partial', 'Earlier'],
      ['snapshot', null, 'partial', 'Later'],
      ['created', null, 'not_evidenced', null],
      ['change', 'not_evidenced', 'partial', null],
      ['change', 'partial', 'largely_met', null],
    ]);
    expect(res.body.events[3].by).toBe('Test Admin');

    // A snapshot taken today sorts after the changes made earlier today, not at the start of the day.
    await t.api.post('/api/assessments', { name: 'Today', framework_id: fw });
    const again = (await t.api.get(`/api/framework-outcomes/${id}/timeline`)).body.events;
    expect(again.map((e: any) => e.name ?? e.kind).slice(-2)).toEqual(['change', 'Today']);

    // A snapshot knows the one before it, for the printable report.
    expect((await t.api.get(`/api/assessments/${newer.body.id}`)).body.previous).toMatchObject({ id: older.body.id, name: 'Earlier' });
    const first = (await t.api.get(`/api/assessments/${older.body.id}`)).body;
    expect(first.previous).toBeNull();
    expect(first.categories.map((c: any) => c.code)).toEqual(expect.arrayContaining(['PL.A', 'PL.B', 'DO.A']));
  });
});

describe('review-date reminders', () => {
  it('tells the owner once ahead of the review date and once when it is due', async () => {
    const run = () => t.api.post('/api/frameworks/review-reminders/run');
    if (!t.app.hasDecorator('notify')) {
      // The notifications module is not loaded (isolated run): nothing is sent and nothing fails.
      expect((await run()).body).toEqual({ available: false, soon: 0, due: 0, notified: 0 });
      return;
    }
    const owner = await t.as('security_lead');
    const day = async (offset: number) => (await t.db.one<{ d: string }>('select (current_date + $1::int)::text as d', [offset]))!.d;
    await t.api.patch(`/api/framework-outcomes/${ids['PL.A-1']}`, { owner_id: owner.userId, review_on: await day(5) });
    await t.api.patch(`/api/framework-outcomes/${ids['PL.A-2']}`, { owner_id: owner.userId, review_on: await day(-2) });
    await t.api.patch(`/api/framework-outcomes/${ids['DO.A-1']}`, { owner_id: owner.userId, review_on: await day(60) });

    expect((await run()).body).toEqual({ available: true, soon: 1, due: 1, notified: 2 });
    const mine = (await owner.get('/api/notifications')).body.rows;
    expect(mine.map((n: any) => n.title).sort()).toEqual(['PL.A-1 is due for review in 5 days', 'PL.A-2 was due for review 2 days ago']);
    expect(mine[0]).toMatchObject({ kind: 'reminder', record_type: 'framework_outcome' });
    expect(mine.find((n: any) => n.title.startsWith('PL.A-1')).route).toBe(`/frameworks/outcomes/${ids['PL.A-1']}`);
    // Nothing is repeated on the next run...
    expect((await run()).body).toMatchObject({ soon: 0, due: 0, notified: 0 });
    // ...until the date is reached, or a new review date is set.
    await t.db.query('update framework_outcomes set review_on = current_date, review_soon_sent_for = current_date where id = $1', [ids['PL.A-1']]);
    expect((await run()).body).toMatchObject({ soon: 0, due: 1, notified: 1 });
    await t.api.patch(`/api/framework-outcomes/${ids['PL.A-2']}`, { review_on: await day(10) });
    expect((await run()).body).toMatchObject({ soon: 1, due: 0, notified: 1 });
    expect((await (await t.as('security_lead')).post('/api/frameworks/review-reminders/run')).status).toBe(403);
  });
});
