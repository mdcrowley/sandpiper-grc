import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// E41-17: an asset that holds data records how its data was wiped, by whom, with a certificate,
// before it may be disposed of. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const approval = { disposal_approved_by: 'Invented Approver', disposal_approved_on: '2026-10-01', disposal_method: 'Recycled' };
const wiping = { data_wipe_method: 'purge', data_wiped_on: '2026-10-02', data_wiped_by: 'Invented Recycling Co.', data_wipe_certificate: 'WC-0042' };

describe('data wiping at disposal', () => {
  it('offers the three methods', async () => {
    const methods = (await t.api.get('/api/lookups/data_wipe_method')).body.map((m: any) => m.value);
    expect(methods).toEqual(['clear', 'purge', 'destroy']);
  });

  it('an asset that holds no data is disposed of as before', async () => {
    const asset = (await t.api.post('/api/assets', { name: 'Platform bench', status: 'retired' })).body;
    expect((await t.api.post(`/api/assets/${asset.id}/dispose`, approval)).status).toBe(200);
  });

  it('an asset that holds data needs the method, the date, who wiped it and the certificate', async () => {
    const asset = (await t.api.post('/api/assets', { name: 'Depot laptop', serial: 'SN-123', status: 'retired', data_bearing: true })).body;
    const refused = await t.api.post(`/api/assets/${asset.id}/dispose`, approval);
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('data_wipe_required');
    expect(Object.keys(refused.body.error.fields).sort()).toEqual(['data_wipe_certificate', 'data_wipe_method', 'data_wiped_by', 'data_wiped_on']);
    // Editing the status does not get round it either.
    const edited = await t.api.patch(`/api/assets/${asset.id}`, { status: 'disposed', ...approval });
    expect(edited.status).toBe(400);
    // No certificate before the wiping is recorded.
    expect((await t.api.get(`/api/assets/${asset.id}/data-wiping-certificate.pdf`)).status).toBe(409);

    const done = await t.api.post(`/api/assets/${asset.id}/dispose`, { ...approval, ...wiping });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'disposed', data_wipe_method: 'purge', data_wiped_by: 'Invented Recycling Co.', data_wipe_certificate: 'WC-0042' });
    const event = await t.db.one<{ summary: string }>(`select summary from audit_events where action = 'asset.dispose' and record_id = $1`, [asset.id]);
    expect(event!.summary).toMatch(/data wiped on 2026-10-02 by Invented Recycling Co\. \(purge, certificate WC-0042\)/);

    const pdf = await t.api.get(`/api/assets/${asset.id}/data-wiping-certificate.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.text.startsWith('%PDF')).toBe(true);
    expect((await (await t.as('requester')).get(`/api/assets/${asset.id}/data-wiping-certificate.pdf`)).status).toBe(403);
  });
});
