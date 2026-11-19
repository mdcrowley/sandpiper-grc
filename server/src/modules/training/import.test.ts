import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, testApp } from '../../test/helpers.ts';
import { addDays, localDate } from './dates.ts';
import { parseCsv, parseDate } from './importer.ts';

let t: Awaited<ReturnType<typeof testApp>>;
const today = localDate();
const d1 = addDays(today, -30);
const d2 = addDays(today, -12);
let courseId: string;

const MAPPING = { person_email: 'Email', person_name: 'Full name', person_department: 'Dept', course: 'Course', completed_on: 'Completed', score: 'Score' };
const csv = () => [
  'Email,Full name,Dept,Course,Completed,Score',
  `kim@example.test,Kim Example,Stores,Password basics,${d1},88`,            // 2 new
  `${ADMIN.email},,,Password basics,${d2},91`,                               // 3 a user: completes their open record
  'lee@example.test,Lee Example,Stores,Password basics,31/31/2031,70',       // 4 bad date
  `mo@example.test,Mo Example,Stores,No such course,${d1},70`,               // 5 unknown course
  `KIM@example.test,"Example, Kim",Stores,Password basics,${d1},88`,         // 6 same as line 2
  `pat@example.test,Pat Example,Workshop,Password basics,${d1},`,            // 7 already recorded
  `,,Stores,Password basics,${d1},50`,                                       // 8 nobody
  `ray@example.test,Ray Example,Workshop,Password basics,${d1},150`,         // 9 bad score
].join('\r\n');

const count = async () => (await t.db.one<{ c: number }>('select count(*)::int c from training_records where deleted_at is null'))!.c;

beforeAll(async () => {
  t = await testApp();
  courseId = (await t.api.post('/api/courses', { title: 'Password basics' })).body.id;
  await t.api.post('/api/training/records', { course_id: courseId, completed_on: d1, people: [{ name: 'Pat Example', email: 'pat@example.test' }] });
  const me = (await t.api.get('/api/auth/state')).body.user;
  await t.api.post('/api/training/records', { course_id: courseId, assigned_on: addDays(today, -20), people: [{ user_id: me.id }] });
});
afterAll(async () => { await t.close(); });

describe('completion import', () => {
  it('parses CSV and dates', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
    expect(parseDate('3/9/2031')).toBe('2031-03-09');
    expect(parseDate('2031-02-30')).toBeNull();
  });

  it('previews without writing anything', async () => {
    const before = await count();
    const res = await t.api.post('/api/training/import', { csv: csv(), mapping: MAPPING });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, total: 8, valid: 4, errors: 4, duplicates: 2, wouldCreate: 2, created: 0, updated: 0, skipped: 2 });
    expect(await count()).toBe(before);

    const byLine = Object.fromEntries(res.body.rows.map((r: any) => [r.line, r]));
    expect(byLine[2]).toMatchObject({ action: 'create', duplicate: null, data: { person: 'Kim Example', course: 'Password basics', completed_on: d1, score: 88, has_account: false } });
    expect(byLine[3]).toMatchObject({ action: 'create', data: { person: ADMIN.displayName, has_account: true } });
    expect(byLine[4].errors.completed_on).toMatch(/not a date/);
    expect(byLine[5].errors.course).toMatch(/No course matches/);
    expect(byLine[6]).toMatchObject({ action: 'skip', duplicate: { of: 'file', line: 2 } });
    expect(byLine[7]).toMatchObject({ action: 'skip', duplicate: { of: 'existing' } });
    expect(byLine[8].errors.person_email).toMatch(/name or an email/);
    expect(byLine[9].errors.score).toMatch(/between 0 and 100/);
    expect((await t.db.query(`select 1 from audit_events where action = 'training.import'`)).length).toBe(0);
  });

  it('imports the good rows, skips duplicates and audits the run', async () => {
    const before = await count();
    const res = await t.api.post('/api/training/import', { csv: csv(), mapping: MAPPING, dryRun: false });
    expect(res.body).toMatchObject({ dryRun: false, total: 8, errors: 4, duplicates: 2, created: 1, updated: 1, skipped: 2 });
    expect(await count()).toBe(before + 1); // Kim is new; the administrator's open record was completed

    const rows = (await t.api.get(`/api/training/records?scope=all&course_id=${courseId}`)).body.rows as any[];
    expect(rows.find((r) => r.person === 'Kim Example')).toMatchObject({ source: 'import', status: 'complete', completed_on: d1, score: 88, department: 'Stores' });
    expect(rows.find((r) => r.person === ADMIN.displayName)).toMatchObject({ source: 'manual', status: 'complete', completed_on: d2, score: 91 });
    expect(rows.some((r) => /Lee|Mo|Ray/.test(r.person))).toBe(false);

    const audit = await t.db.one<any>(`select summary, after from audit_events where action = 'training.import'`);
    expect(audit.summary).toMatch(/1 completions added, 1 open records completed, 2 duplicates skipped, 4 with errors \(of 8 rows\)/);
    expect(audit.after.courses).toEqual([courseId]);

    // The same file again adds nothing.
    const again = await t.api.post('/api/training/import', { csv: csv(), mapping: MAPPING, dryRun: false });
    expect(again.body).toMatchObject({ created: 0, updated: 0, duplicates: 4, skipped: 4, errors: 4 });
    expect(await count()).toBe(before + 1);
  });

  it('takes the course from the request when the file has no course column', async () => {
    const file = `Name,When\nNew Person,${d2}`;
    const mapping = { person_name: 'Name', completed_on: 'When' };
    const none = await t.api.post('/api/training/import', { csv: file, mapping });
    expect(none.status).toBe(400);
    expect(none.body.error).toMatchObject({ code: 'mapping', fields: { course: expect.stringMatching(/Choose a course/) } });
    const ok = await t.api.post('/api/training/import', { csv: file, mapping, course_id: courseId, dryRun: false });
    expect(ok.body).toMatchObject({ created: 1, errors: 0 });
  });

  it('checks the mapping and the file', async () => {
    const bad = await t.api.post('/api/training/import', { csv: csv(), mapping: { ...MAPPING, score: 'Marks', shoe_size: 'Dept', completed_on: '' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('mapping');
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['completed_on', 'score', 'shoe_size']);
    expect((await t.api.post('/api/training/import', { csv: '' })).body.error.fields.csv).toBeDefined();
    expect((await t.api.post('/api/training/import', { csv: 'Email,Completed', mapping: MAPPING })).status).toBe(400);
  });
});
