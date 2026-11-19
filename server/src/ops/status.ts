import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listBackups } from './backup.ts';
import { appVersion, folderSize, formatBytes, repoRoot, serverPid } from './files.ts';
import { migrationsOnDisk, readAppliedMigrations } from './migrations.ts';

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
  lastBackup: { name: string; createdAt: string; label: string; bytes: number; ageHours: number } | null;
  migrations: {
    onDisk: number;
    /** Null when the database could not be read (it does not exist yet, or the server has it open). */
    applied: number | null;
    pending: string[] | null;
    note: string;
  };
}

async function isHealthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok && ((await res.json()) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}

export async function getStatus(opts: { dataDir: string; backupsDir: string; port: number; now?: Date }): Promise<Status> {
  const now = opts.now ?? new Date();
  const url = `http://127.0.0.1:${opts.port}`;
  const pid = serverPid(opts.dataDir);
  const backups = listBackups(opts.backupsDir);
  const newest = backups[0];
  const onDisk = migrationsOnDisk();

  let migrations: Status['migrations'];
  if (pid) {
    // The embedded database allows one process, so it cannot be read while the server has
    // it open. The server applied everything it found when it started.
    const started = statSync(join(opts.dataDir, 'grc.pid')).mtimeMs;
    const newer = onDisk.filter((name) => {
      const [scope, file] = name.split('/');
      const path = scope === 'core' ? `server/src/core/migrations/${file}` : `server/src/modules/${scope}/migrations/${file}`;
      try {
        return statSync(join(repoRoot, path)).mtimeMs > started;
      } catch {
        return false;
      }
    });
    migrations = {
      onDisk: onDisk.length,
      applied: null,
      pending: null,
      note: newer.length
        ? `${newer.length} migration file(s) changed since the server started (${newer.join(', ')}); restart to apply`
        : 'applied when the server started; none changed since',
    };
  } else if (!existsSync(join(opts.dataDir, 'pg'))) {
    migrations = { onDisk: onDisk.length, applied: null, pending: onDisk, note: 'no database yet; all migrations run at first start' };
  } else {
    let reason = '';
    const applied = await readAppliedMigrations(opts.dataDir, (message) => (reason = message));
    if (applied === null) {
      migrations = { onDisk: onDisk.length, applied: null, pending: null, note: `the database could not be read: ${reason}` };
    } else {
      const done = new Set(applied);
      const pending = onDisk.filter((m) => !done.has(m));
      migrations = {
        onDisk: onDisk.length,
        applied: applied.length,
        pending,
        note: pending.length ? `${pending.length} pending (${pending.join(', ')}); they run at the next start` : 'none pending',
      };
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
        }
      : null,
    migrations,
  };
}

export function formatStatus(s: Status): string {
  const age = (hours: number) => (hours < 48 ? `${hours} hour(s) ago` : `${Math.round(hours / 24)} days ago`);
  const state = !s.running ? 'stopped' : s.healthy ? `running and healthy (process ${s.pid})` : `running but NOT answering the health check (process ${s.pid})`;
  const lines = [
    ['Version', `${s.version} (Node.js ${s.node})`],
    ['Server', state],
    ['Address', `${s.url} (port ${s.port})`],
    ['Data folder', `${s.dataDir} (${formatBytes(s.dataBytes)})`],
    [
      'Last backup',
      s.lastBackup
        ? `${s.lastBackup.name}, ${age(s.lastBackup.ageHours)}, ${formatBytes(s.lastBackup.bytes)}${s.lastBackup.label === 'manual' ? '' : ` (${s.lastBackup.label})`}`
        : 'none',
    ],
    ['Backups', `${s.backupCount} in ${s.backupsDir}`],
    ['Migrations', `${s.migrations.onDisk} in the code; ${s.migrations.note}`],
  ];
  return lines.map(([label, value]) => `${`${label}:`.padEnd(13)}${value}`).join('\n');
}
