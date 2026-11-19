import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import mod from './index.ts';
import { DESIGNATIONS_FILE, MISSING_TEXT, PROFILE_FILE } from './seed.ts';

// Small invented files with the same header names as the real ones. Nothing is read from seed/.
const DESIGNATIONS = [
  'id,focus_area_ratings',
  'GV.OC-01,ESS',
  'GV.OC-02,SSS',
  'PR.AA-01,SES',
  'RC.CO-03,SSE',
  'ZZ.QQ-01,SSS',
].join('\r\n');

const PROFILE = [
  'ID|Outcome|Evidence|Status|Target|FirstAction|AlsoSatisfies|Phase',
  'GV.OC-01|We know why we exist|A leaflet from the open day|Partial|A one-page statement|Write the statement|PCI DSS 12.1; Insurer conditions|Now',
  'PR.AA-01|Every account belongs to someone|None found|Not evidenced|A list of accounts and owners|Export the account list|Northshire Charter 9.64 (accounts); Example Guild XY-RP-001, XY-RP-002|Next',
  'RC.CO-03|People are told how recovery is going|A draft notice|Partial|A contact sheet|Draft the contact sheet|Insurer conditions|Later',
  'DE.CM-01|This row has no outcome in the designations file|x|Partial|x|x|x|Now',
].join('\n');

describe('pilot seed', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let seedDir: string;
  const run = () => mod.seed!(t.ctx, { profile: 'pilot', seedDir }) as Promise<string>;
  const byCode = async (code: string) => (await t.api.get(`/api/framework-outcomes?q=${code}`)).body.rows[0];

  beforeAll(async () => {
    t = await testApp();
    seedDir = mkdtempSync(join(tmpdir(), 'grc-frameworks-seed-'));
    writeFileSync(join(seedDir, DESIGNATIONS_FILE), DESIGNATIONS);
    writeFileSync(join(seedDir, PROFILE_FILE), PROFILE);
  });
  afterAll(async () => {
    await t.close();
    rmSync(seedDir, { recursive: true, force: true });
  });

  it('loads outcomes from the designations file and applies the profile', async () => {
    const note = await run();
    expect(note).toContain('5 outcomes (5 new)');
    expect(note).toContain('3 priority');
    expect(note).toContain('3 profile rows applied');
    expect(note).toContain('identifiers lacking outcome text: ZZ.QQ-01');
    expect(note).toContain('profile rows with no matching outcome: DE.CM-01');
    expect(note).toContain('snapshot "Baseline" created');

    const fw = (await t.api.get('/api/frameworks')).body.rows[0];
    expect(fw).toMatchObject({ key: 'nist-csf-2.0', version: '2.0' });
    const shape = (await t.api.get(`/api/frameworks/${fw.id}/structure`)).body;
    expect(shape.functions.length).toBe(7); // the six shipped functions plus the unknown one from the file
    expect(shape.functions.slice(0, 6).reduce((n: number, f: any) => n + f.categories.length, 0)).toBe(22);

    const first = await byCode('GV.OC-01');
    expect(first).toMatchObject({
      function_code: 'GV', category_code: 'GV.OC', priority: true, designation: 'ESS', status: 'partial', phase: 'now',
      description: 'We know why we exist', title: 'We know why we exist', evidence_summary: 'A leaflet from the open day',
      target: 'A one-page statement', first_action: 'Write the statement', also_satisfies: 'PCI DSS 12.1; Insurer conditions',
    });
    expect(first.official_text).toMatch(/mission/);
    expect(await byCode('GV.OC-02')).toMatchObject({ priority: false, status: 'not_evidenced', description: null });
    expect((await byCode('ZZ.QQ-01')).official_text).toBe(MISSING_TEXT);

    const maps = (await t.api.get(`/api/framework-outcomes/${(await byCode('PR.AA-01')).id}/mappings`)).body;
    expect(maps.map((m: any) => [m.framework_name, m.reference])).toEqual([
      ['Example Guild', 'XY-RP-001, XY-RP-002'], ['Northshire Charter', '9.64 (accounts)'],
    ]);

    const board = (await t.api.get(`/api/frameworks/${fw.id}/board`)).body;
    expect(board.summary.all.total).toBe(5);
    expect(board.summary.priority.counts).toMatchObject({ partial: 2, not_evidenced: 1 });
    const progress = (await t.api.get(`/api/frameworks/${fw.id}/progress`)).body;
    expect(progress.series.map((p: any) => p.name)).toEqual(['Baseline', 'Now']);
    expect(progress.series[0].all.counts.partial).toBe(2);
  });

  it('can be run again without overwriting what people have changed or duplicating anything', async () => {
    const first = await byCode('GV.OC-01');
    const second = await byCode('RC.CO-03');
    await t.api.patch(`/api/framework-outcomes/${first.id}`, { status: 'met', target: 'A better target', phase: 'later' });
    // Deliberately moved back to the starting value: the profile must not push it forward again.
    await t.api.patch(`/api/framework-outcomes/${second.id}`, { status: 'not_evidenced', first_action: null });
    const audits = async () => (await t.db.one<{ c: number }>('select count(*)::int as c from audit_events'))!.c;
    const before = await audits();

    const note = await run();
    expect(note).toContain('5 outcomes (0 new)');
    expect(note).toContain('3 profile rows applied (1 changed an outcome this run)');
    expect(note).toContain('0 cross-mappings added');
    expect(note).toContain('snapshot "Baseline" already there');

    expect(await byCode('GV.OC-01')).toMatchObject({ status: 'met', target: 'A better target', phase: 'later' });
    // Only the field that was empty is filled back in.
    expect(await byCode('RC.CO-03')).toMatchObject({ status: 'not_evidenced', first_action: 'Draft the contact sheet' });
    expect((await t.api.get('/api/framework-outcomes')).body.total).toBe(5);
    expect((await t.db.one<{ c: number }>('select count(*)::int as c from outcome_mappings'))!.c).toBe(5);
    expect((await t.api.get('/api/assessment-snapshots')).body.total).toBe(1);
    expect((await audits()) - before).toBe(1);

    const again = await run();
    expect(again).toContain('(0 changed an outcome this run)');
  });
});

