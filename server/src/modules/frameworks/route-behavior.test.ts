import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Behavior test for GET /api/framework-outcomes/:id/context [frameworks.view] (E40-05): the framework,
// function and category an outcome sits in. Invented framework only.

const FILE = {
  key: 'rb-invented-standard', name: 'Invented Transit Standard', version: '2',
  functions: [
    { code: 'GV', name: 'Govern', color: 'purple', description: 'Invented governing function', categories: [
      { code: 'GV.A', name: 'Accountability', description: 'Invented category text', outcomes: [{ code: 'GV.A-1', text: 'Someone owns each outcome' }] },
    ] },
  ],
};

let t: Awaited<ReturnType<typeof testApp>>;
const ids: Record<string, string> = {};
let fw = '';

beforeAll(async () => {
  t = await testApp();
  const made = await t.api.post('/api/frameworks/import', FILE);
  expect(made.status).toBe(201);
  fw = made.body.framework_id;
  const board = (await t.api.get(`/api/frameworks/${fw}/board`)).body;
  for (const o of board.functions.flatMap((f: any) => f.categories.flatMap((c: any) => c.outcomes))) ids[o.code] = o.id;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('GET /api/framework-outcomes/:id/context', () => {
  it('answers the framework, function and category of an outcome', async () => {
    const res = await (await t.as('agent')).get(`/api/framework-outcomes/${ids['GV.A-1']}/context`); // frameworks.view
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      framework: { id: fw, key: 'rb-invented-standard', name: 'Invented Transit Standard', version: '2' },
      function: { code: 'GV', name: 'Govern', description: expect.anything(), color: 'purple' },
      category: { code: 'GV.A', name: 'Accountability', description: expect.anything() },
    });
  });

  it('answers 404 for an outcome that does not exist or was deleted, and needs frameworks.view', async () => {
    expect((await t.api.get('/api/framework-outcomes/00000000-0000-4000-8000-000000000701/context')).status).toBe(404);
    expect((await t.api.get('/api/framework-outcomes/not-a-uuid/context')).status).toBe(404);
    for (const role of ['project_manager', 'training_coordinator']) {
      expect((await (await t.as(role)).get(`/api/framework-outcomes/${ids['GV.A-1']}/context`)).status).toBe(403);
    }
    expect((await t.anon.get(`/api/framework-outcomes/${ids['GV.A-1']}/context`)).status).toBe(401);
  });
});
