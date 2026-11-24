import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signWebhook } from '../../core/webhooks.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';

// Behavior test for POST /api/admin/tracker-connectors/:id/secrets [admin.administer] (E40-05): both
// secrets are replaced and shown once, the old inbound secret stops working at once, a recent password
// confirmation is needed, and the audit event never holds a secret. No network is used.

let t: Awaited<ReturnType<typeof testApp>>;
const MISSING = '00000000-0000-4000-8000-000000000601';
const confirm = () => t.api.post('/api/auth/confirm', { password: ADMIN.password });

beforeAll(async () => {
  t = await testApp();
  await t.db.query(`insert into settings (key, value) values ('integrations.outbound_enabled', 'true'), ('integrations.allowed_hosts', '["127.0.0.1:9"]'::jsonb)
    on conflict (key) do update set value = excluded.value`);
}, 60_000);
afterAll(async () => { await t?.close(); });

function inbound(id: string, secret: string) {
  // A different body each time, so a refusal is never the replay check.
  const raw = JSON.stringify({ external_id: `INV-${Math.random().toString(36).slice(2)}`, status: 'Working' });
  const ts = Math.floor(Date.now() / 1000);
  return t.app.inject({
    method: 'POST', url: `/api/integrations/tracker/${id}/status`, payload: raw,
    headers: { 'content-type': 'application/json', 'x-grc-timestamp': String(ts), 'x-grc-signature': signWebhook(secret, ts, raw) },
  });
}

describe('POST /api/admin/tracker-connectors/:id/secrets', () => {
  it('replaces both secrets, shows them once, makes the old ones stop working, and audits without them', async () => {
    await confirm();
    const made = await t.api.post('/api/admin/tracker-connectors', { name: 'Invented work tracker', url: 'http://127.0.0.1:9/hook', record_types: ['action'], active: true });
    expect(made.status).toBe(201);
    const old = made.body;
    expect((await inbound(old.id, old.inboundSecret)).statusCode).not.toBe(401); // verified (the item itself is unknown)

    const res = await t.api.post(`/api/admin/tracker-connectors/${old.id}/secrets`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['inboundAddress', 'inboundSecret', 'secret']);
    expect(res.body.secret).not.toBe(old.secret);
    expect(res.body.inboundSecret).not.toBe(old.inboundSecret);
    expect(res.body.inboundAddress).toContain(`/api/integrations/tracker/${old.id}/status`);

    // Shown once: the list never carries them.
    const listed = JSON.stringify((await t.api.get('/api/admin/tracker-connectors')).body);
    expect(listed).not.toContain(res.body.secret);
    expect(listed).not.toContain(res.body.inboundSecret);
    // Stored sealed, never in the clear.
    const row = await t.db.one<any>('select secret_sealed, inbound_secret_sealed from ticket_connectors where id = $1', [old.id]);
    expect(JSON.stringify(row)).not.toContain(res.body.secret);

    expect((await inbound(old.id, old.inboundSecret)).statusCode).toBe(401);
    expect((await inbound(old.id, res.body.inboundSecret)).statusCode).not.toBe(401);

    const ev = await t.db.query<any>(`select * from audit_events where action = 'tracker_connector.secrets' and record_id = $1`, [old.id]);
    expect(ev).toHaveLength(1);
    expect(ev[0].summary).toBe('Work-tracker connection secrets replaced: Invented work tracker');
    for (const s of [res.body.secret, res.body.inboundSecret, old.secret]) expect(JSON.stringify(ev)).not.toContain(s);
  });

  it('needs admin.administer, a recent password confirmation and a connection that exists', async () => {
    await confirm();
    const made = (await t.api.post('/api/admin/tracker-connectors', { name: 'Invented second tracker', url: 'http://127.0.0.1:9/other', record_types: ['action'] })).body;
    const sealed = async () => (await t.db.one<any>('select secret_sealed from ticket_connectors where id = $1', [made.id])).secret_sealed;
    const before = await sealed();

    expect((await (await t.as('security_lead')).post(`/api/admin/tracker-connectors/${made.id}/secrets`)).status).toBe(403);
    expect((await (await t.as('agent')).post(`/api/admin/tracker-connectors/${made.id}/secrets`)).status).toBe(403);

    await t.db.query('update sessions set confirmed_at = null');
    const stale = await t.api.post(`/api/admin/tracker-connectors/${made.id}/secrets`);
    expect(stale.status).toBe(403);
    expect(stale.body.error.code).toBe('reauth_required');
    expect(await sealed()).toBe(before);
    expect(await t.db.query(`select 1 from audit_events where action = 'tracker_connector.secrets' and record_id = $1`, [made.id])).toHaveLength(0);

    await confirm();
    expect((await t.api.post(`/api/admin/tracker-connectors/${MISSING}/secrets`)).status).toBe(404);
    await t.api.del(`/api/admin/tracker-connectors/${made.id}`);
    expect((await t.api.post(`/api/admin/tracker-connectors/${made.id}/secrets`)).status).toBe(404);
  });
});
