import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { CERT_MONTH_SETTING, DEFAULT_CERT_MONTH } from './certifications.ts';

// Behavior test for POST /api/funding/certifications/rollover/run [funding.administer] (E40-05): each
// yearly certification gets next cycle's copy once. Invented funders only.

let t: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('POST /api/funding/certifications/rollover/run', () => {
  it('needs funding.administer', async () => {
    for (const role of ['asset_manager', 'auditor']) { // funding.view
      expect((await (await t.as(role)).post('/api/funding/certifications/rollover/run')).status).toBe(403);
    }
    expect((await t.anon.post('/api/funding/certifications/rollover/run')).status).toBe(401);
  });

  it('copies each certification forward to the target year once, and answers the year and how many', async () => {
    const officer = await t.as('compliance_officer'); // funding.*
    const [y, m] = todayInZone().split('-').map(Number);
    const month = Number(await t.ctx.settings.get(CERT_MONTH_SETTING, DEFAULT_CERT_MONTH));
    const target = m >= month ? y + 1 : y;
    const made = await officer.post('/api/funding-certifications', { year: target - 1, title: 'Invented yearly assurances', funder_name: 'Invented Transit Fund' });
    expect(made.status).toBe(201);

    const res = await officer.post('/api/funding/certifications/rollover/run');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ year: target, created: 1 });
    const rows = await t.db.query<any>(`select year::int as year from funding_certifications where title = 'Invented yearly assurances' and deleted_at is null order by year`);
    expect(rows.map((r: any) => r.year)).toEqual([target - 1, target]);

    expect((await officer.post('/api/funding/certifications/rollover/run')).body).toEqual({ year: target, created: 0 });
    expect(await t.db.query(`select 1 from funding_certifications where title = 'Invented yearly assurances' and deleted_at is null`)).toHaveLength(2);
  });
});
