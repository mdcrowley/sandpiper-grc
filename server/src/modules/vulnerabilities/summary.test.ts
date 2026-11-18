import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { addDays, today } from './policy.ts';
import { SAMPLE_SOURCE, seedVulnerabilities } from './seed.ts';
import { takeSnapshot } from './summary.ts';

// A small fixed data set of invented findings, so every number below can be checked by hand.
let t: Awaited<ReturnType<typeof testApp>>;
const d = (n: number) => addDays(today(), n);

// [host, finding id, severity, age in days, status, fixed after days, known exploited]
const DATA: [string, string, string, number, string, number | null, boolean][] = [
  ['alpha', 'f1', 'critical', 5, 'open', null, false],            // due in 10
  ['alpha', 'f2', 'critical', 20, 'open', null, true],            // overdue
  ['alpha', 'f3', 'high', 40, 'in_remediation', null, false],     // overdue
  ['bravo', 'f4', 'high', 10, 'open', null, false],
  ['bravo', 'f5', 'medium', 100, 'open', null, false],            // overdue (90)
  ['bravo', 'f6', 'medium', 60, 'open', null, true],              // known exploited: 15 days, overdue
  ['charlie', 'f7', 'low', 200, 'open', null, false],             // overdue (180)
  ['charlie', 'f8', 'informational', 300, 'open', null, false],   // no fix-by date
  ['alpha', 'f9', 'critical', 30, 'fixed', 10, false],
  ['bravo', 'f10', 'critical', 30, 'fixed', 20, false],
  ['charlie', 'f11', 'high', 50, 'fixed', 45, false],
  ['charlie', 'f12', 'low', 12, 'false_positive', null, false],
];

beforeAll(async () => {
  t = await testApp();
  for (const [host, id, severity, age, status, fixedAfter, exploited] of DATA) {
    const res = await t.api.post('/api/vulnerabilities', {
      title: `Invented finding ${id}`, host_name: host, plugin_id: id, severity, first_seen: d(-age), status, known_exploited: exploited,
      ...(fixedAfter !== null ? { fixed_on: d(-age + fixedAfter) } : {}),
      ...(status === 'false_positive' ? { false_positive_reason: 'Checked by hand' } : {}),
    });
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  }
});
afterAll(async () => { await t.close(); });

