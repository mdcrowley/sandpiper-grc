import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { makeDocuments } from './documents.ts';
import { markdownToHtml } from './render.ts';
import { nextRun, runDueSchedules, zoned } from './schedule.ts';
import { seedStandard } from './seed.ts';
import { makeSnapshots } from './snapshots.ts';
import { STANDARD_DASHBOARDS } from './standard.ts';
import { fixtureModule, loadFixture } from './testing.ts';

// The test time zone is America/New_York (vitest.config.ts).
let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let lead: Client;
let agent: Client;
let reader: Client; // the agent's grants plus reports.export and dashboards.export
let report: any;

const audits = (action: string) => t.db.query<any>('select * from audit_events where action = $1 order by id', [action]);

beforeAll(async () => {
  t = await testApp({ extraModules: [fixtureModule] });
  const admin = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  await loadFixture(t.ctx, admin);
  lead = await t.as('security_lead');
  agent = await t.as('agent');
  const role = (await t.db.one<{ id: string }>(`insert into roles (key, name) values ('report_reader', 'Report reader') returning id`))!.id;
  await t.db.query(
    `insert into role_permissions (role_id, permission)
     select $1::uuid, permission from role_permissions where role_id = (select id from roles where key = 'agent')
     union select $1::uuid, unnest(array['reports.export', 'dashboards.export'])`, [role],
  );
  reader = await t.as('report_reader');
  report = (await lead.post('/api/reports', { name: 'Things by status', spec: { type: 'rt_thing', groupBy: [{ field: 'status' }] }, chart: { kind: 'bar' }, sharing: 'everyone' })).body;
});
afterAll(async () => { await t.close(); });

