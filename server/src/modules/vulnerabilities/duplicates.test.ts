import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// E10-16: findings recorded before host and port matching that are now the same finding.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const finding = async (extra: Record<string, unknown>) => {
  const res = await t.api.post('/api/vulnerabilities', { title: 'Old protocol version accepted', severity: 'high', plugin_id: '920001', first_seen: '2030-01-10', ...extra });
  expect(res.status).toBe(201);
  return res.body;
};

describe('duplicate findings (E10-16)', () => {
  it('lists findings that share host, port and identifier, and merges them keeping history and files', async () => {
    const named = await finding({ host_name: 'depot-gw-01', host_ip: '10.9.0.4', port: '443/tcp', first_seen: '2030-02-01', last_seen: '2030-03-01' });
    const byAddress = await finding({ host_ip: '10.9.0.4', port: '443', first_seen: '2030-01-05', last_seen: '2030-01-20' });
    const other = await finding({ host_name: 'depot-gw-02', port: '443/tcp' });
    // As migration 002 leaves them: the same key, both still open.
    await t.db.query(`update vulnerabilities set host_key = 'depot-gw-01', port_key = '443/tcp' where id = any($1::uuid[])`, [[named.id, byAddress.id]]);

    const report = (await t.api.get('/api/vulnerabilities/duplicates')).body;
    expect(report.can_merge).toBe(true);
    const group = report.groups.find((g: any) => g.findings.some((f: any) => f.id === named.id));
    expect(group.findings.map((f: any) => f.id).sort()).toEqual([named.id, byAddress.id].sort());
    expect(report.groups.some((g: any) => g.findings.some((f: any) => f.id === other.id))).toBe(false);

    await t.api.post('/api/comments', { record_type: 'vulnerability', record_id: byAddress.id, body: 'Seen by the address scan first.' });
    await t.api.post('/api/links', { from_type: 'vulnerability', from_id: byAddress.id, to_type: 'vulnerability', to_id: other.id, relation: 'related' });

    expect((await t.api.post('/api/vulnerabilities/duplicates/merge', { keep_id: named.id, merge_ids: [other.id] })).body.error.code).toBe('not_duplicates');
    const lead = await t.as('security_lead');
    const agent = await t.as('agent');
    expect((await agent.post('/api/vulnerabilities/duplicates/merge', { keep_id: named.id, merge_ids: [byAddress.id] })).status).toBe(403);

    const merged = await lead.post('/api/vulnerabilities/duplicates/merge', { keep_id: named.id, merge_ids: [byAddress.id] });
    expect(merged.status).toBe(200);
    expect(merged.body).toMatchObject({ kept: { id: named.id }, moved: { comments: 1, links: 1 }, first_seen: '2030-01-05' });

    const kept = (await t.api.get(`/api/vulnerabilities/${named.id}`)).body;
    expect(kept).toMatchObject({ first_seen: '2030-01-05', last_seen: '2030-03-01' });
    expect((await t.api.get(`/api/vulnerabilities/${byAddress.id}`)).status).toBe(404);
    const comments = (await t.api.get(`/api/comments?record_type=vulnerability&record_id=${named.id}`)).body;
    expect(JSON.stringify(comments)).toContain('Seen by the address scan first.');
    const history = (await t.api.get(`/api/history?record_type=vulnerability&record_id=${named.id}`)).body;
    const event = history.find((h: any) => h.action === 'vulnerability.merge');
    expect(event.summary).toContain(byAddress.ref);
    expect(JSON.stringify(event.before)).toContain('10.9.0.4');

    expect((await t.api.get('/api/vulnerabilities/duplicates')).body.groups.some((g: any) => g.findings.some((f: any) => f.id === named.id))).toBe(false);
    expect((await lead.post('/api/vulnerabilities/duplicates/merge', { keep_id: named.id, merge_ids: [byAddress.id] })).status).toBe(404);
  });
});