describe('pilot seed without the optional files', () => {
  it('skips quietly and says so', async () => {
    const t = await testApp();
    try {
      const note = await mod.seed!(t.ctx, { profile: 'pilot', seedDir: join(tmpdir(), 'grc-no-such-seed-folder') }) as string;
      expect(note).toContain(`no ${DESIGNATIONS_FILE} in the seed folder`);
      expect(note).toContain(`no ${PROFILE_FILE} in the seed folder`);
      expect(note).toContain('0 outcomes (0 new)');
      expect((await t.api.get('/api/frameworks')).body.total).toBe(1);
      expect((await t.api.get('/api/assessment-snapshots')).body.total).toBe(0);
    } finally {
      await t.close();
    }
  });
});

describe('dev seed', () => {
  it('loads the whole reference framework with sample statuses and two snapshots, once', async () => {
    const t = await testApp();
    try {
      const run = () => mod.seed!(t.ctx, { profile: 'dev', seedDir: 'unused' }) as Promise<string>;
      const note = await run();
      expect(note).toContain('106 outcomes (106 new)');
      expect(note).toContain('53 priority');
      const fw = (await t.api.get('/api/frameworks')).body.rows[0];
      const progress = (await t.api.get(`/api/frameworks/${fw.id}/progress`)).body;
      expect(progress.series.map((p: any) => p.name)).toEqual(['Baseline', 'Mid-quarter review', 'Now']);
      const scores = progress.series.map((p: any) => p.all.score);
      expect(scores[1]).toBeGreaterThan(scores[0]);
      expect(scores[2]).toBeGreaterThan(scores[1]);
      expect(progress.series[0].date < progress.series[1].date).toBe(true);
      const board = (await t.api.get(`/api/frameworks/${fw.id}/board`)).body;
      expect(board.functions.map((f: any) => f.all.total)).toEqual([31, 21, 22, 11, 13, 8]);
      expect(board.summary.all.total - board.summary.all.counts.not_evidenced).toBeGreaterThanOrEqual(12);

      expect(await run()).toContain('106 outcomes (0 new)');
      expect((await t.api.get('/api/assessment-snapshots')).body.total).toBe(2);
    } finally {
      await t.close();
    }
  }, 120000);
});

describe('pilot seed corrects cross-mappings split in the wrong place (E18-09)', () => {
  it('replaces its own wrong rows once the name is known, and leaves a person\'s rows alone', async () => {
    const t = await testApp();
    const dir = mkdtempSync(join(tmpdir(), 'grc-frameworks-remap-'));
    try {
      writeFileSync(join(dir, DESIGNATIONS_FILE), 'id,focus_area_ratings\nGV.OC-01,ESS');
      writeFileSync(join(dir, PROFILE_FILE), [
        'ID|Outcome|Evidence|Status|Target|FirstAction|AlsoSatisfies|Phase',
        'GV.OC-01|x|x|Partial|x|x|Example Standard 2 4.1.3; Insurer conditions|Now',
      ].join('\n'));
      const run = () => mod.seed!(t.ctx, { profile: 'pilot', seedDir: dir }) as Promise<string>;
      await run();
      const outcome = (await t.api.get('/api/framework-outcomes?q=GV.OC-01')).body.rows[0];
      const pairs = async () => ((await t.api.get(`/api/framework-outcomes/${outcome.id}/mappings`)).body as any[])
        .map((m) => [m.framework_name, m.reference]);
      // Unknown name holding a number: the general rule splits it at the "2".
      expect(await pairs()).toEqual(expect.arrayContaining([['Example Standard', '2 4.1.3']]));
      // A person's own mapping with the same words must survive the correction.
      expect((await t.api.post(`/api/framework-outcomes/${outcome.id}/mappings`, { framework_name: 'Example Standard', reference: '2 9.9' })).status).toBe(201);

      await t.ctx.lookups.ensure('mapping_framework', [{ value: 'example_standard_2', label: 'Example Standard 2', sort: 900 }]);
      const note = await run();
      expect(note).toContain('1 cross-mappings split in the wrong place corrected');
      const after = await pairs();
      expect(after).toEqual(expect.arrayContaining([['Example Standard 2', '4.1.3'], ['Insurer conditions', ''], ['Example Standard', '2 9.9']]));
      expect(after).not.toEqual(expect.arrayContaining([['Example Standard', '2 4.1.3']]));
      expect(await run()).not.toContain('split in the wrong place');
    } finally {
      await t.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