describe('exports', () => {
  it('needs reports.export and export permission on the records, and writes an audit event', async () => {
    // Agent: may view reports and export the records, but holds no reports.export.
    expect((await agent.get(`/api/reports/${report.id}/export?format=csv`)).status).toBe(403);
    expect((await agent.post('/api/reports/export', { spec: report.spec, format: 'csv' })).status).toBe(403);
    expect((await lead.get(`/api/reports/${report.id}/export?format=docx`)).status).toBe(400);

    const before = (await audits('report_definition.export')).length;
    const csv = await lead.get(`/api/reports/${report.id}/export?format=csv`);
    expect(csv.status).toBe(200);
    const lines = csv.text.replace('\ufeff', '').split('\r\n');
    expect(lines[0]).toBe('Status,Number of test things');
    expect(lines.slice(1, 4)).toEqual(['Brand new,1', 'In hand,3', 'Finished,2']);
    // The restricted thing is counted, but none of its details is in these figures: no watermark.
    expect(lines.length).toBe(4);
    const events = await audits('report_definition.export');
    expect(events.length).toBe(before + 1);
    expect(events.at(-1)).toMatchObject({ record_id: report.id, actor_id: lead.userId });
    expect(events.at(-1).summary).not.toContain('includes restricted records');
    // A list of the records does hold the restricted one, and is watermarked like a core restricted export.
    const rows = await lead.post('/api/reports/export', { format: 'csv', spec: { type: 'rt_thing', columns: ['name'] } });
    expect(rows.text).toContain('\r\nR');
    expect(rows.text.trimEnd().split('\r\n').at(-1)).toMatch(/^Restricted export by Test security_lead \d+ at 20/);
  });

  it('produces a print-ready document with no script, escaped text and the watermark when restricted', async () => {
    const named = (await lead.post('/api/reports', { name: '<script>alert(1)</script> & co', spec: { type: 'rt_thing', columns: ['name', 'amount', 'status'], filters: { op: 'and', items: [{ field: 'restricted', op: 'false' }] } } })).body;
    const html = await lead.get(`/api/reports/${named.id}/export?format=html`);
    expect(html.status).toBe(200);
    expect(html.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
    expect(html.text).not.toMatch(/<script/i);
    expect(html.text).toContain('Prepared for'.toLowerCase());
    expect(html.text).not.toContain('Restricted export by');
    const unsaved = await lead.post('/api/reports/export', { title: 'All things', format: 'html', spec: { type: 'rt_thing', columns: ['name', 'department'] } });
    expect(unsaved.text).toContain('Restricted export by');
    const chart = await lead.post('/api/reports/export', { title: 'All things', format: 'html', spec: { type: 'rt_thing', groupBy: [{ field: 'department' }] } });
    expect(chart.text).toContain('class="bars"');
    expect(chart.text).toContain('Restricted records'); // the restricted thing's department is masked, for everyone
    expect(chart.text).not.toContain('Restricted export by');
    expect(markdownToHtml('# Title\n\n<img src=x onerror=alert(1)> **bold**\n- one\n- two')).toBe(
      '<h3>Title</h3>\n<p>&lt;img src=x onerror=alert(1)&gt; <strong>bold</strong></p>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>');
  });

  it('exports a CSV of rows with labels, neutralising formulas', async () => {
    await t.ctx.resources.create('rt_thing', { name: '=HYPERLINK("http://x")', status: 'new', department: 'Formula' });
    const r = await lead.post('/api/reports/export', { format: 'csv', spec: { type: 'rt_thing', columns: ['name', 'status', 'amount'], filters: { op: 'and', items: [{ field: 'department', op: 'eq', value: 'Formula' }] } } });
    expect(r.text.replace('\ufeff', '').split('\r\n')).toEqual(['Name,Status,Amount', `"'=HYPERLINK(""http://x"")",Brand new,`]);
    await t.db.query(`update rt_things set deleted_at = now() where department = 'Formula'`);
  });

  it('leaves record types the person may not export out of a dashboard or pack document', async () => {
    const pm = await t.as('project_manager'); // tickets.view only: may view the things, may not export them
    const dash = (await lead.post('/api/dashboards', { name: 'Board', sharing: 'everyone', widgets: [{ id: 'a', kind: 'chart', title: 'Things by status', x: 0, y: 0, w: 6, h: 4, config: { spec: report.spec } }, { id: 't', kind: 'text', title: 'Note', x: 6, y: 0, w: 6, h: 2, config: { markdown: 'Read **me**' } }] })).body;
    expect((await pm.get(`/api/dashboards/${dash.id}/export`)).status).toBe(403); // no dashboards.export
    const doc = await lead.get(`/api/dashboards/${dash.id}/export`);
    expect(doc.status).toBe(200);
    expect(doc.text).toContain('Things by status');
    expect(doc.text).toContain('<strong>me</strong>');
    expect((await audits('dashboard.export')).at(-1).record_id).toBe(dash.id);
  });
});

describe('report packs', () => {
  it('previews, exports and freezes a pack; a frozen pack opens again only for people who could see its data', async () => {
    const doomed = (await lead.post('/api/reports', { name: 'Soon gone', sharing: 'everyone', spec: { type: 'rt_thing', aggregates: [{ fn: 'count' }] } })).body;
    const listing = (await lead.post('/api/reports', { name: 'Every thing', sharing: 'everyone', spec: { type: 'rt_thing', columns: ['name'] } })).body;
    const pack = (await lead.post('/api/report-packs', {
      name: 'Quarterly pack', cover_title: 'Quarterly report', cover_subtitle: 'For the committee', sharing: 'everyone',
      sections: [{ kind: 'text', title: 'Summary', body: 'All **fine**.' }, { kind: 'report', reportId: report.id }, { kind: 'report', reportId: doomed.id }, { kind: 'report', reportId: listing.id }],
    })).body;
    await lead.del(`/api/reports/${doomed.id}`);
    expect((await lead.post('/api/report-packs', { name: 'Bad', sections: [{ kind: 'video' }] })).status).toBe(400);
    expect((await lead.post('/api/report-packs', { name: 'Bad', sections: [{ kind: 'report', reportId: '00000000-0000-4000-8000-000000000000' }] })).status).toBe(400);

    const preview = await agent.get(`/api/report-packs/${pack.id}/preview`);
    expect(preview.body.sections.map((s: any) => s.kind)).toEqual(['text', 'report', 'report', 'report']);
    // The figures are everyone's; the list of records is the viewer's own.
    expect(preview.body.sections[1].result.total).toBe(6);
    expect(preview.body.sections[1].result).toMatchObject({ ...(await lead.get(`/api/report-packs/${pack.id}/preview`)).body.sections[1].result, generatedAt: expect.any(String) });
    expect(preview.body.sections[2].note).toContain('removed');
    expect(preview.body.sections[3].result.total).toBe(5);

    expect((await agent.post(`/api/report-packs/${pack.id}/produce`)).status).toBe(403);
    const made = await lead.post(`/api/report-packs/${pack.id}/produce`);
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ source_type: 'pack', restricted: true, for_user_id: lead.userId });
    expect((await audits('report_pack.produce')).at(-1).record_id).toBe(pack.id);

    const content = await lead.get(`/api/reports/snapshots/${made.body.id}/content`);
    expect(content.text).toContain('class="cover"');
    expect(content.text).toContain('Quarterly report');
    expect(content.text).toContain('<strong>fine</strong>');
    expect(content.text).toContain('In hand');
    // The reader may see and export the pack, but the frozen copy holds restricted figures.
    expect((await reader.get(`/api/reports/snapshots/${made.body.id}`)).status).toBe(404);
    expect((await reader.get(`/api/reports/snapshots/${made.body.id}/content`)).status).toBe(404);
    expect((await reader.get(`/api/report-packs/${pack.id}/snapshots`)).body).toEqual([]);
    const lead2 = await t.as('security_lead');
    expect((await lead2.get(`/api/report-packs/${pack.id}/snapshots`)).body.length).toBe(1);
    expect((await lead2.get(`/api/reports/snapshots/${made.body.id}/content`)).status).toBe(200);
    // Reading a stored copy in the application is viewing; downloading it is an export.
    await t.db.query(`insert into role_permissions (role_id, permission) select id, 'security.view' from roles where key = 'agent'`);
    expect((await agent.get(`/api/reports/snapshots/${made.body.id}`)).body.can_download).toBe(false);
    expect((await agent.get(`/api/reports/snapshots/${made.body.id}/content`)).status).toBe(200);
    expect((await agent.get(`/api/reports/snapshots/${made.body.id}/content?download=1`)).status).toBe(403);
    const dl = await lead2.get(`/api/reports/snapshots/${made.body.id}/content?download=1`);
    expect(dl.status).toBe(200);
    expect((await audits('report_snapshot.export')).at(-1).record_id).toBe(made.body.id);
    await t.db.query(`delete from role_permissions where permission = 'security.view' and role_id = (select id from roles where key = 'agent')`);
    // Once a saved report in the pack is no longer shared with a person, the copy stops opening for them.
    await lead.patch(`/api/reports/${report.id}`, { sharing: 'private' });
    expect((await lead2.get(`/api/reports/snapshots/${made.body.id}/content`)).status).toBe(404);
    await lead.patch(`/api/reports/${report.id}`, { sharing: 'everyone' });
    await lead.patch(`/api/report-packs/${pack.id}`, { sharing: 'private' });
    expect((await lead2.get(`/api/reports/snapshots/${made.body.id}/content`)).status).toBe(404);
    expect((await lead.get(`/api/reports/snapshots/${made.body.id}/content`)).status).toBe(200);
    await lead.patch(`/api/report-packs/${pack.id}`, { sharing: 'everyone' });
  });
});

