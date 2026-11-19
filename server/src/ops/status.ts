import { existsSync, statSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import { databaseUrl, redactUrl } from '../core/db.ts';
import { listBackups } from './backup.ts';
import { appVersion, folderSize, formatBytes, serverPid } from './files.ts';
import { migrationFiles, migrationsOnDisk, readMigrationState } from './migrations.ts';
import { type BackupStatusFile, readBackupStatus } from './online-backup.ts';
import { secretKeyLocation } from './secret-key.ts';

// `grc.ps1 status`: one screen that says what is installed, whether it is running, how
// big the data is, when it was last backed up and whether the database is behind the code.

export interface Status {
  version: string;
  node: string;
  port: number;
  url: string;
  running: boolean;
  pid: number | null;
  healthy: boolean;
  dataDir: string;
  dataBytes: number;
  backupsDir: string;
  backupCount: number;
  lastBackup: { name: string; createdAt: string; label: string; bytes: number; ageHours: number; encrypted: boolean } | null;
  /** The backups the server takes itself (Administration > Backups), as it last recorded them. */
  serverBackups: BackupStatusFile | null;
  /** The embedded database in the data folder, or a PostgreSQL server (its address without the password). */
  database: { kind: 'embedded' | 'server'; where: string };
  /** Where the secret key is: backups of the data folder do not contain it. */
  secretKey: string;
  migrations: {
    onDisk: number;
    /** Null when the database could not be read (it does not exist yet, or the server has it open). */
    applied: number | null;
    pending: string[] | null;
    /** Applied migrations whose file was edited afterwards (E16-20); null when it could not be checked. */
    changed: string[] | null;
    note: string;
  };
}

/** HTTPS when the server serves it itself (GRC_TLS_CERT); the local check accepts a self-signed certificate. */
export const serverScheme = () => (process.env.GRC_TLS_CERT?.trim() ? 'https' : 'http');

async function isHealthy(url: string): Promise<boolean> {
  if (url.startsWith('https:')) {
    return new Promise((resolve) => {
      const req = httpsRequest(`${url}/api/health`, { rejectUnauthorized: false, timeout: 3000 }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => { try { resolve(res.statusCode === 200 && JSON.parse(body).ok === true); } catch { resolve(false); } });
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => resolve(false));
      req.end();
    });
  }
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok && ((await res.json()) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}

export async function getStatus(opts: { dataDir: string; backupsDir: string; port: number; now?: Date }): Promise<Status> {
  const now = opts.now ?? new Date();
  const url = `${serverScheme()}://127.0.0.1:${opts.port}`;
  const server = databaseUrl();
  const pid = serverPid(opts.dataDir);
  const backups = listBackups(opts.backupsDir);
  const newest = backups[0];
  const onDisk = migrationsOnDisk();

  let migrations: Status['migrations'];
  if (server) {
    // A PostgreSQL server can be read while the application runs.
    let reason = '';
    const state = await readMigrationState(opts.dataDir, (message) => (reason = message));
    const done = new Set(state?.applied ?? []);
    const pending = state ? onDisk.filter((m) => !done.has(m)) : null;
    migrations = {
      onDisk: onDisk.length, applied: state?.applied.length ?? null, pending, changed: state?.changed ?? null,
      note: !state ? `the database could not be read: ${reason}` : pendingNote(pending!) + changedNote(state.changed),
    };
  } else if (pid) {
    // The embedded database allows one process, so it cannot be read while the server has
    // it open. The server applied everything it found when it started (and warned in its log
    // about any applied migration edited since).
    const started = statSync(join(opts.dataDir, 'grc.pid')).mtimeMs;
    const newer = migrationFiles().filter((f) => {
      try {
        return statSync(f.path).mtimeMs > started;
      } catch {
        return false;
      }
    }).map((f) => f.name);
    migrations = {
      onDisk: onDisk.length,
      applied: null,
      pending: null,
      changed: null,
      note: newer.length
        ? `${newer.length} migration file(s) changed since the server started (${newer.join(', ')}); restart to apply`
        : 'applied when the server started; none changed since',
    };
  } else if (!existsSync(join(opts.dataDir, 'pg'))) {
    migrations = { onDisk: onDisk.length, applied: null, pending: onDisk, changed: [], note: 'no database yet; all migrations run at first start' };
  } else {
    let reason = '';
    const state = await readMigrationState(opts.dataDir, (message) => (reason = message));
    if (state === null) {
      migrations = { onDisk: onDisk.length, applied: null, pending: null, changed: null, note: `the database could not be read: ${reason}` };
    } else {
      const done = new Set(state.applied);
      const pending = onDisk.filter((m) => !done.has(m));
      migrations = { onDisk: onDisk.length, applied: state.applied.length, pending, changed: state.changed, note: pendingNote(pending) + changedNote(state.changed) };
    }
  }

  return {
    version: appVersion(),
    node: process.version,
    port: opts.port,
    url,
    running: pid !== null,
    pid,
    healthy: pid !== null && (await isHealthy(url)),
    dataDir: opts.dataDir,
    dataBytes: existsSync(opts.dataDir) ? folderSize(opts.dataDir) : 0,
    backupsDir: opts.backupsDir,
    backupCount: backups.length,
    lastBackup: newest
      ? {
          name: newest.name,
          createdAt: newest.manifest.createdAt,
          label: newest.manifest.label,
          bytes: newest.manifest.totalBytes,
          ageHours: Math.max(0, Math.round((now.getTime() - Date.parse(newest.manifest.createdAt)) / 36e5)),
          encrypted: Boolean(newest.encrypted),
        }
      : null,
    serverBackups: opts.dataDir === 'memory' ? null : readBackupStatus(opts.dataDir),
    database: server ? { kind: 'server', where: redactUrl(server) } : { kind: 'embedded', where: join(opts.dataDir, 'pg') },
    secretKey: (() => {
      const k = secretKeyLocation(opts.dataDir);
      if (k.source === 'environment') return 'GRC_SECRET_KEY (not in backups: keep a copy with your other secrets)';
      return k.insideData ? `${k.file} (INSIDE the data folder: move it out)` : `${k.file} (outside the data folder, not in backups: back it up separately)`;
    })(),
    migrations,
  };
}

const pendingNote = (pending: string[]) =>
  pending.length ? `${pending.length} pending (${pending.join(', ')}); they run at the next start` : 'none pending';
const changedNote = (changed: string[]) =>
  changed.length ? `; WARNING: ${changed.length} applied migration file(s) EDITED since they were applied (${changed.join(', ')}): put the change in a new migration instead` : '';

/** One line about the daily backups the server takes itself; says FAILED or OVERDUE plainly. */
function formatServerBackups(b: BackupStatusFile | null, running: boolean, age: (hours: number) => string, now: Date): string {
  if (!b) return 'not set up (Administration > Backups)';
  if (!b.enabled) return `switched off (Administration > Backups)${b.lastSuccess ? `; last ${b.lastSuccess.name}, ${age(hoursSince(b.lastSuccess.at, now))}` : ''}`;
  const parts = [`${b.schedule} to ${b.destination ?? '(no destination)'}${b.encrypted ? ', encrypted' : ''}`];
  if (b.lastSuccess) {
    const hours = hoursSince(b.lastSuccess.at, now);
    parts.push(`last good ${b.lastSuccess.name}, ${age(hours)}${hours > 48 ? ' - OVERDUE' : ''}`);
  } else {
    parts.push('no successful backup yet');
  }
  if (b.lastRun && !b.lastRun.ok) parts.push(`LAST RUN FAILED ${b.lastRun.at}: ${b.lastRun.message ?? 'no detail'}`);
  if (!running) parts.push('the server is stopped, so none are being taken');
  return parts.join('; ');
}

const hoursSince = (iso: string, now: Date) => Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 36e5));

