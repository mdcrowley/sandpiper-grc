import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// BW-06: the web app offers "New project request" (sidebar, Create menu, portfolio button) only to
// people who may send one. Who may is a setting, so the server lists the grant "projects.request"
// with the permissions in /api/auth/state for exactly those people.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

const grants = async (role: string) => ((await (await t.as(role)).get('/api/auth/state')).body.permissions as string[]);

describe('who is offered a project request', () => {
  it('follows the "who may send requests" setting', async () => {
    expect(await grants('requester')).not.toContain('projects.request');
    expect((await t.api.get('/api/auth/state')).body.permissions).toContain('projects.request'); // holds projects.create

    expect((await t.api.put('/api/projects/settings', { intakeOpenTo: 'everyone' })).status).toBe(200);
    expect(await grants('requester')).toContain('projects.request');
    expect((await (await t.as('requester')).get('/api/projects/intake')).body.allowed).toBe(true);

    expect((await t.api.put('/api/projects/settings', { intakeOpenTo: 'create' })).status).toBe(200);
    expect(await grants('requester')).not.toContain('projects.request');
  });
});
