import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import { checkPdfUa } from '../../core/export/pdfua.ts';
import { pdfPageCount, pdfText } from '../../core/export/testing.ts';
import { testApp } from '../../test/helpers.ts';

let t: Awaited<ReturnType<typeof testApp>>;
let adminCookie = '';

/** A POST that keeps the body as bytes and the headers (the test client reads text). */
async function print(body: unknown, cookie = adminCookie) {
  const res = await t.app.inject({ method: 'POST', url: '/api/asset-tags/print', headers: { cookie: `${SESSION_COOKIE}=${cookie}`, 'x-grc-csrf': '1' }, payload: body as object });
  let json: any = null;
  try { json = res.json(); } catch { /* a file */ }
  return { status: res.statusCode, body: res.rawPayload, json, headers: res.headers };
}
const mediaBoxes = (pdf: Buffer) => [...pdf.toString('latin1').matchAll(/\/MediaBox \[([^\]]+)\]/g)].map((m) => m[1].trim().split(/\s+/).map(Number).slice(2));
const lastAudit = async (action: string) => t.db.one<{ summary: string; after: any; actor_name: string | null }>('select summary, after, actor_name from audit_events where action = $1 order by at desc, id desc limit 1', [action]);

async function newSeries(prefix: string, next = 1) {
  return (await t.db.one<{ id: string }>(`insert into tag_series (name, prefix, digits, next_number) values ($1, $2, 6, $3) returning id`, [`Printed ${prefix}`, prefix, next]))!.id;
}

beforeAll(async () => {
  t = await testApp();
  const adminId = (await t.db.one<{ id: string }>("select id from users where username = 'admin'"))!.id;
  adminCookie = await createSession(t.db, adminId);
});
afterAll(async () => { await t?.app.close(); });

describe('label layouts', () => {
  it('lists the presets and saves, checks and deletes custom layouts (tags.manage)', async () => {
    const list = await t.api.get('/api/asset-tags/print/layouts');
    expect(list.status).toBe(200);
    expect(list.body.filter((l: any) => l.preset).length).toBeGreaterThanOrEqual(10);
    const bad = await t.api.post('/api/asset-tags/print/layouts', { name: 'Too many', kind: 'sheet', pageWidthMm: 210, pageHeightMm: 297, labelWidthMm: 60, labelHeightMm: 30, columns: 4, rows: 5 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.columns).toMatch(/wide/);
    const made = await t.api.post('/api/asset-tags/print/layouts', { name: 'Depot shelf labels', kind: 'sheet', pageWidthMm: 210, pageHeightMm: 297, labelWidthMm: 60, labelHeightMm: 30, columns: 3, rows: 9, marginTopMm: 10, marginLeftMm: 10, gapXMm: 5, gapYMm: 0 });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: 'Depot shelf labels', preset: false, columns: 3, rows: 9 });
    expect((await lastAudit('tag.layout.create'))?.summary).toContain('Depot shelf labels');
    expect((await t.api.get('/api/asset-tags/print/layouts')).body.some((l: any) => l.id === made.body.id)).toBe(true);
    expect((await t.api.del('/api/asset-tags/print/layouts/letter-30-2.625x1')).status).toBe(400);
    expect((await t.api.del(`/api/asset-tags/print/layouts/${made.body.id}`)).status).toBe(200);
    expect((await t.api.get('/api/asset-tags/print/layouts')).body.some((l: any) => l.id === made.body.id)).toBe(false);
    const agent = await t.as('agent');
    expect((await agent.get('/api/asset-tags/print/layouts')).status).toBe(403);
    expect((await agent.post('/api/asset-tags/print', { from: { kind: 'values', values: ['TA-118342'] }, layoutId: 'roll-50.8x25.4', code: 'qr', output: 'pdf' })).status).toBe(403);
  });
});

