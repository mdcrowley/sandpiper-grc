import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildApp, repoRoot } from './app.ts';
import { openDb } from './core/db.ts';
import type { LookupValue, SeedOptions } from './core/module.ts';
import { createBackup, listBackups, OpsError, pruneBackups, resolveBackup, restoreBackup, verifyBackup } from './ops/backup.ts';
import { exportAll, importAll } from './ops/export.ts';
import { formatBytes, serverPid, timestamp } from './ops/files.ts';
import { migrationsOnDisk, readAppliedMigrations } from './ops/migrations.ts';
import { formatStatus, getStatus } from './ops/status.ts';

// Command-line tasks. The embedded database allows one process at a time, so stop the
// server first (grc.ps1 does this for you). The operations commands live in ./ops.

const USAGE = `Usage: cli.ts <command>
  seed [--profile pilot|dev]            load data
  migrate                               bring the database up to date
  status [--json]                       version, server, data size, last backup, migrations
  backup [--prune <n>] [--label <text>] copy the data folder to a new backup
  backups                               list backups, newest first
  verify-backup <name|path|latest>      check a backup against its manifest
  restore <name|path|latest> [--force]  replace the data with a backup (keeps a safety copy)
  export-all [--out <dir>] [--no-secrets]   every table as JSON Lines, plus files
  import-all <dir>                      load an export into an empty installation`;

const [command, ...args] = process.argv.slice(2);
const dataDir = process.env.GRC_DATA_DIR ?? resolve(repoRoot, 'data');
const backupsDir = process.env.GRC_BACKUP_DIR ? resolve(process.env.GRC_BACKUP_DIR) : resolve(repoRoot, 'backups');

const VALUE_FLAGS = ['profile', 'prune', 'label', 'out'];