describe('scheduled delivery', () => {
  it('works out the next run on the organization\'s clock', () => {
    const at = (iso: string) => new Date(iso);
    // Wednesday 18 November 2026, 12:00 UTC = 07:00 in the organization.
    expect(zoned(at('2026-11-18T12:00:00Z'))).toEqual({ y: 2026, m: 11, d: 18, h: 7, weekday: 3 });
    expect(nextRun({ cadence: 'daily', hour: 7 }, at('2026-11-18T11:59:00Z')).toISOString()).toBe('2026-11-18T12:00:00.000Z');
    expect(nextRun({ cadence: 'daily', hour: 7 }, at('2026-11-18T12:00:00Z')).toISOString()).toBe('2026-11-19T12:00:00.000Z');
    expect(nextRun({ cadence: 'weekly', weekday: 1, hour: 9 }, at('2026-11-18T12:00:00Z')).toISOString()).toBe('2026-11-23T14:00:00.000Z');
    expect(nextRun({ cadence: 'monthly', month_day: 31, hour: 6 }, at('2027-02-01T00:00:00Z')).toISOString()).toBe('2027-02-28T11:00:00.000Z');
    // Across the change to summer time the wall-clock hour stays the same.
    expect(nextRun({ cadence: 'daily', hour: 7 }, at('2027-03-13T12:00:00Z')).toISOString()).toBe('2027-03-14T11:00:00.000Z');
  });

  it('validates a schedule and keeps it to its owner', async () => {
    const base = { name: 'Weekly status', target_type: 'report', target_id: report.id, cadence: 'weekly', weekday: 1, hour: 7 };
    expect((await agent.post('/api/report-schedules', { ...base, recipient_roles: ['agent'] })).status).toBe(403);
    expect((await lead.post('/api/report-schedules', base)).body.error.fields.recipient_users).toBeTruthy();
    expect((await lead.post('/api/report-schedules', { ...base, target_id: '00000000-0000-4000-8000-000000000000', recipient_roles: ['agent'] })).status).toBe(400);
    expect((await lead.post('/api/report-schedules', { ...base, recipient_roles: ['nobody'] })).status).toBe(400);
    const made = await lead.post('/api/report-schedules', { ...base, recipient_roles: ['agent'] });
    expect(made.status).toBe(201);
    expect(new Date(made.body.next_run_at).getTime()).toBeGreaterThan(Date.now());
    expect((await (await t.as('security_lead')).get(`/api/report-schedules/${made.body.id}`)).status).toBe(404);
    await lead.del(`/api/report-schedules/${made.body.id}`);
  });

  it('renders once per recipient with that recipient\'s permissions, stores snapshots, notifies and logs', async () => {
    const exec = await t.as('executive_viewer'); // reports.view but no access to the records
    const auditor = await t.as('auditor');       // no reports.view
    const made = (await lead.post('/api/report-schedules', {
      name: 'Daily things', target_type: 'report', target_id: report.id, cadence: 'daily', hour: 7,
      recipient_users: [lead.userId, reader.userId, agent.userId, exec.userId, auditor.userId],
    })).body;
    const deps = { snapshots: makeSnapshots(t.ctx), documents: makeDocuments(t.ctx, async (_u, id) => t.db.one('select * from report_definitions where id = $1', [id])) };

    // Before its time: nothing happens.
    expect(await runDueSchedules(t.ctx, deps, new Date(new Date(made.next_run_at).getTime() - 60_000))).toEqual([]);
    const now = new Date(new Date(made.next_run_at).getTime() + 60_000);
    const [summary] = await runDueSchedules(t.ctx, deps, now);
    // An in-app copy is viewing: the agent (no export permission) receives one; the executive viewer
    // cannot see the records and the auditor cannot view reports, so they are skipped.
    expect(summary).toMatchObject({ delivered: 3, skipped: 2, failed: 0 });

    const mine = async (who: Client) => (await who.get('/api/reports/snapshots')).body.filter((s: any) => s.schedule_id === made.id);
    const [forLead] = await mine(lead);
    const [forAgent] = await mine(reader);
    expect(await mine(exec)).toEqual([]);
    const [forPlainAgent] = await mine(agent);
    const plain = await agent.get(`/api/reports/snapshots/${forPlainAgent.id}/content`);
    expect(plain.status).toBe(200);
    // Every recipient gets the same figures (the restricted thing counts for all, and shows for none).
    expect(plain.text).toContain('6 test things');
    expect((await agent.get(`/api/reports/snapshots/${forPlainAgent.id}/content?download=1`)).status).toBe(403);
    const leadDoc = (await lead.get(`/api/reports/snapshots/${forLead.id}/content`)).text;
    const agentDoc = (await reader.get(`/api/reports/snapshots/${forAgent.id}/content`)).text;
    const figures = (doc: string) => [...doc.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]);
    expect(leadDoc).toContain('6 test things');
    expect(agentDoc).toContain('6 test things');
    expect(figures(agentDoc)).toEqual(figures(leadDoc));
    expect(figures(agentDoc).length).toBeGreaterThan(0);
    expect(leadDoc).not.toContain('Restricted export by');
    expect(agentDoc).not.toContain('Restricted export by');
    expect(forAgent.restricted).toBe(false);
    expect(forLead.restricted).toBe(false);
    // A snapshot belongs to the person it was produced for.
    expect((await reader.get(`/api/reports/snapshots/${forLead.id}/content`)).status).toBe(404);
    expect((await lead.get(`/api/reports/snapshots/${forAgent.id}`)).status).toBe(404);

    const log = (await lead.get(`/api/report-schedules/${made.id}/deliveries`)).body;
    expect(log.map((d: any) => d.status).sort()).toEqual(['delivered', 'delivered', 'delivered', 'skipped', 'skipped']);
    expect((await audits('report_schedule.run')).at(-1)).toMatchObject({ record_id: made.id, actor_name: 'System' });
    if (t.app.hasDecorator('notify')) {
      const note = await t.db.one<any>('select * from notifications where user_id = $1 and route = $2', [reader.userId, `/reports/snapshots/${forAgent.id}`]);
      expect(note.title).toContain('Daily things');
    }

    // The schedule moved on by a day and does not run twice.
    const after = (await lead.get(`/api/report-schedules/${made.id}`)).body;
    expect(new Date(after.next_run_at).getTime()).toBe(new Date(made.next_run_at).getTime() + 86400000);
    expect(after.last_status).toBe('3 delivered, 2 skipped, 0 failed');
    expect(await runDueSchedules(t.ctx, deps, now)).toEqual([]);
    // Switched off: no next run.
    expect((await lead.patch(`/api/report-schedules/${made.id}`, { active: false })).body.next_run_at).toBeNull();
  });

  it('claims a due schedule before sending, so overlapping runs deliver it once (BS-3)', async () => {
    const made = (await lead.post('/api/report-schedules', {
      name: 'Claimed once', target_type: 'report', target_id: report.id, cadence: 'daily', hour: 7, recipient_users: [lead.userId],
    })).body;
    const deps = { snapshots: makeSnapshots(t.ctx), documents: makeDocuments(t.ctx, async (_u, id) => t.db.one('select * from report_definitions where id = $1', [id])) };
    const now = new Date(new Date(made.next_run_at).getTime() + 60_000);
    // The job and the "Run due" button (or two servers) at the same moment.
    const [a, b] = await Promise.all([runDueSchedules(t.ctx, deps, now), runDueSchedules(t.ctx, deps, now)]);
    const runs = [...a, ...b].filter((r) => r.scheduleId === made.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].delivered).toBe(1);
    const sent = await t.db.query<any>(`select status from report_deliveries where schedule_id = $1`, [made.id]);
    expect(sent.map((d: any) => d.status)).toEqual(['delivered']);
    expect(await t.db.query('select id from report_snapshots where schedule_id = $1', [made.id])).toHaveLength(1);
    // Claimed means moved on: the next run is tomorrow's.
    const after = await t.db.one<any>('select next_run_at from report_schedules where id = $1', [made.id]);
    expect(new Date(after.next_run_at).getTime()).toBe(new Date(made.next_run_at).getTime() + 86400000);
    await lead.del(`/api/report-schedules/${made.id}`);
  });

  it('delivers a dashboard as a document and can be run on demand by its owner', async () => {
    const dash = (await lead.post('/api/dashboards', { name: 'Morning board', sharing: 'everyone', widgets: [{ id: 'n', kind: 'number', title: 'Things on record', x: 0, y: 0, w: 3, h: 2, config: { spec: { type: 'rt_thing' } } }] })).body;
    const bad = await lead.post('/api/report-schedules', { name: 'x', target_type: 'dashboard', target_id: dash.id, format: 'csv', recipient_roles: ['agent'] });
    expect(bad.body.error.fields.format).toBeTruthy();
    const s = (await lead.post('/api/report-schedules', { name: 'Morning', target_type: 'dashboard', target_id: dash.id, cadence: 'monthly', month_day: 1, recipient_users: [reader.userId] })).body;
    expect((await agent.post(`/api/report-schedules/${s.id}/run-now`)).status).not.toBe(200);
    const ran = await lead.post(`/api/report-schedules/${s.id}/run-now`);
    expect(ran.body).toMatchObject({ delivered: 1, skipped: 0 });
    const doc = (await reader.get(`/api/reports/snapshots/${ran.body.snapshots[0]}/content`)).text;
    expect(doc).toContain('Things on record');
    expect(doc).toContain('<span class="figure-value">6</span>'); // the same number the owner sees
    // Once the dashboard is private, the reader is skipped, and the earlier copy no longer opens.
    await lead.patch(`/api/dashboards/${dash.id}`, { sharing: 'private' });
    const again = await lead.post(`/api/report-schedules/${s.id}/run-now`);
    expect(again.body).toMatchObject({ delivered: 0, skipped: 1 });
    expect((await reader.get(`/api/reports/snapshots/${ran.body.snapshots[0]}/content`)).status).toBe(404);
    expect((await reader.get('/api/reports/snapshots')).body.map((x: any) => x.id)).not.toContain(ran.body.snapshots[0]);

    // A spreadsheet can only be downloaded: people without export permission get the document instead.
    const csv = (await lead.post('/api/report-schedules', { name: 'As CSV', target_type: 'report', target_id: report.id, cadence: 'daily', format: 'csv', recipient_users: [agent.userId, reader.userId] })).body;
    const sent = (await lead.post(`/api/report-schedules/${csv.id}/run-now`)).body;
    expect(sent).toMatchObject({ delivered: 2 });
    const formats = await t.db.query<any>('select for_user_id, format from report_snapshots where schedule_id = $1', [csv.id]);
    expect(formats.find((f: any) => f.for_user_id === agent.userId).format).toBe('html');
    expect(formats.find((f: any) => f.for_user_id === reader.userId).format).toBe('csv');
  });
});

