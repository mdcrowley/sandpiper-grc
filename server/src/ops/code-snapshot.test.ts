import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { repoRoot } from './files.ts';

// tools/code-snapshot.mjs: what `grc.ps1 upgrade` uses to put the previous code back.
const tool = join(repoRoot, 'tools', 'code-snapshot.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'grc-code-snapshot-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function write(root: string, files: Record<string, string>) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}
function run(...args: string[]) {
  const r = spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || `exit ${r.status}`);
  return JSON.parse(r.stdout.trim());
}

describe('code snapshots for upgrade rollback', () => {
  it('saves the code, applies a new release, and puts the old code back exactly', () => {
    const app = join(scratch, 'app');
    write(app, {
      'package.json': '{"version":"1.0.0"}',
      'package-lock.json': '{"lock":1}',
      'server/src/core/migrations/001_core.sql': 'create table a();',
      'web/src/main.tsx': 'old web',
      'docs/notes.md': 'operator notes',
      'data/pg/PG_VERSION': '17', // data: never saved or touched
      'node_modules/x/index.js': 'package',
      'packages/api-client/node_modules/y/index.js': 'nested package', // installed packages at any depth: never saved
      'mobile/app.json': '{}', // the mobile app is built on its own: never saved
      'mobile/node_modules/z/index.js': 'app package',
      '.git/HEAD': 'ref',
      [`deep/${'d'.repeat(80)}/${'e'.repeat(80)}/file.txt`]: 'long path',
    });
    const snap = join(scratch, 'snapshots', 'pre-upgrade.tar');
    const saved = run('save', app, snap);
    expect(saved).toMatchObject({ files: 6, version: '1.0.0' });
    expect(run('version', snap)).toEqual({ version: '1.0.0' });

    const release = join(scratch, 'release');
    write(release, {
      'package.json': '{"version":"2.0.0"}',
      'package-lock.json': '{"lock":2}',
      'server/src/core/migrations/001_core.sql': 'create table a();',
      'server/src/core/migrations/002_new.sql': 'broken migration',
      'web/src/main.tsx': 'new web',
    });
    const applied = run('apply', app, release);
    expect(applied).toMatchObject({ version: '2.0.0', packagesChanged: true });
    expect(readFileSync(join(app, 'web/src/main.tsx'), 'utf8')).toBe('new web');
    expect(existsSync(join(app, 'docs/notes.md'))).toBe(true); // only server/src and web/src are pruned

    const back = run('restore', app, snap);
    expect(back).toMatchObject({ version: '1.0.0', packagesChanged: true, removed: 1 });
    expect(existsSync(join(app, 'server/src/core/migrations/002_new.sql'))).toBe(false);
    expect(readFileSync(join(app, 'web/src/main.tsx'), 'utf8')).toBe('old web');
    expect(readFileSync(join(app, 'package.json'), 'utf8')).toBe('{"version":"1.0.0"}');
    expect(readFileSync(join(app, 'data/pg/PG_VERSION'), 'utf8')).toBe('17');
    expect(existsSync(join(app, 'node_modules/x/index.js'))).toBe(true);
    expect(run('restore', app, snap)).toMatchObject({ written: 0, removed: 0, packagesChanged: false });
  });

  it('refuses a damaged snapshot or something that is not one', () => {
    const bad = join(scratch, 'bad.tar');
    writeFileSync(bad, Buffer.alloc(1024, 7));
    expect(() => run('restore', join(scratch, 'app'), bad)).toThrow(/damaged/);
    expect(() => run('apply', join(scratch, 'app'), scratch)).toThrow(/no package.json/);
  });
});
