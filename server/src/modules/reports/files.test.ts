import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import { readXlsx } from '../../core/import/xlsx.ts';
import { pdfPageCount, pdfText } from '../../core/export/testing.ts';
import type { ModuleDef } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';
import { runDueSchedules } from './schedule.ts';
import { makeDocuments } from './documents.ts';
import { makeSnapshots } from './snapshots.ts';
import { fixtureModule, loadFixture } from './testing.ts';

// PDF and Excel files of reports, dashboards and packs, and scheduled delivery in those formats.
let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let lead: Client;
let reader: Client;
let report: any;
let filtered: any;
// Stand-in for the email service: scheduled delivery must work with and without it.
const sent: any[] = [];
let mailOn = true;
const mailModule: ModuleDef = {
  key: 'testmail',
  async register(ctx) {
    const stub: any = async (mail: any) => { sent.push(mail); return { queued: mailOn ? 1 : 0, skipped: 0, enabled: mailOn, logIds: [] }; };
    // With every module loaded the email service may already be there: stand in for it.
    if (ctx.app.hasDecorator('sendMail')) (ctx.app as any).sendMail = stub;
    else ctx.app.decorate('sendMail', stub);
  },
};

async function raw(client: Client, url: string) {
  const cookie = await createSession(t.db, client.userId);
  const res = await t.app.inject({ method: 'GET', url, headers: { cookie: `${SESSION_COOKIE}=${cookie}` } });
  return { status: res.statusCode, body: res.rawPayload, type: String(res.headers['content-type'] ?? '') };
}

beforeAll(async () => {
  t = await testApp({ extraModules: [fixtureModule, mailModule] });
  const admin = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  await loadFixture(t.ctx, admin);
  lead = await t.as('security_lead');
  const role = (await t.db.one<{ id: string }>(`insert into roles (key, name) values ('file_reader', 'File reader') returning id`))!.id;
  await t.db.query(
    `insert into role_permissions (role_id, permission)
     select $1::uuid, permission from role_permissions where role_id = (select id from roles where key = 'agent')
     union select $1::uuid, unnest(array['reports.export', 'dashboards.export'])`, [role],
  );
  reader = await t.as('file_reader');
  report = (await lead.post('/api/reports', { name: 'Things by status', spec: { type: 'rt_thing', groupBy: [{ field: 'status' }] }, chart: { kind: 'bar' }, sharing: 'everyone' })).body;
  filtered = (await lead.post('/api/reports', {
    name: 'Open and finished things', sharing: 'everyone', chart: { kind: 'table' },
    spec: { type: 'rt_thing', columns: ['name', 'status', 'amount', 'opened_on'], filters: { op: 'and', items: [{ field: 'status', op: 'in', value: ['open', 'done'] }] }, sort: [{ by: 'name' }] },
  })).body;
});
afterAll(async () => { await t.close(); });