export function formatStatus(s: Status, now = new Date()): string {
  const age = (hours: number) => (hours < 48 ? `${hours} hour(s) ago` : `${Math.round(hours / 24)} days ago`);
  const state = !s.running ? 'stopped' : s.healthy ? `running and healthy (process ${s.pid})` : `running but NOT answering the health check (process ${s.pid})`;
  const lines = [
    ['Version', `${s.version} (Node.js ${s.node})`],
    ['Server', state],
    ['Address', `${s.url} (port ${s.port})`],
    ['Data folder', `${s.dataDir} (${formatBytes(s.dataBytes)})`],
    ['Database', s.database.kind === 'server'
      ? `PostgreSQL server ${s.database.where}; back it up with pg_dump (the backup and restore commands cover the embedded database only)`
      : `embedded, in ${s.database.where}`],
    ['Secret key', s.secretKey],
    [
      'Last backup',
      s.lastBackup
        ? `${s.lastBackup.name}, ${age(s.lastBackup.ageHours)}, ${formatBytes(s.lastBackup.bytes)}${s.lastBackup.label === 'manual' ? '' : ` (${s.lastBackup.label})`}${s.lastBackup.encrypted ? ', encrypted' : ''}`
        : 'none',
    ],
    ['Backups', `${s.backupCount} in ${s.backupsDir}`],
    ['Server backups', formatServerBackups(s.serverBackups, s.running, age, now)],
    ['Migrations', `${s.migrations.onDisk} in the code; ${s.migrations.note}`],
  ];
  return lines.map(([label, value]) => `${`${label}:`.padEnd(16)}${value}`).join('\n');
}
