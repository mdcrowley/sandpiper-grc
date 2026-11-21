import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, utimesSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

// One process at a time on a data folder (OP-06). The embedded database has no lock of its own,
// so two processes writing the same `pg/` folder could corrupt it; and a second server would also
// run the migrations and the start-up repairs (a backup in progress marked failed, for example)
// before it noticed that the port was taken. The server, and every command that opens or replaces
// the database, takes `grc.lock` in the data folder first, before the database is opened.
//
// The lock file is created with O_EXCL ("wx"), so only one process can create it, and holds the
// process id, the host name and a random token. The holder touches it every 10 seconds (its
// "heartbeat") and removes it when it stops. A lock left behind by a process that died is stale:
// - on this host, when its process is gone, or when its process id is ours (a container that
//   restarts runs the server as process 1 again) and the heartbeat has stopped for a minute, or
//   when the process id was reused by something else (no heartbeat for five minutes);
// - from another host (another container on a shared volume), when the heartbeat has stopped for
//   a minute: another host's process cannot be looked at.

export const LOCK_FILE = 'grc.lock';
export const HEARTBEAT_MS = 10_000;
/** No heartbeat for this long: the holder on another host (or a restarted container) is gone. */
export const STALE_MS = 60_000;
/** No heartbeat for this long although the process id is alive: the id was reused. */
export const REUSED_PID_MS = 5 * 60_000;

export interface LockInfo {
  pid: number;
  host: string;
  token: string;
  /** What holds it: "server" or the command's name. */
  purpose: string;
  startedAt: string;
}

export interface Holder extends LockInfo {
  /** When the holder last touched the lock (its heartbeat). */
  heartbeatAt: Date;
}

export class DataLockError extends Error {
  constructor(message: string, readonly holder: Holder) {
    super(message);
  }
}

export interface DataLock {
  readonly path: string;
  readonly info: LockInfo;
  /** Removes the lock if it is still ours. Safe to call more than once. */
  release(): void;
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0); // signal 0 only tests whether the process exists
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

function read(path: string): { info: Partial<LockInfo> | null; mtime: Date } | null {
  let mtime: Date;
  let text: string;
  try {
    mtime = statSync(path).mtime;
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    const info = JSON.parse(text) as Partial<LockInfo>;
    return { info: info && typeof info === 'object' ? info : null, mtime };
  } catch {
    return { info: null, mtime }; // being written, or damaged: judged by its age alone
  }
}

/**
 * Whether a lock is still held, given what it says, when it was last touched and the time now.
 * Exported for tests; `lockHolder` is what callers use.
 */
export function isHeld(info: Partial<LockInfo> | null, heartbeatAt: Date, now = Date.now(), self = { pid: process.pid, host: hostname() }): boolean {
  const age = now - heartbeatAt.getTime();
  if (!info || !Number.isInteger(info.pid) || typeof info.host !== 'string') return age < STALE_MS;
  if (info.host !== self.host) return age < STALE_MS;
  if (info.pid === self.pid) return age < STALE_MS;
  return alive(info.pid!) && age < REUSED_PID_MS;
}

/** The process that holds the data folder now, or null when nobody does (no lock, or a stale one). */
export function lockHolder(dataDir: string, now = Date.now()): Holder | null {
  if (dataDir === 'memory') return null;
  const found = read(join(dataDir, LOCK_FILE));
  if (!found || !isHeld(found.info, found.mtime, now)) return null;
  const i = found.info ?? {};
  return {
    pid: Number(i.pid) || 0, host: String(i.host ?? 'unknown'), token: String(i.token ?? ''),
    purpose: String(i.purpose ?? 'unknown'), startedAt: String(i.startedAt ?? ''), heartbeatAt: found.mtime,
  };
}

export function describeHolder(h: Holder): string {
  const what = h.purpose === 'server' ? 'A server' : `The command "${h.purpose}"`;
  const where = h.host === hostname() ? `process ${h.pid}` : `process ${h.pid} on ${h.host}`;
  return `${what} (${where}, started ${h.startedAt || 'at an unknown time'}) is using this data folder`;
}

/**
 * Takes the data folder for this process, or throws a DataLockError naming the process that
 * holds it. Call it before opening the database. The lock is released on `release()` and, as a
 * last resort, when the process exits.
 */
export function acquireDataLock(dataDir: string, purpose = 'server'): DataLock {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, LOCK_FILE);
  const info: LockInfo = { pid: process.pid, host: hostname(), token: randomUUID(), purpose, startedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 3; attempt++) {
    let fd: number;
    try {
      fd = openSync(path, 'wx', 0o600);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const holder = lockHolder(dataDir);
      if (holder) {
        throw new DataLockError(
          `${describeHolder(holder)}. Only one process may use a data folder at a time: stop it first. ` +
          `A lock left by a process that is no longer running clears by itself (within a minute when it ran on another host or container); ` +
          `only if you are sure nothing uses the folder, delete ${path}.`, holder);
      }
      // Stale: remove it, unless it changed hands in the meantime (another process took it).
      const again = read(path);
      if (again && isHeld(again.info, again.mtime)) continue;
      rmSync(path, { force: true });
      continue;
    }
    try {
      writeSync(fd, JSON.stringify(info));
    } finally {
      closeSync(fd);
    }
    return hold(path, info);
  }
  const holder = lockHolder(dataDir);
  throw new DataLockError(`Could not take the data folder lock ${path}; another process is starting on it.`, holder ?? { ...info, heartbeatAt: new Date() });
}

function hold(path: string, info: LockInfo): DataLock {
  const ours = () => read(path)?.info?.token === info.token;
  const beat = setInterval(() => {
    try {
      if (ours()) {
        const now = new Date();
        utimesSync(path, now, now);
      }
    } catch { /* the folder is unreachable for a moment; the next beat tries again */ }
  }, HEARTBEAT_MS);
  beat.unref();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearInterval(beat);
    process.off('exit', release);
    try {
      if (ours()) rmSync(path, { force: true });
    } catch { /* nothing more can be done while exiting */ }
  };
  process.on('exit', release);
  return { path, info, release };
}
