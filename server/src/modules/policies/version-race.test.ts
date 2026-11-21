import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// BS-8: two requests for a new version of one policy at once (two people, or a double click) give
// one new version and a 409, never a 500. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t?.close(); });

describe('starting a policy version twice at once (BS-8)', () => {
  it('creates one version and refuses the other with version_open', async () => {
    const p = (await t.api.post('/api/policies', { title: 'Invented depot key control policy' })).body;
    // A slow moment between the check and the insert makes the requests overlap for certain.
    const db = t.db as unknown as { one: (sql: string, params?: unknown[]) => Promise<unknown> };
    const one = db.one.bind(t.db);
    db.one = async (sql, params) => {
      if (/max\(version\)/.test(sql)) await new Promise((r) => setTimeout(r, 30));
      return one(sql, params);
    };
    try {
      const body = { body: '## Purpose\n\nInvented text.' };
      const res = await Promise.all([1, 2, 3].map(() => t.api.post(`/api/policies/${p.id}/versions`, body)));
      expect(res.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      for (const r of res.filter((x) => x.status === 409)) expect(r.body.error.code).toBe('version_open');
    } finally {
      db.one = one;
    }
    const versions = (await t.api.get(`/api/policies/${p.id}/versions`)).body as { version: number }[];
    expect(versions.map((v) => v.version)).toEqual([1]);
  });
});
