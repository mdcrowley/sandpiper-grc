import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../auth.ts';
import { testApp } from '../../test/helpers.ts';
import { readXlsx } from '../import/xlsx.ts';
import { gizmos, pdfPageCount, pdfText, xlsxParts } from './testing.ts';
import { columnName, sheetName, writeXlsx } from './xlsx.ts';
import { PdfBuilder, printable } from './pdf.ts';

let t: Awaited<ReturnType<typeof testApp>>;
let adminCookie = '';
let adminId = '';

/** A GET that keeps the body as bytes (the test client reads text). */
async function raw(url: string, cookie = adminCookie) {
  const res = await t.app.inject({ method: 'GET', url, headers: { cookie: `${SESSION_COOKIE}=${cookie}` } });
  return { status: res.statusCode, body: res.rawPayload, type: String(res.headers['content-type'] ?? ''), disposition: String(res.headers['content-disposition'] ?? '') };
}
async function cookieFor(roleKey: string) {
  const c = await t.as(roleKey);
  return { client: c, cookie: await createSession(t.db, c.userId) };
}

beforeAll(async () => {
  t = await testApp({ extraModules: [gizmos] });
  adminId = (await t.db.one<{ id: string }>("select id from users where username = 'admin'"))!.id;
  adminCookie = await createSession(t.db, adminId);
  const mk = (body: Record<string, unknown>) => t.api.post('/api/gizmos', body);
  await mk({ name: 'Farebox reader', status: 'open', owner_id: adminId, due_on: '2026-03-14', seen_at: '2026-03-14T15:30:00Z', cost: 1250.5, units: 3, active: true, notes: '=SUM(A1)' });
  await mk({ name: 'Depot gate controller', status: 'in_repair', due_on: '2026-01-02', cost: 99, units: 1, active: false });
  await mk({ name: 'Hidden dispatch console', status: 'open', restricted: true, cost: 10 });
  for (let i = 0; i < 70; i++) await mk({ name: `Platform display ${String(i).padStart(2, '0')}`, status: 'done', units: i });
});
afterAll(async () => { await t.close(); });

describe('XLSX writer', () => {
  it('names columns and sheets the way spreadsheets expect', () => {
    expect([0, 25, 26, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'ZZ', 'AAA']);
    const taken = new Set<string>();
    expect(sheetName('Risks: top/10 [draft]', taken)).toBe('Risks  top 10  draft');
    expect(sheetName('Risks: top/10 [draft]', taken)).toBe('Risks  top 10  draft 2');
    expect(sheetName('A very long sheet name that goes on and on', taken).length).toBeLessThanOrEqual(31);
  });

  it('round-trips typed cells through the reader', () => {
    const file = writeXlsx({
      sheets: [{
        name: 'Data',
        columns: [{ header: 'Name', type: 'text' }, { header: 'Due', type: 'date' }, { header: 'Seen', type: 'datetime' }, { header: 'Cost', type: 'currency' }, { header: 'Ok', type: 'boolean' }],
        rows: [['Bus <1> & "two"', '2026-03-14', new Date('2026-03-14T15:30:00Z'), 12.5, true], ['=1+1', null, null, null, false]],
      }],
    });
    const [sheet] = readXlsx(file);
    expect(sheet.rows[0]).toEqual(['Name', 'Due', 'Seen', 'Cost', 'Ok']);
    expect(sheet.rows[1][0]).toBe('Bus <1> & "two"');
    expect(sheet.rows[1][1]).toBe('2026-03-14');
    // The date and time is written as the organization's clocks read it, and read back to the same instant.
    expect(sheet.rows[1][2]).toBe('2026-03-14T15:30:00.000Z');
    expect(sheet.rows[1][3]).toBe(12.5);
    expect(sheet.rows[1][4]).toBe('Yes');
    // Text that looks like a formula stays text.
    expect(sheet.rows[2][0]).toBe('=1+1');
    expect(xlsxParts(file)['xl/worksheets/sheet1.xml']).not.toContain('<f>');
  });
});

