// ci: every module (tools/ci/plan.mjs runs this for a change to any server module)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../test/helpers.ts';

// E18-44: the server lists the permissions something checks, so the role editor can grey out the rest.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

/** Permissions named literally in `can(...)`, `requirePerm(...)` and `permission:` in the server's own code. */
function namedInSource(): Map<string, string> {
  const root = join(import.meta.dirname, '..');
  const out = new Map<string, string>();
  const loaded = process.env.GRC_MODULES?.split(',');
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'test' || e.name.startsWith('_')) continue;
        if (dir.endsWith('modules') && loaded && !loaded.includes(e.name)) continue;
        walk(path);
      } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !e.name.includes('testing')) {
        const text = readFileSync(path, 'utf8');
        for (const re of [/\bcan\([^()]*?'([a-z_]+\.[a-z_]+)'/g, /requirePerm\('([a-z_]+\.[a-z_]+)'\)/g, /permission: '([a-z_]+\.[a-z_]+)'/g]) {
          for (const m of text.matchAll(re)) if (!out.has(m[1])) out.set(m[1], path.slice(root.length + 1));
        }
      }
    }
  };
  walk(root);
  return out;
}

describe('permissions the server checks', () => {
  it('needs the administration permission', async () => {
    expect((await (await t.as('agent')).get('/api/admin/permissions/checked')).status).toBe(403);
  });

  it('lists every permission the code checks by name, and the record-type actions', async () => {
    const res = await t.api.get('/api/admin/permissions/checked');
    expect(res.status).toBe(200);
    const checked = new Set<string>(res.body.checked);
    const missing = [...namedInSource()].filter(([perm]) => !checked.has(perm)).map(([perm, file]) => `${perm} (${file})`);
    expect(missing).toEqual([]);
    for (const p of ['admin.administer', 'audit.view']) expect(checked.has(p), p).toBe(true);
  });

  it('leaves out combinations nothing checks', async () => {
    const checked = new Set<string>((await t.api.get('/api/admin/permissions/checked')).body.checked);
    for (const p of ['audit.create', 'audit.delete', 'knowledge.approve', 'portal.export']) expect(checked.has(p), p).toBe(false);
  });
});