describe('report files', () => {
  it('makes a PDF with the title, the filters, a chart and the table, watermarked when restricted rows are listed', async () => {
    const res = await raw(lead, `/api/reports/${report.id}/export?format=pdf`);
    expect(res.status).toBe(200);
    expect(res.type).toBe('application/pdf');
    const text = pdfText(res.body);
    expect(text).toContain('Things by status');
    expect(text).toMatch(/As at .* · prepared for Test security_lead/);
    expect(text).toMatch(/ by Status/); // the chart's caption
    expect(text).toContain('Brand new');
    // Figures count the restricted thing for everyone and show none of its details: no watermark, same numbers.
    expect(text).not.toContain('RESTRICTED');
    expect(pdfPageCount(res.body)).toBe(1);
    const audit = await t.db.one<any>("select summary, after from audit_events where action = 'report_definition.export' order by id desc limit 1");
    expect(audit.summary).toContain('to PDF');
    expect(audit.after.format).toBe('pdf');

    const mine = pdfText((await raw(reader, `/api/reports/${report.id}/export?format=pdf`)).body);
    expect(mine).not.toContain('RESTRICTED');
    const figures = (s: string) => s.slice(s.indexOf('Brand new'));
    expect(figures(mine)).toBe(figures(text));
    // A list that holds the restricted thing is watermarked for the person who can see it.
    expect(pdfText((await raw(lead, `/api/reports/${filtered.id}/export?format=pdf`)).body)).toContain('RESTRICTED');
    expect(pdfText((await raw(reader, `/api/reports/${filtered.id}/export?format=pdf`)).body)).not.toContain('RESTRICTED');
  });

  it('lists the report filters in words and types the spreadsheet cells', async () => {
    const pdf = pdfText((await raw(lead, `/api/reports/${filtered.id}/export?format=pdf`)).body);
    expect(pdf).toContain('Filters: Status is any of In hand, Finished');
    const res = await raw(reader, `/api/reports/${filtered.id}/export?format=xlsx`);
    expect(res.type).toContain('spreadsheetml');
    const [sheet] = readXlsx(res.body);
    expect(sheet.name).toBe('Open and finished things');
    expect(sheet.rows[0]).toEqual(['Open and finished things']);
    expect(sheet.rows[1]).toEqual(['Filters: Status is any of In hand, Finished']);
    const header = sheet.rows.findIndex((r) => r[0] === 'Name');
    expect(sheet.rows[header]).toEqual(['Name', 'Status', 'Amount', 'Opened on']);
    expect(sheet.rows.slice(header + 1).filter((r) => r.length)).toEqual([
      ['B', 'In hand', 200, '2026-01-20'], ['C', 'In hand', 300, '2026-02-10'], ['D', 'Finished', 400, '2026-04-02'], ['E', 'Finished', null, '2026-04-03'],
    ].map((r) => r.map((v) => v)));
  });

  it('gives a dashboard one page per band of widgets, and a pack a cover page', async () => {
    const dash = (await lead.post('/api/dashboards', { name: 'Board', sharing: 'everyone', widgets: [
      { id: 'a', kind: 'chart', title: 'Things by status', x: 0, y: 0, w: 6, h: 4, config: { spec: report.spec } },
      { id: 't', kind: 'text', title: 'Note', x: 6, y: 0, w: 6, h: 2, config: { markdown: '- Read **me**' } },
      { id: 'b', kind: 'report', title: 'Second band', x: 0, y: 4, w: 12, h: 4, config: { reportId: filtered.id } },
    ] })).body;
    const res = await raw(lead, `/api/dashboards/${dash.id}/export?format=pdf`);
    expect(res.status).toBe(200);
    expect(pdfPageCount(res.body)).toBe(2);
    expect(pdfText(res.body)).toContain('Read me');
    const book = readXlsx((await raw(lead, `/api/dashboards/${dash.id}/export?format=xlsx`)).body);
    expect(book.map((s) => s.name)).toEqual(['Things by status', 'Second band']);
    expect((await raw(lead, `/api/dashboards/${dash.id}/export?format=csv`)).status).toBe(400);

    const pack = (await lead.post('/api/report-packs', { name: 'Board pack', cover_title: 'Quarterly board pack', sharing: 'everyone',
      sections: [{ kind: 'text', title: 'Summary', body: 'All **fine**.' }, { kind: 'report', reportId: report.id }] })).body;
    const file = await raw(lead, `/api/report-packs/${pack.id}/export?format=pdf`);
    const text = pdfText(file.body);
    expect(pdfPageCount(file.body)).toBe(3); // cover, summary, report
    expect(text).toContain('Quarterly board pack');
    expect(text).toContain('Page 3 of 3');
  });
});

