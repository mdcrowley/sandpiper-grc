import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { buildApp, repoRoot } from './app.ts';
import { openDb } from './core/db.ts';
import { readOrganizationProfile } from './core/profile.ts';
import type { LookupValue, SeedOptions } from './core/module.ts';
import { decryptToTar, ENCRYPTED_EXT, isArchivePath, loadArchiveKey, newKeyText, readArchiveInfo } from './ops/archive.ts';
import {
  createBackup, listBackupsAsync, OpsError, pruneBackups, resolveBackup, restoreBackup, verifyBackup,
} from './ops/backup.ts';
import { exportAll, exportToArchive, importAll, unpackExport } from './ops/export.ts';
import { formatBytes, serverPid, timestamp } from './ops/files.ts';
import { migrationsOnDisk, readAppliedMigrations } from './ops/migrations.ts';
import { secretKeyNote } from './ops/secret-key.ts';
import { formatStatus, getStatus } from './ops/status.ts';

// Command-line tasks. The embedded database allows one process at a time, so stop the
// server first (grc.ps1 and grc.sh do this for you). The operations commands live in ./ops.

const USAGE = `Usage: cli.ts <command>
  seed [--profile pilot|dev]            load data
  migrate                               bring the database up to date
  status [--json]                       version, server, data size, last backup, migrations
  backup [--prune <n>] [--label <text>] [--encrypt [--include-secret-key]]   copy the data folder to a new backup
  backups                               list backups, newest first
  verify-backup <name|path|latest>      check a backup against its manifest
  restore <name|path|latest> [--force]  replace the data with a backup (keeps a safety copy)
  export-all [--out <dir|file>] [--no-secrets] [--encrypt]   every table as JSON Lines, plus files
  import-all <dir|archive>              load an export into an empty installation
  decrypt <archive> [--out <file.tar>]  turn an encrypted backup or export into a plain tar file
  new-key <file>                        write a new random key file for encrypted backups
  move-files --to disk|s3               move attached files to the other store, checking each one

Encrypted archives: --key-file <file> or --passphrase-file <file>, or the environment variables
GRC_BACKUP_KEY_FILE, GRC_BACKUP_PASSPHRASE_FILE or GRC_BACKUP_PASSPHRASE. Keep the key outside
the data folder.`;

const [command, ...args] = process.argv.slice(2);
const dataDir = process.env.GRC_DATA_DIR ?? resolve(repoRoot, 'data');
const backupsDir = process.env.GRC_BACKUP_DIR ? resolve(process.env.GRC_BACKUP_DIR) : resolve(repoRoot, 'backups');

const VALUE_FLAGS = ['profile', 'prune', 'label', 'out', 'key-file', 'passphrase-file', 'to'];