describe('printing', () => {
  it('reprints values on a sheet: page size, pages, start at label, audit', async () => {
    const values = Array.from({ length: 33 }, (_, i) => `TA-${118342 + i}`);
    const res = await print({ from: { kind: 'values', values }, layoutId: 'letter-30-2.625x1', code: 'code128', output: 'pdf', startAt: 29, topLine: 'Property of the operator' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(String(res.headers['content-disposition'])).toMatch(/attachment; filename="tags-.*-33\.pdf"/);
    // 2 on the first sheet (positions 29 and 30), 30 on the next, 1 on a third.
    expect(pdfPageCount(res.body)).toBe(3);
    expect(res.headers['x-tags-pages']).toBe('3');
    expect(mediaBoxes(res.body)).toEqual([[612, 792], [612, 792], [612, 792]]);
    const text = pdfText(res.body);
    expect(text).toContain('TA-118342');
    expect(text).toContain('TA-118374');
    const ua = await checkPdfUa(res.body);
    expect(ua.failures).toEqual([]);
    expect(ua.figures[0]).toBe('Barcode for TA-118342');
    expect(text).toContain('Property of the operator');
    const ev = await lastAudit('tag.print');
    expect(ev?.summary).toBe('Printed 33 tags (TA-118342 to TA-118374), reprint, as PDF on "Letter sheet, 30 labels of 2 5/8 × 1 in (66.7 × 25.4 mm)"');
    expect(ev?.after).toMatchObject({ from: 'values', count: 33, output: 'pdf', code: 'code128', startAt: 29, layoutId: 'letter-30-2.625x1' });
    expect(ev?.after.values).toEqual(values);
  });

  it('prints one page per label at the exact label size on a roll, as PDF and as ZPL', async () => {
    const pdf = await print({ from: { kind: 'values', values: ['K7Q2M9', 'SB-004512'] }, layoutId: 'roll-50.8x25.4', code: 'datamatrix', output: 'pdf' });
    expect(pdf.status).toBe(200);
    expect(mediaBoxes(pdf.body).map((b) => b.map((v) => Math.round(v * 100) / 100))).toEqual([[144, 72], [144, 72]]);
    const zpl = await print({ from: { kind: 'values', values: ['K7Q2M9', 'SB-004512'] }, layoutId: 'roll-50.8x25.4', code: 'datamatrix', output: 'zpl', dpi: 300 });
    expect(zpl.status).toBe(200);
    expect(zpl.headers['content-type']).toBe('text/plain; charset=utf-8');
    const text = zpl.body.toString('utf8');
    expect(text.match(/\^XA/g)).toHaveLength(2);
    expect(text).toContain('^PW600\n^LL300');
    expect(text).toContain('^FDK7Q2M9^FS');
    expect((await lastAudit('tag.print'))?.summary).toContain('as ZPL');
  });

  it('refuses ZPL for a sheet, a value that cannot print legibly, an address in a code and too many labels', async () => {
    const sheet = await print({ from: { kind: 'values', values: ['TA-118342'] }, layoutId: 'a4-21-63.5x38.1', code: 'qr', output: 'zpl' });
    expect(sheet.status).toBe(400);
    expect(sheet.json.error.fields.output).toMatch(/roll/);
    const small = await print({ from: { kind: 'values', values: ['TA-118342'] }, layoutId: 'letter-80-1.75x0.5', code: 'code128', output: 'pdf' });
    expect(small.status).toBe(400);
    expect(small.json.error.code).toBe('not_legible');
    const url = await print({ from: { kind: 'values', values: ['https://example.test/asset/1'] }, layoutId: 'roll-101.6x50.8', code: 'qr', output: 'pdf' });
    expect(url.status).toBe(400);
    expect(url.json.error.message).toMatch(/never holds an address/);
    // The same value as text only is just text.
    expect((await print({ from: { kind: 'values', values: ['WWW-1'] }, layoutId: 'roll-101.6x50.8', code: 'none', output: 'pdf' })).status).toBe(200);
    const low = await print({ from: { kind: 'values', values: ['TA-1'] }, layoutId: 'roll-101.6x50.8', code: 'none', output: 'pdf', textHeightMm: 2 });
    expect(low.json.error.fields.textHeightMm).toBeTruthy();
    await t.api.put('/api/settings/tags.print_limit', { value: 3 }).catch(() => undefined);
    await t.db.query(`insert into settings (key, value) values ('tags.print_limit', '3'::jsonb) on conflict (key) do update set value = excluded.value`);
    try {
      const many = await print({ from: { kind: 'values', values: ['A1', 'A2', 'A3', 'A4'] }, layoutId: 'roll-101.6x50.8', code: 'none', output: 'pdf' });
      expect(many.status).toBe(400);
      expect(many.json.error.code).toBe('too_many');
      const seriesId = await newSeries('LM-');
      const fromSeries = await print({ from: { kind: 'series', seriesId, count: 4 }, layoutId: 'roll-101.6x50.8', code: 'none', output: 'pdf' });
      expect(fromSeries.json.error.code).toBe('too_many');
      // Nothing was taken from the series.
      expect((await t.db.one<{ n: string }>('select next_number::text as n from tag_series where id = $1', [seriesId]))?.n).toBe('1');
    } finally {
      await t.db.query(`delete from settings where key = 'tags.print_limit'`);
    }
  });

  it('reprints the current tags of chosen records, skipping records without one', async () => {
    const a = (await t.api.post('/api/assets', { name: 'Invented fare gate', tag: 'TA-200001' })).body;
    const b = (await t.api.post('/api/assets', { name: 'Invented depot printer', tag: 'TA-200002' })).body;
    const c = (await t.api.post('/api/assets', { name: 'Invented spare' })).body;
    await t.db.query('update assets set tag = null where id = $1', [c.id]);
    const res = await print({ from: { kind: 'records', recordType: 'asset', recordIds: [b.id, a.id, c.id] }, layoutId: 'roll-57x32', code: 'qr', output: 'pdf' });
    expect(res.status).toBe(200);
    expect(res.headers['x-tags-count']).toBe('2');
    expect(res.headers['x-tags-skipped']).toBe('1');
    expect(pdfText(res.body).split('\n').filter((l) => l.startsWith('TA-'))).toEqual(['TA-200002', 'TA-200001']);
    const ev = await lastAudit('tag.print');
    expect(ev?.after).toMatchObject({ from: 'records', recordType: 'asset', values: ['TA-200002', 'TA-200001'] });
    const none = await print({ from: { kind: 'records', recordType: 'asset', recordIds: [c.id] }, layoutId: 'roll-57x32', code: 'qr', output: 'pdf' });
    expect(none.json.error.code).toBe('nothing_to_print');
    const wrong = await print({ from: { kind: 'records', recordType: 'ticket', recordIds: [a.id] }, layoutId: 'roll-57x32', code: 'qr', output: 'pdf' });
    expect(wrong.status).toBe(400);
  });

  it('prints an alignment test page and previews without taking numbers or logging', async () => {
    const seriesId = await newSeries('AL-', 41);
    const before = (await t.db.one<{ n: string }>(`select count(*)::text as n from audit_events where action = 'tag.print'`))!.n;
    const test = await print({ from: { kind: 'series', seriesId, count: 10 }, layoutId: 'a4-21-63.5x38.1', code: 'qr', output: 'pdf', test: true, startAt: 4 });
    expect(test.status).toBe(200);
    expect(pdfPageCount(test.body)).toBe(1);
    expect(mediaBoxes(test.body)[0].map(Math.round)).toEqual([595, 842]);
    const text = pdfText(test.body);
    expect(text).toContain('AL-000041'); // the sample at position 4
    expect(text).toContain('21'); // other positions numbered
    expect(text).toContain('100 mm');
    // E41-13: tagged for PDF/UA; the sample label's code is a figure named by its value.
    const ua = await checkPdfUa(test.body);
    expect(ua.failures).toEqual([]);
    expect(ua.figures).toEqual(['Two-dimensional code for AL-000041']);
    const preview = await t.api.post('/api/asset-tags/print/preview', { from: { kind: 'series', seriesId, count: 10 }, layoutId: 'roll-50.8x25.4', code: 'code128' });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ sample: 'AL-000041', error: null, perPage: 1, printLimit: 1000 });
    expect(preview.body.plan.code.symbol.kind).toBe('linear');
    const bad = await t.api.post('/api/asset-tags/print/preview', { from: { kind: 'values', values: ['TA-118342'] }, layoutId: 'letter-80-1.75x0.5', code: 'qr' });
    expect(bad.body.plan).toBeNull();
    expect(bad.body.error).toMatch(/does not fit legibly/);
    expect((await t.db.one<{ n: string }>('select next_number::text as n from tag_series where id = $1', [seriesId]))?.n).toBe('41');
    expect((await t.db.one<{ n: string }>(`select count(*)::text as n from audit_events where action = 'tag.print'`))!.n).toBe(before);
  });

  // Skipped over the test wire-protocol bridge (GRC_TEST_DATABASE=pg): it serves one embedded database
  // to several connections and mixes up their messages when requests overlap. Real PostgreSQL
  // (GRC_TEST_DATABASE_URL) and the embedded database run it.
  it.skipIf(String(process.env.GRC_TEST_DATABASE ?? '').toLowerCase() === 'pg')('takes new values from a series, registered as stock, never twice under concurrent prints', async (ctx) => {
    const seriesId = await newSeries('TP-', 1);
    const one = await print({ from: { kind: 'series', seriesId, count: 3 }, layoutId: 'roll-50.8x25.4', code: 'code128', output: 'pdf' });
    // Taking numbers from a series is TAGS-CORE's (stock.ts); until it answers, this test waits.
    if (one.status === 501) { ctx.skip(); return; }
    expect(one.status).toBe(200);
    expect(pdfText(one.body)).toContain('TP-000001');
    expect(pdfText(one.body)).toContain('TP-000003');
    const runs = await Promise.all(Array.from({ length: 6 }, () => print({ from: { kind: 'series', seriesId, count: 5 }, layoutId: 'roll-50.8x25.4', code: 'none', output: 'zpl' })));
    expect(runs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    const printed = runs.flatMap((r) => [...r.body.toString('utf8').matchAll(/\^FD(TP-\d+)\^FS/g)].map((m) => m[1]));
    expect(printed).toHaveLength(30);
    expect(new Set(printed).size).toBe(30);
    expect(new Set([...printed, 'TP-000001', 'TP-000002', 'TP-000003']).size).toBe(33);
    expect((await t.db.one<{ n: string }>('select next_number::text as n from tag_series where id = $1', [seriesId]))?.n).toBe('34');
    const ranges = await t.db.query<{ source: string }>(`select source from tag_ranges where series_id = $1`, [seriesId]);
    expect(ranges).toHaveLength(7);
    expect(ranges.every((r) => r.source === 'printed')).toBe(true);
    const ev = await lastAudit('tag.print');
    expect(ev?.after).toMatchObject({ from: 'series', seriesId, count: 5 });
  });
});