describe('summary', () => {
  it('counts open, overdue, age buckets, time to fix, hosts and known exploited', async () => {
    const s = (await t.api.get('/api/vulnerabilities/summary')).body;
    const by = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.severity, r.count]));
    expect(s.severities.map((x: any) => [x.value, x.color])).toEqual([['critical', 'red'], ['high', 'orange'], ['medium', 'amber'], ['low', 'blue'], ['informational', 'gray']]);
    expect(s.totals).toMatchObject({ open: 8, overdue: 5, knownExploitedOpen: 2, unassignedOpen: 8 });
    expect(by(s.openBySeverity)).toEqual({ critical: 2, high: 2, medium: 2, low: 1, informational: 1 });
    expect(by(s.overdueBySeverity)).toEqual({ critical: 1, high: 1, medium: 2, low: 1, informational: 0 });

    expect(s.ageBuckets.map((b: any) => [b.key, b.total])).toEqual([['0-15', 2], ['16-30', 1], ['31-90', 2], ['91-180', 1], ['180+', 2]]);
    expect(s.ageBuckets[0].bySeverity).toEqual({ critical: 1, high: 1, medium: 0, low: 0, informational: 0 });
    expect(s.ageBuckets[4].bySeverity).toMatchObject({ low: 1, informational: 1 });

    const mttr = Object.fromEntries(s.mttr.map((m: any) => [m.severity, [m.days, m.fixed]]));
    expect(mttr).toEqual({ critical: [15, 2], high: [45, 1], medium: [null, 0], low: [null, 0], informational: [null, 0] });

    expect(s.topHosts.map((h: any) => [h.host, h.total])).toEqual([['alpha', 3], ['bravo', 3], ['charlie', 2]]);
    expect(s.topHosts[0].bySeverity).toMatchObject({ critical: 2, high: 1 });
    expect(s.overdueByOwner).toEqual([{ owner_id: null, owner: 'Unassigned', count: 5 }]);
    expect(s.today).toBe(today());
  });

  it('agrees with the list filters the dashboard links to', async () => {
    const total = async (q: string) => (await t.api.get(`/api/vulnerabilities?${q}`)).body.total;
    expect(await total('f.closed=false')).toBe(8);
    expect(await total('f.overdue=true')).toBe(5);
    expect(await total('f.closed=false&f.known_exploited=true')).toBe(2);
    expect(await total('f.closed=false&f.age_days.gte=31&f.age_days.lte=90&f.severity=medium')).toBe(1);
    expect(await total('f.closed=false&f.host_key=alpha')).toBe(3);
    expect(await total(`f.status=fixed&f.fixed_on.gte=${d(-400)}`)).toBe(3);
  });

  it('keeps a weekly snapshot that follows the data, for a real trend', async () => {
    await takeSnapshot(t.ctx);
    let s = (await t.api.get('/api/vulnerabilities/summary')).body;
    expect(s.trend).toHaveLength(1);
    expect(s.trend[0]).toMatchObject({ total: 8, overdue: 5 });
    expect(s.trend[0].bySeverity).toEqual({ critical: 2, high: 2, medium: 2, low: 1, informational: 1 });

    const one = (await t.api.get('/api/vulnerabilities?f.plugin_id=f1')).body.rows[0];
    await t.api.patch(`/api/vulnerabilities/${one.id}`, { status: 'fixed' });
    await takeSnapshot(t.ctx);
    s = (await t.api.get('/api/vulnerabilities/summary')).body;
    expect(s.trend).toHaveLength(1); // same week: replaced, not added
    expect(s.trend[0].bySeverity.critical).toBe(1);
    expect(s.totals.fixedThisMonth).toBeGreaterThanOrEqual(1);
    await t.api.patch(`/api/vulnerabilities/${one.id}`, { status: 'open' });
  });
});

describe('sample data', () => {
  it('loads about sixty invented findings on twelve hosts, with a trend, and is idempotent', async () => {
    const before = (await t.api.get('/api/vulnerabilities')).body.total;
    const first = await seedVulnerabilities(t.ctx, { profile: 'dev', seedDir: '' });
    const sample = (await t.api.get(`/api/vulnerabilities?pageSize=500&f.source=${encodeURIComponent(SAMPLE_SOURCE)}`)).body;
    expect(sample.total).toBeGreaterThanOrEqual(55);
    expect(sample.total).toBeLessThanOrEqual(70);
    const rows: any[] = sample.rows;
    expect(new Set(rows.map((r) => r.host_name)).size).toBe(12);
    expect(rows.filter((r) => r.known_exploited).length).toBe(2);
    expect(rows.filter((r) => r.status === 'fixed').length).toBeGreaterThan(5);
    expect(rows.filter((r) => r.overdue).length).toBeGreaterThan(5);
    expect(new Set(rows.map((r) => r.severity)).size).toBe(5);
    expect(rows.every((r) => r.source.startsWith('[Sample]'))).toBe(true);
    const weeks = await t.db.query('select distinct week_start from vulnerability_snapshots');
    expect(weeks.length).toBeGreaterThanOrEqual(6);

    const second = await seedVulnerabilities(t.ctx, { profile: 'pilot', seedDir: '' });
    expect(second).toMatch(/\(0 new\)/);
    expect(first).not.toMatch(/\(0 new\)/);
    expect((await t.api.get('/api/vulnerabilities')).body.total).toBe(before + sample.total);
    // Seeding is system work: its audit events have no person behind them.
    const events = await t.db.query<any>(`select distinct actor_name from audit_events where action = 'vulnerability.create' and actor_id is null`);
    expect(events.map((e) => e.actor_name)).toEqual(['System']);
  });
});
