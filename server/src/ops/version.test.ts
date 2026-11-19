import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { testApp } from '../test/helpers.ts';
import { appVersion } from './files.ts';
import { buildCommit, gitCommit } from './version.ts';

const scratch = mkdtempSync(join(tmpdir(), 'grc-version-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SHA = 'a'.repeat(40);

describe('installed version (E16-19)', () => {
  it('finds the commit of a checkout without git: a branch file, packed refs or a detached head', () => {
    const repo = (name: string, files: Record<string, string>) => {
      const root = join(scratch, name);
      for (const [f, text] of Object.entries(files)) {
        mkdirSync(join(root, '.git', f, '..'), { recursive: true });
        writeFileSync(join(root, '.git', f), text);
      }
      return root;
    };
    expect(gitCommit(repo('branch', { HEAD: 'ref: refs/heads/main\n', 'refs/heads/main': `${SHA}\n` }))).toBe(SHA);
    expect(gitCommit(repo('packed', { HEAD: 'ref: refs/heads/main\n', 'packed-refs': `# pack-refs\n${'b'.repeat(40)} refs/heads/main\n` }))).toBe('b'.repeat(40));
    expect(gitCommit(repo('detached', { HEAD: `${'C'.repeat(40)}\n` }))).toBe('c'.repeat(40));
    expect(gitCommit(join(scratch, 'not-a-repo'))).toBeNull();
    expect(buildCommit({ GRC_COMMIT: 'ABC1234' })).toBe('abc1234');
    expect(buildCommit({ GRC_COMMIT: 'not a commit' })).toBe(gitCommit());
  });

  it('tells signed-in people the version, administrators a little more, and nobody else anything', async () => {
    // The application registers the route itself (app.ts).
    const t = await testApp();
    try {
      const admin = await t.api.get('/api/version');
      expect(admin.status).toBe(200);
      expect(admin.body).toMatchObject({ version: appVersion(), node: process.version, database: expect.stringMatching(/embedded|server/) });
      expect('commit' in admin.body).toBe(true);

      const agent = await t.as('agent');
      const plain = await agent.get('/api/version');
      expect(plain.status).toBe(200);
      expect(Object.keys(plain.body).sort()).toEqual(['commit', 'version']);

      expect((await t.anon.get('/api/version')).status).toBe(401);
      const health = await t.anon.get('/api/health');
      expect(health.text).not.toContain(appVersion());

      const doc = await t.api.get('/api/openapi.json');
      expect(doc.body.paths['/api/v1/version'] ?? doc.body.paths['/api/version']).toBeTruthy();
    } finally {
      await t.close();
    }
  });
});