describe('standard dashboards and reports', () => {
  it('seeds once, keeps later edits, and every widget answers whether or not its module is loaded', async () => {
    expect(await seedStandard(t.ctx)).toMatch(/^7 dashboards, \d+ reports, 1 packs added$/);
    const first = (await t.api.get('/api/dashboards?pageSize=100')).body.rows.filter((d: any) => d.key);
    expect(first.map((d: any) => d.key).sort()).toEqual(STANDARD_DASHBOARDS.map((d) => d.key).sort());
    await t.api.patch(`/api/dashboards/${first[0].id}`, { name: 'Renamed by us' });
    expect(await seedStandard(t.ctx)).toBe('0 dashboards, 0 reports, 0 packs added');
    expect((await t.api.get(`/api/dashboards/${first[0].id}`)).body.name).toBe('Renamed by us');

    // Everyone with dashboards.view sees the standard dashboards; widgets never throw.
    for (const who of [t.api, agent]) {
      for (const d of (await who.get('/api/dashboards?pageSize=100')).body.rows.filter((x: any) => x.key)) {
        for (const w of d.widgets) {
          const r = await who.post('/api/dashboards/run-widget', { widget: w, dashboardId: d.id });
          expect(r.status, `${d.key}/${w.id}: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(200);
          expect(['ok', 'unavailable', 'forbidden'], `${d.key}/${w.id}: ${r.body.message}`).toContain(r.body.status);
        }
      }
    }
    // The standard reports run (or say plainly that their module is not here) for an administrator.
    for (const r of (await t.api.get('/api/reports?pageSize=100')).body.rows.filter((x: any) => x.key)) {
      const run = await t.api.get(`/api/reports/${r.id}/run`);
      expect([200, 409], `${r.key}: ${JSON.stringify(run.body).slice(0, 300)}`).toContain(run.status);
    }
  });
});
