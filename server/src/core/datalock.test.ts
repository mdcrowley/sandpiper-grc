import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireDataLock, DataLockError, isHeld, LOCK_FILE, lockHolder, REUSED_PID_MS, STALE_MS } from './datalock.ts';

// OP-06: nothing stopped a second server (or a command) from opening the same embedded database.
const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'grc-lock-'));
  dirs.push(d);
  return d;
};
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** A process id that existed a moment ago and has now ended. */
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid!;
const writeLock = (dir: string, info: object, ageMs = 0) => {
  const path = join(dir, LOCK_FILE);
  writeFileSync(path, JSON.stringify({ token: 'other', purpose: 'server', startedAt: '2026-01-01T00:00:00Z', ...info }));
  const at = new Date(Date.now() - ageMs);
  utimesSync(path, at, at);
};

describe('data folder lock (OP-06)', () => {
  it('lets one process take a folder and refuses the next, naming the holder', () => {
    const dir = tempDir();
    const lock = acquireDataLock(dir, 'server');
    expect(JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8'))).toMatchObject({ pid: process.pid, host: hostname(), purpose: 'server' });
    expect(lockHolder(dir)).toMatchObject({ pid: process.pid, purpose: 'server' });
    // A second process on this host with a live id: the test runner's parent stands in for it.
    const other = tempDir();
    writeLock(other, { pid: process.ppid, host: hostname() });
    expect(() => acquireDataLock(other, 'seed')).toThrow(DataLockError);
    expect(() => acquireDataLock(other, 'seed')).toThrow(/A server \(process \d+.*is using this data folder/);
    lock.release();
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false);
    acquireDataLock(dir, 'backup').release();
  });

  it('takes over a lock left by a process that has ended', () => {
    const dir = tempDir();
    writeLock(dir, { pid: deadPid(), host: hostname() });
    expect(lockHolder(dir)).toBeNull();
    const lock = acquireDataLock(dir);
    expect(JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8')).pid).toBe(process.pid);
    lock.release();
  });

  it('judges a lock from another host (a container on a shared volume) by its heartbeat', () => {
    const dir = tempDir();
    writeLock(dir, { pid: 1, host: 'another-container' });
    expect(() => acquireDataLock(dir)).toThrow(/process 1 on another-container/);
    writeLock(dir, { pid: 1, host: 'another-container' }, STALE_MS + 1000);
    acquireDataLock(dir).release();
  });

  it('treats its own process id as an earlier life of a restarted container, by heartbeat', () => {
    const self = { pid: 1, host: 'box' };
    expect(isHeld({ pid: 1, host: 'box' }, new Date(), Date.now(), self)).toBe(true);
    expect(isHeld({ pid: 1, host: 'box' }, new Date(Date.now() - STALE_MS - 1), Date.now(), self)).toBe(false);
  });

  it('does not trust a live process id whose heartbeat stopped long ago (the id was reused)', () => {
    const self = { pid: process.pid, host: hostname() };
    expect(isHeld({ pid: process.ppid, host: hostname() }, new Date(Date.now() - REUSED_PID_MS + 5000), Date.now(), self)).toBe(true);
    expect(isHeld({ pid: process.ppid, host: hostname() }, new Date(Date.now() - REUSED_PID_MS - 1), Date.now(), self)).toBe(false);
  });

  it('waits for a lock file that is being written, unless it is old', () => {
    const dir = tempDir();
    writeFileSync(join(dir, LOCK_FILE), '');
    expect(() => acquireDataLock(dir)).toThrow(DataLockError);
    const old = new Date(Date.now() - STALE_MS - 1000);
    utimesSync(join(dir, LOCK_FILE), old, old);
    acquireDataLock(dir).release();
  });

  it('release leaves a lock that another process has taken since', () => {
    const dir = tempDir();
    const lock = acquireDataLock(dir);
    writeLock(dir, { pid: process.ppid, host: hostname(), token: 'someone-else' });
    lock.release();
    expect(existsSync(join(dir, LOCK_FILE))).toBe(true);
  });

  it('a second server stops before it opens or migrates the database', async () => {
    const dir = tempDir();
    const lock = acquireDataLock(dir, 'server');
    try {
      const root = resolve(import.meta.dirname, '../../..');
      const child = spawn(process.execPath, ['--experimental-transform-types', '--disable-warning=ExperimentalWarning', join(root, 'server/src/main.ts')], {
        env: { ...process.env, VITEST: '', GRC_DATA_DIR: dir, GRC_PORT: '0', GRC_WEB_DIST: join(dir, 'no-web'), GRC_LOG_CONSOLE: 'text' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (d) => (output += d));
      child.stderr.on('data', (d) => (output += d));
      const code = await new Promise<number | null>((done) => child.on('exit', done));
      expect(code, output).toBe(1);
      expect(output).toMatch(/did not start: A server \(process \d+/);
      // Nothing was opened: no database folder, and the lock is still the first holder's.
      expect(existsSync(join(dir, 'pg'))).toBe(false);
      expect(JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8')).token).toBe(lock.info.token);
    } finally {
      lock.release();
    }
  }, 60_000);
});