function flag(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const has = (name: string) => args.includes(`--${name}`);
/** The first argument that is neither a flag nor a flag's value. */
function positional(): string | undefined {
  return args.find((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_FLAGS.includes(args[i - 1].replace(/^--/, ''))));
}

/** The key for encrypted archives, from the flags or the environment; null when none is given. */
function archiveKey() {
  return loadArchiveKey({ keyFile: flag('key-file', '') || null, passphraseFile: flag('passphrase-file', '') || null, dataDir });
}
function requiredKey(what: string) {
  const key = archiveKey();
  if (!key) throw new OpsError(`${what} needs a key: --key-file <file> or --passphrase-file <file>, or GRC_BACKUP_KEY_FILE / GRC_BACKUP_PASSPHRASE_FILE / GRC_BACKUP_PASSPHRASE.`);
  return key;
}

/** Commands that open or replace the database need the server stopped. */
function requireStopped() {
  const pid = serverPid(dataDir);
  if (pid) {
    console.error(`The server is running on this data folder (process ${pid}). Stop it first: .\\grc.ps1 stop (Windows), ./grc.sh stop (macOS, Linux) or grc stop (container).`);
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

    // Organization profile: only read in the pilot profile, so `dev` never needs private files.
    const organization = profile === 'pilot' ? readOrganizationProfile(seedDir) : {};
    if (typeof organization.appName === 'string' && !(await ctx.db.one(`select 1 from settings where key = 'app.name'`))) {
      await ctx.settings.set('app.name', organization.appName);
    }
    for (const [list, values] of Object.entries(organization.lookups ?? {})) {
      await ctx.lookups.ensure(list, values as LookupValue[]);
    }
    console.log(`seed organization profile: ${Object.keys(organization).length ? Object.keys(organization).join(', ') : 'none'}`);

    for (const m of modules) {
      if (!m.seed) continue;
      try {
        const note = await m.seed(ctx, { profile, seedDir, organization });
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
    const key = has('encrypt') ? requiredKey('An encrypted backup') : null;
    const migrations = await readAppliedMigrations(dataDir, warn('the migration list could not be read and is not in the manifest'));
    const includeKey = has('include-secret-key');
    if (includeKey && !key) throw new OpsError('--include-secret-key needs --encrypt: the key may only travel inside an encrypted backup.');
    const backup = await createBackup({ dataDir, backupsDir, migrations, label: flag('label', 'manual'), key, includeSecretKey: includeKey });
    console.log(`Backed up to ${backup.dir}`);
    console.log(`  ${backup.manifest.files.length} files, ${formatBytes(backup.manifest.totalBytes)}, checksums verified${key ? ', encrypted' : ''}, version ${backup.manifest.appVersion}`);
    console.log(`  ${secretKeyNote(dataDir, includeKey)}`);
    if (prune !== null) {
      const removed = await pruneBackups(backupsDir, prune);
      console.log(removed.length ? `  Pruned ${removed.length} old backup(s): ${removed.join(', ')}` : `  Nothing to prune (keeping the newest ${prune}).`);
    }
    return 0;
  }

  if (command === 'backups') {
    const backups = await listBackupsAsync(backupsDir);
    if (!backups.length) console.log(`No backups in ${backupsDir}.`);
    for (const b of backups) {
      const how = [b.manifest.label, b.encrypted ? 'encrypted' : '', b.kind === 'online-backup' ? 'taken while running' : ''].filter(Boolean).join(', ');
      console.log(`${b.name.padEnd(36)} ${b.manifest.createdAt}  ${formatBytes(b.manifest.totalBytes).padStart(10)}  v${b.manifest.appVersion}  ${how}`);
    }
    return 0;
  }

  if (command === 'verify-backup') {
    const dir = resolveBackup(backupsDir, positional() ?? 'latest');
    const encrypted = isArchivePath(dir) && statSync(dir).isFile() && (await readArchiveInfo(dir)).encrypted;
    const { manifest, problems } = await verifyBackup(dir, encrypted ? requiredKey('This backup is encrypted, so checking it') : null);
    if (problems.length) {
      console.error(`FAILED: ${dir} does not match its manifest:`);
      for (const p of problems.slice(0, 20)) console.error(`  - ${p}`);
      return 1;
    }
    const count = manifest.files.length ? `${manifest.files.length} files, ` : '';
    console.log(`OK: ${dir} (${count}${formatBytes(manifest.totalBytes)}, made ${manifest.createdAt} by version ${manifest.appVersion}${encrypted ? ', decrypted and checked' : ''})`);
    return 0;
  }

  if (command === 'restore') {
    requireDataFolder();
    requireStopped();
    const ref = positional();
    if (!ref) throw new OpsError('Say which backup to restore: a name from `backups`, a path, or `latest`.');
    const backupDir = resolveBackup(backupsDir, ref);
    const encrypted = isArchivePath(backupDir) && statSync(backupDir).isFile() && (await readArchiveInfo(backupDir)).encrypted;
    const key = encrypted ? requiredKey('This backup is encrypted, so restoring it') : archiveKey();
    console.log(`Restoring ${backupDir} into ${dataDir}`);
    const currentMigrations = await readAppliedMigrations(dataDir, warn('the current database could not be read; the safety copy is still taken'));
    const result = await restoreBackup({
      backupDir, dataDir, backupsDir, codeMigrations: migrationsOnDisk(), currentMigrations, force: has('force'), key,
      async loadExport(dir) {
        const { db, close } = await buildApp({ dataDir, serveWeb: false }); // a new, migrated, empty database
        try {
          const loaded = await importAll(db, { inDir: dir, filesDir: join(dataDir, 'files') });
          console.log(`  Loaded ${loaded.tables.reduce((s, t) => s + t.rows, 0)} rows and ${loaded.files} files into a new database.`);
          for (const note of loaded.notes) console.log(`  Note: ${note}`);
        } finally {
          await close();
        }
      },
    });
    if (!result.fromExport) console.log(`  Verified ${result.manifest.files.length} files against the manifest.`);
    console.log(result.safetyCopy ? `  The data that was replaced is kept in ${result.safetyCopy.dir}` : '  There was no existing data to keep.');
    console.log(`Restored the backup made ${result.manifest.createdAt} by version ${result.manifest.appVersion}.`);
    if (result.pendingMigrations.length) console.log(`  ${result.pendingMigrations.length} newer migration(s) will be applied at the next start: ${result.pendingMigrations.join(', ')}`);
    console.log('Everything recorded after that backup is no longer in the application.');
    console.log(`  ${result.keyNote ?? secretKeyNote(dataDir).replace('is not in backups (unless an encrypted backup is told to include it)', 'was not in this backup')}`);
    return 0;
  }

  if (command === 'export-all') {
    requireStopped();
    const encrypt = has('encrypt');
    const key = encrypt ? requiredKey('An encrypted export') : null;
    const filesDir = dataDir === 'memory' ? null : join(dataDir, 'files');
    const db = await openDb(dataDir);
    try {
      if (encrypt) {
        const outFile = resolve(flag('out', join(backupsDir, `export-${timestamp()}${ENCRYPTED_EXT}`)));
        const { manifest, bytes } = await exportToArchive(db, { outFile, key, filesDir, includeSecrets: !has('no-secrets') });
        const rows = manifest.tables.reduce((sum, t) => sum + t.rows, 0);
        console.log(`Exported ${rows} rows from ${manifest.tables.length} tables and ${manifest.files.length} files to ${outFile} (${formatBytes(bytes)}, encrypted)`);
        console.log('  Read it back with: import-all <file>, or turn it into a plain tar file with: decrypt <file>');
        return 0;
      }
      const outDir = resolve(flag('out', join(backupsDir, `export-${timestamp()}`)));
      const manifest = await exportAll(db, { outDir, filesDir, includeSecrets: !has('no-secrets') });
      const rows = manifest.tables.reduce((sum, t) => sum + t.rows, 0);
      console.log(`Exported ${rows} rows from ${manifest.tables.length} tables and ${manifest.files.length} files to ${outDir}`);
      console.log(
        manifest.secretsIncluded
          ? '  It includes password hashes and second-factor secrets: protect it like a backup (or use --encrypt).'
          : '  Password hashes, second-factor secrets, sessions and one-time links were left out.',
      );
    } finally {
      await db.close();
    }
    return 0;
  }

  if (command === 'import-all') {
    requireStopped();
    const given = positional();
    if (!given || !existsSync(given)) throw new OpsError('Say which export to import: the folder that holds manifest.json, or an export archive.');
    const isFile = statSync(given).isFile();
    let inDir = resolve(given);
    if (isFile) {
      const { encrypted } = await readArchiveInfo(inDir);
      inDir = await unpackExport(inDir, encrypted ? requiredKey('This export is encrypted, so importing it') : null);
    }
    try {
      const { db, close } = await buildApp({ dataDir, serveWeb: false }); // creates and migrates the database
      try {
        const result = await importAll(db, { inDir, filesDir: dataDir === 'memory' ? null : join(dataDir, 'files') });
        const rows = result.tables.reduce((sum, t) => sum + t.rows, 0);
        console.log(`Imported ${rows} rows into ${result.tables.length} tables and ${result.files} files from ${resolve(given)}`);
        for (const note of result.notes) console.log(`  Note: ${note}`);
      } finally {
        await close();
      }
    } finally {
      if (isFile) await rm(inDir, { recursive: true, force: true });
    }
    return 0;
  }

  if (command === 'decrypt') {
    const file = positional();
    if (!file || !existsSync(file)) throw new OpsError('Say which encrypted archive to decrypt.');
    const out = resolve(flag('out', file.endsWith(ENCRYPTED_EXT) ? file.slice(0, -'.sgrc'.length) : `${file}.tar`));
    if (existsSync(out)) throw new OpsError(`${out} already exists.`);
    await decryptToTar(resolve(file), out, requiredKey('Decrypting'));
    console.log(`Decrypted to ${out} (a plain tar file: every entry was checked). It is NOT protected: delete it when done.`);
    return 0;
  }

  if (command === 'new-key') {
    const file = positional();
    if (!file) throw new OpsError('Say where to write the key file, outside the data folder: new-key <file>.');
    if (existsSync(file)) throw new OpsError(`${file} already exists; it was left alone.`);
    const abs = resolve(file);
    const rel = relative(resolve(dataDir), abs);
    if (dataDir !== 'memory' && !rel.startsWith('..') && !isAbsolute(rel)) throw new OpsError('Keep the key file outside the data folder.');
    writeFileSync(abs, newKeyText(), { flag: 'wx', mode: 0o600 });
    console.log(`Wrote a new key to ${abs}. Keep a copy somewhere safe and separate from the backups: without it they cannot be read.`);
    return 0;
  }

  if (command === 'move-files') {
    requireStopped();
    const to = flag('to', '');
    if (to !== 'disk' && to !== 's3') throw new OpsError('Say where to move the files: --to disk or --to s3.');
    const { moveFiles } = await import('./modules/attachments/housekeeping.ts');
    const { ctx, close } = await buildApp({ dataDir, serveWeb: false });
    try {
      const result = await moveFiles(ctx, to, (line) => console.log(`  ${line}`));
      console.log(`Moved ${result.moved} file(s) to ${to === 's3' ? 'the object store' : 'the local disk'}; ${result.skipped} already there; ${result.failed} failed.`);
      return result.failed ? 1 : 0;
    } finally {
      await close();
    }
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