describe('list export to XLSX', () => {
  it('respects filters, sort and chosen columns, types the cells and is audited', async () => {
    const res = await raw('/api/gizmos?format=xlsx&f.status=open,in_repair&sort=name&dir=asc&columns=name,status,owner_id,due_on,seen_at,cost,active');
    expect(res.status).toBe(200);
    expect(res.type).toContain('spreadsheetml');
    expect(res.disposition).toContain('gizmos.xlsx');
    const parts = xlsxParts(res.body);
    const sheet = parts['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toMatch(/<autoFilter ref="A1:G4"\/>/);
    expect(sheet).toContain('customWidth="1"');
    expect(parts['xl/styles.xml']).toContain('formatCode="yyyy-mm-dd"');
    const [read] = readXlsx(res.body);
    expect(read.rows[0]).toEqual(['Name', 'Status', 'Owner', 'Due', 'Last seen', 'Cost', 'In service']);
    expect(read.rows.slice(1, 4).map((r) => r[0])).toEqual(['Depot gate controller', 'Farebox reader', 'Hidden dispatch console']);
    const farebox = read.rows[2];
    expect(farebox).toEqual(['Farebox reader', 'Open', 'Test Admin', '2026-03-14', '2026-03-14T15:30:00.000Z', 1250.5, 'Yes']);
    // Dates are real date cells with a date style; amounts are numbers with the currency style.
    expect(sheet).toMatch(/<c r="D3" s="2"><v>46095<\/v><\/c>/);
    expect(sheet).toMatch(/<c r="F3" s="4"><v>1250.5<\/v><\/c>/);
    // An admin sees the restricted row, so the file says so.
    expect(read.rows.at(-1)?.[0]).toMatch(/^Restricted export by Test Admin at /);
    const audit = await t.db.one<{ summary: string; after: any }>("select summary, after from audit_events where action = 'gizmo.export' order by id desc limit 1");
    expect(audit!.summary).toBe('Exported 3 gizmos to Excel (XLSX) (includes restricted records)');
    expect(audit!.after.columns).toEqual(['name', 'status', 'owner_id', 'due_on', 'seen_at', 'cost', 'active']);
  });

  it('leaves restricted records out for people without security.view, with no watermark', async () => {
    const { cookie } = await cookieFor('agent');
    const res = await raw('/api/gizmos?format=xlsx&f.status=open', cookie);
    expect(res.status).toBe(200);
    const [read] = readXlsx(res.body);
    const names = read.rows.slice(1).map((r) => r[read.rows[0].indexOf('Name')]);
    expect(names).toContain('Farebox reader');
    expect(names).not.toContain('Hidden dispatch console');
    expect(JSON.stringify(read.rows)).not.toContain('Restricted export');
  });

  it('needs export permission', async () => {
    const { cookie } = await cookieFor('project_manager'); // tickets.view only
    expect((await raw('/api/gizmos?format=xlsx', cookie)).status).toBe(403);
    expect((await raw('/api/gizmos?format=pdf', cookie)).status).toBe(403);
  });

  it('applies chosen columns to CSV too, and keeps every field when none are chosen', async () => {
    const csv = await t.api.get('/api/gizmos?format=csv&columns=ref,name&f.status=in_repair');
    expect(csv.text.split('\r\n')[0]).toBe('﻿Reference,Name');
    const all = await t.api.get('/api/gizmos?format=csv&f.status=in_repair');
    expect(all.text.split('\r\n')[0]).toContain('Reference,Name,Notes,Status');
  });
});

describe('list export to PDF', () => {
  it('prints a title, the filters, a table that repeats its header, page numbers', async () => {
    const res = await raw('/api/gizmos?format=pdf&f.status=done&sort=name&columns=ref,name,status,units');
    expect(res.status).toBe(200);
    expect(res.type).toBe('application/pdf');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = pdfPageCount(res.body);
    expect(pages).toBeGreaterThan(1);
    const text = pdfText(res.body);
    expect(text).toContain('Gizmos');
    expect(text).toContain('Filters: Status: Done');
    expect(text).toContain('Sorted by name');
    expect(text).toContain('Platform display 69');
    expect(text).toContain(`Page ${pages} of ${pages}`);
    // The header row is printed again on every page of the table.
    expect(text.split('\n').filter((l) => l === 'Reference').length).toBe(pages);
    expect(text).not.toContain('RESTRICTED');
  });

  it('watermarks restricted content on every page', async () => {
    const res = await raw('/api/gizmos?format=pdf&q=Hidden');
    const text = pdfText(res.body);
    expect(text).toContain('RESTRICTED');
    expect(text).toMatch(/Restricted export by Test Admin at /);
    const audit = await t.db.one<{ summary: string }>("select summary from audit_events where action = 'gizmo.export' order by id desc limit 1");
    expect(audit!.summary).toBe('Exported 1 gizmos to PDF (includes restricted records)');
  });

  it('prints only Windows-1252 text with the standard fonts', () => {
    expect(printable('Bus – “Depot” café ✓ 東京')).toBe('Bus – “Depot” café ? ??');
  });

  it('draws bar, line and pie charts', async () => {
    const pdf = new PdfBuilder({ title: 'Charts', meta: ['Generated today'] });
    const points = [{ label: 'Open', value: 4 }, { label: 'Done', value: 9 }];
    pdf.chart('bar', points, 'By status');
    pdf.chart('line', points, 'Over time');
    pdf.chart('pie', points, 'Share');
    const file = await pdf.finish();
    const text = pdfText(file);
    expect(text).toContain('By status');
    expect(text).toContain('Done: 9 (69.23%)');
    expect(pdfPageCount(file)).toBe(1);
  });
});

describe('record fact sheet', () => {
  it('prints the fields and history of one record, audited', async () => {
    const row = (await t.api.get('/api/gizmos?q=Farebox')).body.rows[0];
    const res = await raw(`/api/records/gizmo/${row.id}/pdf`);
    expect(res.status).toBe(200);
    expect(res.disposition).toMatch(/gizmo-gz-\d+\.pdf/);
    const text = pdfText(res.body);
    expect(text).toContain(`${row.ref} Farebox reader`);
    expect(text).toContain('Test Admin');
    expect(text).toContain('Mar 14, 2026');
    expect(text).toContain('Recent history');
    const audit = await t.db.one<{ summary: string }>("select summary from audit_events where action = 'gizmo.export' and record_id = $1", [row.id]);
    expect(audit!.summary).toContain('Fact sheet of gizmo');
  });

  it('hides restricted records and needs export permission', async () => {
    const hidden = (await t.api.get('/api/gizmos?q=Hidden')).body.rows[0];
    const sheet = await raw(`/api/records/gizmo/${hidden.id}/pdf`);
    expect(pdfText(sheet.body)).toContain('RESTRICTED');
    const agent = await cookieFor('agent');
    expect((await raw(`/api/records/gizmo/${hidden.id}/pdf`, agent.cookie)).status).toBe(404);
    const pm = await cookieFor('project_manager');
    const open = (await t.api.get('/api/gizmos?q=Farebox')).body.rows[0];
    expect((await raw(`/api/records/gizmo/${open.id}/pdf`, pm.cookie)).status).toBe(404);
    expect((await raw(`/api/records/nothing/${open.id}/pdf`)).status).toBe(404);
  });
});
