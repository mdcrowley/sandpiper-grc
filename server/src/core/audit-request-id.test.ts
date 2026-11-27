import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from './auth.ts';
import { testApp } from '../test/helpers.ts';

// E13-20: the audit search finds every event of one request by its X-Request-Id, and the CSV
// export carries the token and the request id.

let t: Awaited<ReturnType<typeof testApp>>;
let cookie = '';

beforeAll(async () => {
  t = await testApp();
  const admin = (await t.db.one<{ id: string }>("select id from users where username = 'admin'"))!;
  cookie = await createSession(t.db, admin.id);
});
afterAll(async () => { await t.close(); });

const call = (method: 'GET' | 'POST', url: string, payload?: object, requestId?: string) => t.app.inject({
  method, url, payload,
  headers: { cookie: `${SESSION_COOKIE}=${cookie}`, 'x-grc-csrf': '1', ...(requestId ? { 'x-request-id': requestId } : {}) },
});

describe('audit events by request id', () => {
  it('filters by request_id and exports token_name and request_id', async () => {
    const res = await call('POST', '/api/lookups', { list_key: 'test_colors', value: 'teal', label: 'Teal' }, 'req-e13-20-alpha');
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers['x-request-id']).toBe('req-e13-20-alpha');
    await call('POST', '/api/lookups', { list_key: 'test_colors', value: 'navy', label: 'Navy' }, 'req-e13-20-beta');

    const one = (await t.api.get('/api/audit?request_id=req-e13-20-alpha')).body;
    expect(one.total).toBeGreaterThan(0);
    expect(one.rows.every((e: { request_id: string }) => e.request_id === 'req-e13-20-alpha')).toBe(true);
    expect(JSON.stringify(one.rows)).toContain('Teal');
    expect(JSON.stringify(one.rows)).not.toContain('Navy');
    expect((await t.api.get('/api/audit?request_id=no-such-request')).body.total).toBe(0);
    expect((await t.api.get(`/api/audit?request_id=${'x'.repeat(201)}`)).status).toBe(400);

    const csv = (await t.api.get('/api/audit?request_id=req-e13-20-alpha&format=csv')).text;
    const [header, first] = csv.replace(/^﻿/, '').split('\r\n');
    expect(header).toBe('id,at,actor_name,token_name,on_behalf_name,request_id,ip,action,record_type,record_id,summary,before,after');
    expect(first.split(',')[5]).toBe('req-e13-20-alpha');
  });

  it('needs audit.view', async () => {
    const agent = await t.as('agent');
    expect((await agent.get('/api/audit?request_id=req-e13-20-alpha')).status).toBe(403);
  });
});
