import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { checkIntegrity, purgeRemoved, usage } from './housekeeping.ts';
import { runLinkCheckReminders } from './linkReminders.ts';
import { checkLinkAddress } from './links.ts';

// Evidence by link (E36-05): an address instead of a copy, never fetched, with a "last checked" date
// and a reminder (claimed before sending) when it has not been checked for a while. Invented types.
const sent: any[] = [];
const fixtures: ModuleDef = {
  key: 'testlinks',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists test_gauges (
        id uuid primary key default gen_random_uuid(), title text not null, owner_id uuid,
        restricted boolean not null default false,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    // A notifications stand-in with no "once" rule, so only the claim stops a second reminder.
    if (!ctx.app.hasDecorator('notify')) {
      (ctx.app as any).decorate('notify', async (input: any) => {
        sent.push(input);
        return { sent: (input.userIds ?? []).length, skipped: 0 };
      });
    }
    ctx.defineResource({
      type: 'gauge', table: 'test_gauges', module: 'audits', label: 'Gauge', plural: 'Gauges',
      path: '/api/gauges', route: '/gauges', titleField: 'title', restricted: 'flag', evidence: true,
      fields: {
        title: { label: 'Title', type: 'text', required: true }, owner_id: { label: 'Owner', type: 'user' },
        restricted: { label: 'Restricted', type: 'boolean', default: false },
      },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
let gauge: string;
let hidden: string;
let linkId: string;

beforeAll(async () => {
  process.env.GRC_MODULES = 'attachments';
  t = await testApp({ extraModules: [fixtures] });
  const admin = (await t.db.one<any>(`select id from users where username = 'admin'`)).id;
  gauge = (await t.api.post('/api/gauges', { title: 'Platform gauge', owner_id: admin })).body.id;
  hidden = (await t.api.post('/api/gauges', { title: 'Hidden gauge', restricted: true })).body.id;
});
afterAll(async () => { await t?.close(); });

const add = (body: Record<string, unknown>, client = t.api) => client.post('/api/attachments/link', { record_type: 'gauge', record_id: gauge, ...body });

describe('evidence by link', () => {
  it('accepts web addresses only, of a sensible length, without credentials', async () => {
    expect(checkLinkAddress('https://docs.example.test/policies/report.pdf')).toEqual({ url: 'https://docs.example.test/policies/report.pdf' });
    for (const bad of ['', 'ftp://files.example.test/x', 'javascript:alert(1)', 'file:///etc/passwd', 'docs.example.test/x',
      'https://user:pass@docs.example.test/x', `https://docs.example.test/${'a'.repeat(1000)}`]) {
      expect('error' in checkLinkAddress(bad)).toBe(true);
    }
    const r = await add({ url: 'ftp://files.example.test/report.pdf' });
    expect(r.status).toBe(400);
    expect(r.body.error.fields.url).toBeTruthy();
  });

  it('adds a link as evidence, never fetching it, and lists it beside files', async () => {
    const r = await add({ url: 'https://docs.example.test/share/abc123?token=secret-part', title: 'Inspection report 2026 (sample)', evidence: true });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ is_link: true, type_group: 'link', kind: 'evidence', link_title: 'Inspection report 2026 (sample)', last_checked_on: todayInZone(), size_bytes: 0 });
    linkId = r.body.id;
    const list = (await t.api.get(`/api/attachments?record_type=gauge&record_id=${gauge}`)).body.rows;
    expect(list).toHaveLength(1);
    expect(list[0].link_url).toBe('https://docs.example.test/share/abc123?token=secret-part');
    expect(list[0].checked_by_name).toBeTruthy();
    // The audit log keeps the host and a fingerprint, never the secret part of the address.
    const audit = await t.db.one<any>(`select after from audit_events where action = 'attachment.link' order by id desc limit 1`);
    expect(JSON.stringify(audit.after)).not.toContain('secret-part');
    expect(JSON.stringify(audit.after)).toContain('docs.example.test');
    // Nothing to download.
    expect((await t.api.get(`/api/attachments/${linkId}/download`)).body.error.code).toBe('is_link');
  });

  it('follows the record: view to see it, edit to add or change it, restricted stays hidden', async () => {
    const outsider = await t.as('agent'); // no audits permission at all
    expect((await outsider.get(`/api/attachments?record_type=gauge&record_id=${gauge}`)).status).toBe(404);
    expect((await add({ url: 'https://docs.example.test/x' }, outsider)).status).toBe(404);
    const viewer = await t.as('security_lead'); // audits.view only
    expect((await viewer.get(`/api/attachments?record_type=gauge&record_id=${gauge}`)).status).toBe(200);
    expect((await add({ url: 'https://docs.example.test/x' }, viewer)).status).toBe(403);
    expect((await viewer.post(`/api/attachments/${linkId}/checked`)).status).toBe(403);
    const auditLead = await t.as('audit_lead'); // audits.* but no security.view
    expect((await add({ url: 'https://docs.example.test/z' }, auditLead)).status).toBe(201);
    expect((await auditLead.post('/api/attachments/link', { record_type: 'gauge', record_id: hidden, url: 'https://docs.example.test/y' })).status).toBe(404);
    await t.db.query(`delete from attachments where link_url = 'https://docs.example.test/z'`);
  });

  it('changes the address and title, and stamps the check date', async () => {
    const changed = await t.api.patch(`/api/attachments/${linkId}`, { url: 'https://docs.example.test/share/v2', title: 'Inspection report v2 (sample)' });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ link_url: 'https://docs.example.test/share/v2', file_name: 'Inspection report v2 (sample)' });
    expect((await t.api.patch(`/api/attachments/${linkId}`, { url: 'mailto:someone@example.test' })).status).toBe(400);
    await t.db.query(`update attachments set last_checked_on = current_date - 30 where id = $1`, [linkId]);
    const checked = await t.api.post(`/api/attachments/${linkId}/checked`);
    expect(checked.body.last_checked_on).toBe(todayInZone());
  });

  it('reminds the owner once when a link has not been checked for the set period, even with two runs at once', async () => {
    await t.db.query(`update attachments set last_checked_on = $2::date - 91 where id = $1`, [linkId, todayInZone()]);
    sent.length = 0;
    const [a, b] = await Promise.all([runLinkCheckReminders(t.ctx), runLinkCheckReminders(t.ctx)]);
    expect(a.sent + b.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toContain('Check a linked document');
    expect((await runLinkCheckReminders(t.ctx)).sent).toBe(0);
    // Checking it re-arms the reminder for the next period; a shorter period makes it due sooner.
    await t.api.post(`/api/attachments/${linkId}/checked`);
    expect((await runLinkCheckReminders(t.ctx)).sent).toBe(0);
    await t.db.query(`insert into settings (key, value) values ('attachments.link_check_days', '1') on conflict (key) do update set value = excluded.value`);
    await t.db.query(`update attachments set last_checked_on = $2::date - 1 where id = $1`, [linkId, todayInZone()]);
    expect((await runLinkCheckReminders(t.ctx)).sent).toBe(1);
  });

  it('is left out of storage figures and checks, and removing it purges nothing', async () => {
    const u = await usage(t.ctx);
    expect(u.byDriver.some((d) => d.driver === 'link')).toBe(false);
    expect((await checkIntegrity(t.ctx)).missingCount).toBe(0);
    expect((await t.api.del(`/api/attachments/${linkId}`)).status).toBe(200);
    await t.db.query(`update attachments set deleted_at = now() - interval '400 days' where id = $1`, [linkId]);
    const purged = await purgeRemoved(t.ctx);
    expect(purged.failed).toBe(0);
    expect((await t.db.one<any>('select purged_at from attachments where id = $1', [linkId])).purged_at).toBeTruthy();
  });
});