describe('scheduled files', () => {
  it('stores a PDF or Excel snapshot for people who may export, and attaches it when the schedule asks and email is on', async () => {
    const s = (await lead.post('/api/report-schedules', {
      name: 'Weekly file', target_type: 'report', target_id: report.id, cadence: 'daily', hour: 7, format: 'pdf', email: 'attach',
      recipient_users: [lead.userId, reader.userId],
    })).body;
    expect(s.email).toBe('attach');
    expect(s.format).toBe('pdf');
    await t.db.query("update report_schedules set next_run_at = now() - interval '1 minute' where id = $1", [s.id]);
    const deps = { documents: makeDocuments(t.ctx, async (_u, id) => t.db.one('select * from report_definitions where id = $1', [id])), snapshots: makeSnapshots(t.ctx) };
    const [run] = await runDueSchedules(t.ctx, deps, new Date());
    expect(run.delivered).toBe(2);
    const snaps = await t.db.query<any>('select id, format, for_user_id from report_snapshots where schedule_id = $1', [s.id]);
    expect(snaps.map((x) => x.format)).toEqual(['pdf', 'pdf']);
    const leadSnap = snaps.find((x) => x.for_user_id === lead.userId);
    const got = await raw(lead, `/api/reports/snapshots/${leadSnap.id}/content`);
    expect(got.type).toBe('application/pdf');
    expect(got.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(sent.length).toBe(2);
    expect(sent[0].attachments[0]).toMatchObject({ contentType: 'application/pdf', filename: 'things-by-status.pdf' });
    // By user id, through the general message template, with a link and no figures in the text.
    expect(sent[0]).toMatchObject({ template: 'message', purpose: 'reports' });
    expect(sent.map((m) => m.userIds[0]).sort()).toEqual([lead.userId, reader.userId].sort());
    expect(sent[0].data.link).toMatch(/^\/reports\/snapshots\//);
    expect(sent[0].data.message).not.toMatch(/Brand new|In hand|Finished/);
    const log = await t.db.query<any>('select detail from report_deliveries where schedule_id = $1', [s.id]);
    expect(log.every((l) => /PDF attached is on its way/.test(l.detail))).toBe(true);
    const emailed = await t.db.query("select 1 from audit_events where action = 'report_snapshot.export' and summary like 'Emailed stored export%'");
    expect(emailed.length).toBe(2);
  });
});

describe('scheduled email (E12-10)', () => {
  const deps = () => ({ documents: makeDocuments(t.ctx, async (_u, id) => t.db.one('select * from report_definitions where id = $1', [id])), snapshots: makeSnapshots(t.ctx) });
  async function deliver(body: Record<string, unknown>) {
    const s = (await lead.post('/api/report-schedules', { name: `Email ${Math.random()}`, target_type: 'report', cadence: 'daily', hour: 7, ...body }));
    expect(s.status).toBe(201);
    await t.db.query("update report_schedules set next_run_at = now() - interval '1 minute' where id = $1", [s.body.id]);
    sent.length = 0;
    const [run] = await runDueSchedules(t.ctx, deps(), new Date());
    const log = await t.db.query<any>('select d.detail, d.user_id from report_deliveries d where d.schedule_id = $1', [s.body.id]);
    return { run, log, schedule: s.body };
  }

  it('emails a link by default, never the figures, and nothing when the schedule says no email', async () => {
    const { log, schedule } = await deliver({ target_id: report.id, format: 'xlsx', recipient_users: [lead.userId] });
    expect(schedule.email).toBe('link');
    expect(sent).toHaveLength(1);
    expect(sent[0].attachments).toBeUndefined();
    expect(sent[0].data.link).toMatch(/^\/reports\/snapshots\//);
    expect(log[0].detail).toBe('Email with a link is on its way.');

    const off = await deliver({ target_id: report.id, format: 'pdf', email: 'off', recipient_users: [lead.userId] });
    expect(sent).toHaveLength(0);
    expect(off.run.delivered).toBe(1);
  });

  it('never attaches restricted rows, nor a file to someone who may not export', async () => {
    const agent = await t.as('agent');
    const { log } = await deliver({ target_id: filtered.id, format: 'pdf', email: 'attach', recipient_users: [lead.userId, agent.userId] });
    expect(sent).toHaveLength(2);
    expect(sent.every((m) => !m.attachments)).toBe(true);
    const byUser = Object.fromEntries(log.map((l) => [l.user_id, l.detail]));
    expect(byUser[lead.userId]).toMatch(/not attached: it includes restricted records/);
    expect(byUser[agent.userId]).toMatch(/not attached: their role does not allow exporting/);
  });

  it('refuses to attach a print-ready document, and stays in the application while email is switched off', async () => {
    const bad = await lead.post('/api/report-schedules', { name: 'Bad', target_type: 'report', target_id: report.id, cadence: 'daily', format: 'html', email: 'attach', recipient_users: [lead.userId] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.email).toMatch(/Only a PDF, Excel or CSV file/);
    mailOn = false;
    try {
      const { run, log } = await deliver({ target_id: report.id, format: 'pdf', email: 'attach', recipient_users: [lead.userId] });
      expect(run.delivered).toBe(1);
      expect(log[0].detail ?? '').not.toMatch(/Email/);
    } finally { mailOn = true; }
    expect((await lead.get('/api/reports/email-status')).body).toEqual({ enabled: false });
  });

  it('runs due schedules from the job queue', async () => {
    const s = (await lead.post('/api/report-schedules', { name: 'Queued', target_type: 'report', target_id: report.id, cadence: 'daily', hour: 7, recipient_users: [lead.userId] })).body;
    await t.db.query("update report_schedules set next_run_at = now() - interval '1 minute' where id = $1", [s.id]);
    expect((await t.db.one<any>(`select type from job_schedules where name = 'reports.deliver'`))?.type).toBe('reports.deliver');
    await t.app.jobs.enqueue('reports.deliver', {});
    await t.app.jobs.runDue();
    const row = await t.db.one<any>('select last_status from report_schedules where id = $1', [s.id]);
    expect(row.last_status).toBe('1 delivered, 0 skipped, 0 failed');
  });
});
