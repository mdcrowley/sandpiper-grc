import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// E39-07: the assistant reads a model and its members over the real /mcp endpoint. Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
let client: Client;

beforeAll(async () => {
  t = await testApp();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
  expect((await t.api.put('/api/mcp/admin/settings', { enabled: true })).status).toBe(200);
  const model = (await t.api.post('/api/vehicle-models', { name: 'Invented Harrowgate 10', mode: 'bus', make: 'Harrowgate', model: 'H10', capacity: 60 })).body;
  for (const [n, cap] of [['HG-1', undefined], ['HG-2', 55]] as const) {
    const res = await t.api.post('/api/vehicles', { fleet_number: n, model_id: model.id, ...(cap ? { capacity: cap } : {}) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }
  const token = (await t.api.post('/api/mcp/tokens', { name: 'Invented assistant', access: 'read', expiresInDays: 7 })).body.token as string;
  client = new Client({ name: 'models-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
}, 60_000);
afterAll(async () => { await client?.close(); await t?.close(); });

describe('vehicle_model_members', () => {
  it('reads a vehicle model by name, its shared values and its members with their overrides', async () => {
    expect((await client.listTools()).tools.map((x) => x.name)).toContain('vehicle_model_members');
    const r: any = await client.callTool({ name: 'vehicle_model_members', arguments: { model: 'Invented Harrowgate 10' } });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    const data = r.structuredContent;
    expect(data.members).toBe(2);
    expect(data.model.shared).toMatchObject({ Make: 'Harrowgate', 'Passenger capacity': 60 });
    expect(data.overridden).toEqual([{ field: 'capacity', label: 'Passenger capacity', count: 1 }]);
    expect(data.listed.find((m: any) => m.title === 'HG-2').overrides).toEqual(['Passenger capacity']);
    const text = r.content.map((c: any) => c.text).join('\n');
    expect(text).toContain('2 vehicles');
    expect(text).toContain('HG-2 (keeps its own Passenger capacity)');
  });
});
