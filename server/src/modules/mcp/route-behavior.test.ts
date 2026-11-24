import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import { testApp } from '../../test/helpers.ts';

// Behavior test for GET /api/mcp/bridge [signed-in] (E40-05): the stdio bridge script, as a download.

let t: Awaited<ReturnType<typeof testApp>>;
const script = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../tools/mcp-stdio.mjs'), 'utf8');

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('GET /api/mcp/bridge', () => {
  it('downloads the bridge script, byte for byte, as a JavaScript attachment, for any signed-in person', async () => {
    const who = await t.as('requester'); // no other permission
    const token = await createSession(t.db, who.userId);
    const res = await t.app.inject({ method: 'GET', url: '/api/mcp/bridge', headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(script);
    expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="sandpiper-mcp-stdio.mjs"');
    expect((await t.api.get('/api/mcp/bridge')).text).toBe(script);
  });

  it('needs a session', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/mcp/bridge' });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toBe(script);
  });
});