function flag(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const has = (name: string) => args.includes(`--${name}`);
/** The first argument that is neither a flag nor a flag's value. */
function positional(): string | undefined {
  return args.find((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_FLAGS.includes(args[i - 1].replace(/^--/, ''))));
}

/** Commands that open or replace the database need the server stopped. */
function requireStopped() {
  const pid = serverPid(dataDir);
  if (pid) {
    console.error(`The server is running on this data folder (process ${pid}). Stop it first: .\\grc.ps1 stop`);
    process.exit(1);
  }
}
function requireDataFolder() {
  if (dataDir === 'memory') {
    console.error('This command needs a data folder; GRC_DATA_DIR is set to "memory".');
    process.exit(1);
  }
}
const warn = (what: string) => (message: string) => console.error(`Warning: ${what}: ${message}`);

async function run(): Promise<number> {
  if (command === 'seed') {
    requireStopped();
    const profile = flag('profile', 'pilot') as SeedOptions['profile'];
    const seedDir = process.env.GRC_SEED_DIR ?? resolve(repoRoot, 'seed');
    if (profile === 'pilot' && !existsSync(seedDir)) {
      console.error(`Seed folder not found: ${seedDir}. Use --profile dev for generated sample data.`);
      return 1;
    }
    const { ctx, modules, close } = await buildApp({ dataDir, serveWeb: false });
    let failed = false;

    // Organisation profile: only read in the pilot profile, so `dev` never needs private files.
    const orgFile = join(seedDir, 'organisation.json');
    const organisation = profile === 'pilot' && existsSync(orgFile) ? JSON.parse(readFileSync(orgFile, 'utf8')) : {};
    if (typeof organisation.appName === 'string' && !(await ctx.db.one(`select 1 from settings where key = 'app.name'`))) {
      await ctx.settings.set('app.name', organisation.appName);
    }
    for (const [list, values] of Object.entries(organisation.lookups ?? {})) {
      await ctx.lookups.ensure(list, values as LookupValue[]);
    }
    console.log(`seed organisation profile: ${Object.keys(organisation).length ? Object.keys(organisation).join(', ') : 'none'}`);

    for (const m of modules) {
      if (!m.seed) continue;
      try {
        const note = await m.seed(ctx, { profile, seedDir, organisation });
        console.log(`seed ${m.key}: ${note || 'done'}`);
      } catch (err) {
        failed = true;
        console.error(`seed ${m.key}: FAILED - ${(err as Error).message}`);
      }
    }
    await close();
    return failed ? 1 : 0;
  }

  if (command === 'migrate') {
    requireStopped();
    const before = (await readAppliedMigrations(dataDir)) ?? [];
    const { db, close } = await buildApp({ dataDir, serveWeb: false });
    const after = (await db.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name);
    await close();
    const added = after.filter((m) => !before.includes(m)).sort();
    console.log(added.length ? `Applied ${added.length} migration(s): ${added.join(', ')}` : 'No migrations to apply.');
    console.log('Database is up to date.');
    return 0;
  }

  if (command === 'status') {
    const status = await getStatus({ dataDir, backupsDir, port: Number(process.env.GRC_PORT ?? 8080) });
    console.log(has('json') ? JSON.stringify(status, null, 2) : formatStatus(status));
    return 0;
  }

  if (command === 'backup') {
    requireDataFolder();
    requireStopped();
    const prune = has('prune') ? Number(flag('prune', '')) : null;
    if (prune !== null && (!Number.isInteger(prune) || prune < 1)) throw new OpsError('--prune needs a whole number, 1 or more.');
    const migrations = await readAppliedMigrations(dataDir, warn('the migration list could not be read and is not in the manifest'));
    const backup = await createBackup({ dataDir, backupsDir, migrations, label: flag('label', 'manual') });
    console.log(`Backed up to ${backup.dir}`);
    console.log(`  ${backup.manifest.files.length} files, ${formatBytes(backup.manifest.totalBytes)}, checksums verified, version ${backup.manifest.appVersion}`);
    if (prune !== null) {
      const removed = await pruneBackups(backupsDir, prune);
      console.log(removed.length ? `  Pruned ${removed.length} old backup(s): ${removed.join(', ')}` : `  Nothing to prune (keeping the newest ${prune}).`);
    }
    return 0;
  }

  if (command === 'backups') {
    const backups = listBackups(backupsDir);
    if (!backups.length) console.log(`No backups in ${backupsDir}.`);
    for (const b of backups) {
      console.log(`${b.name.padEnd(30)} ${b.manifest.createdAt}  ${formatBytes(b.manifest.totalBytes).padStart(10)}  v${b.manifest.appVersion}  ${b.manifest.label}`);
    }
    return 0;
  }

  if (command === 'verify-backup') {
    const dir = resolveBackup(backupsDir, positional() ?? 'latest');
    const { manifest, problems } = await verifyBackup(dir);
    if (problems.length) {
      console.error(`FAILED: ${dir} does not match its manifest:`);
      for (const p of problems.slice(0, 20)) console.error(`  - ${p}`);
      return 1;
    }
    console.log(`OK: ${dir} (${manifest.files.length} files, ${formatBytes(manifest.totalBytes)}, made ${manifest.createdAt} by version ${manifest.appVersion})`);
    return 0;
  }

  if (command === 'restore') {
    requireDataFolder();
    requireStopped();
    const ref = positional();
    if (!ref) throw new OpsError('Say which backup to restore: a name from `backups`, a path, or `latest`.');
    const backupDir = resolveBackup(backupsDir, ref);
    console.log(`Restoring ${backupDir} into ${dataDir}`);
    const currentMigrations = await readAppliedMigrations(dataDir, warn('the current database could not be read; the safety copy is still taken'));
    const result = await restoreBackup({ backupDir, dataDir, backupsDir, codeMigrations: migrationsOnDisk(), currentMigrations, force: has('force') });
    console.log(`  Verified ${result.manifest.files.length} files against the manifest.`);
    console.log(result.safetyCopy ? `  The data that was replaced is kept in ${result.safetyCopy.dir}` : '  There was no existing data to keep.');
    console.log(`Restored the backup made ${result.manifest.createdAt} by version ${result.manifest.appVersion}.`);
    if (result.pendingMigrations.length) console.log(`  ${result.pendingMigrations.length} newer migration(s) will be applied at the next start: ${result.pendingMigrations.join(', ')}`);
    console.log('Everything recorded after that backup is no longer in the application.');
    return 0;
  }

  if (command === 'export-all') {
    requireStopped();
    const outDir = resolve(flag('out', join(backupsDir, `export-${timestamp()}`)));
    const db = await openDb(dataDir);
    try {
      const manifest = await exportAll(db, {
        outDir,
        filesDir: dataDir === 'memory' ? null : join(dataDir, 'files'),
        includeSecrets: !has('no-secrets'),
      });
      const rows = manifest.tables.reduce((sum, t) => sum + t.rows, 0);
      console.log(`Exported ${rows} rows from ${manifest.tables.length} tables and ${manifest.files.length} files to ${outDir}`);
      console.log(
        manifest.secretsIncluded
          ? '  It includes password hashes and second-factor secrets: protect it like a backup.'
          : '  Password hashes, second-factor secrets, sessions and one-time links were left out.',
      );
    } finally {
      await db.close();
    }
    return 0;
  }

  if (command === 'import-all') {
    requireStopped();
    const inDir = positional();
    if (!inDir || !existsSync(inDir)) throw new OpsError('Say which export folder to import (the folder that holds manifest.json).');
    const { db, close } = await buildApp({ dataDir, serveWeb: false }); // creates and migrates the database
    try {
      const result = await importAll(db, { inDir: resolve(inDir), filesDir: dataDir === 'memory' ? null : join(dataDir, 'files') });
      const rows = result.tables.reduce((sum, t) => sum + t.rows, 0);
      console.log(`Imported ${rows} rows into ${result.tables.length} tables and ${result.files} files from ${resolve(inDir)}`);
      for (const note of result.notes) console.log(`  Note: ${note}`);
    } finally {
      await close();
    }
    return 0;
  }

  console.log(USAGE);
  return command ? 1 : 0;
}

try {
  process.exit(await run());
} catch (err) {
  if (err instanceof OpsError) console.error(err.message);
  else console.error(err);
  process.exit(err instanceof OpsError ? err.exitCode : 1);
}
