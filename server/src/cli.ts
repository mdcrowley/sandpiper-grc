import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { buildApp, repoRoot } from './app.ts';
import { openDb } from './core/db.ts';
import { AREAS, featureState } from './core/features.ts';
import { applyOrganizationProfile } from './core/organization.ts';
import { DEV_ORGANIZATION, readOrganizationProfile } from './core/profile.ts';
import type { LookupValue, SeedOptions } from './core/module.ts';
import { decryptToTar, ENCRYPTED_EXT, isArchivePath, loadArchiveKey, newKeyText, readArchiveInfo } from './ops/archive.ts';
import {
  createBackup, listBackupsAsync, OpsError, pruneBackups, resolveBackup, restoreBackup, verifyBackup,
} from './ops/backup.ts';
import { exportAll, exportToArchive, importAll, unpackExport } from './ops/export.ts';
import { appVersion, formatBytes, serverPid, timestamp } from './ops/files.ts';
import { migrationsOnDisk, readAppliedMigrations } from './ops/migrations.ts';
import { asOwner, grantRuntimeRole, migrateAsOwner, migrateUrl, runtimeRole } from './ops/db-roles.ts';
import { runAudit, SEVERITIES, type Severity } from './ops/dependency-audit.ts';
import { followLog, formatLogLine, LEVELS, lastLines, logSettings } from './ops/logging.ts';
import { secretKeyNote } from './ops/secret-key.ts';
import { formatStatus, getStatus } from './ops/status.ts';
import { buildCommit } from './ops/version.ts';

// Command-line tasks. The embedded database allows one process at a time, so stop the
// server first (grc.ps1 and grc.sh do this for you). The operations commands live in ./ops.

const USAGE = `Usage: cli.ts <command>
  seed [--profile pilot|dev]            load data
  migrate                               bring the database up to date (as the owner when GRC_DATABASE_MIGRATE_URL is set)
  grant-runtime-role                    give the server's own database account its privileges (PostgreSQL server, as the owner)
  version                               the installed version and commit
  logs [--lines n] [--follow] [--level warn] [--json]   the end of the server log (data/logs/grc.log)
  audit-deps [--level high] [--all]     known vulnerabilities in the packages; fails only when a fix exists
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

const VALUE_FLAGS = ['profile', 'prune', 'label', 'out', 'key-file', 'passphrase-file', 'to', 'level', 'lines'];

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
    console.error(`The server is running on this data folder (process ${pid}). Stop it first: .\\grc.ps1 stop (Windows), ./grc.sh stop (macOS, Linux) or docker compose stop app (container).`);
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
    // The organization's details become settings (Administration > Organization), only where none
    // are stored yet: the profile is a one-time import, and the application is where they live.
    // The `dev` profile fills them with an invented example.
    const details = await applyOrganizationProfile(ctx, profile === 'pilot' ? organization : DEV_ORGANIZATION, profile === 'pilot' ? seedDir : null);
    if (details.set.length) console.log(`seed organization details: set ${details.set.join(', ')}`);
    if (details.kept.length) console.log(`seed organization details: kept the values already set for ${details.kept.join(', ')}`);
    for (const p of details.problems) console.error(`seed organization details: skipped ${p}`);
    for (const [list, values] of Object.entries(organization.lookups ?? {})) {
      await ctx.lookups.ensure(list, values as LookupValue[]);
    }
    console.log(`seed organization profile: ${Object.keys(organization).length ? Object.keys(organization).join(', ') : 'none'}`);

    const features = await featureState(ctx.db);
    for (const m of modules) {
      if (!m.seed) continue;
      // Sample data of a switched-off part of the application is not loaded (core/features.ts).
      const area = AREAS.find((a) => a.key === m.key || a.modules.includes(m.key));
      if (area && !features.on[area.key]) { console.log(`seed ${m.key}: skipped (${area.label} is switched off)`); continue; }
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
    if (migrateUrl()) {
      // Least-privilege set-up (E16-31): the owner changes the schema, then grants the server's account.
      const owner = await migrateAsOwner(dataDir, (dir) => buildApp({ dataDir: dir, serveWeb: false }));
      console.log(owner!.applied.length ? `Applied ${owner!.applied.length} migration(s) as the owner: ${owner!.applied.join(', ')}` : 'No migrations to apply.');
      console.log(owner!.granted ? `Granted the run-time role "${owner!.granted}" its privileges on ${owner!.tables} tables.` : 'No run-time role to grant (set GRC_DATABASE_URL or GRC_DATABASE_APP_ROLE).');
      console.log('Database is up to date.');
      return 0;
    }
    const before = (await readAppliedMigrations(dataDir)) ?? [];
    const { db, close } = await buildApp({ dataDir, serveWeb: false });
    const after = (await db.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name);
    await close();
    const added = after.filter((m) => !before.includes(m)).sort();
    console.log(added.length ? `Applied ${added.length} migration(s): ${added.join(', ')}` : 'No migrations to apply.');
    console.log('Database is up to date.');
    return 0;
  }

  if (command === 'grant-runtime-role') {
    const role = runtimeRole();
    if (!migrateUrl() || !role) throw new OpsError('Set GRC_DATABASE_MIGRATE_URL (the owner) and GRC_DATABASE_URL (the account the server uses, or GRC_DATABASE_APP_ROLE).');
    const result = await asOwner(async () => {
      const db = await openDb(dataDir);
      try {
        return await grantRuntimeRole(db, role);
      } finally {
        await db.close();
      }
    });
    console.log(`Granted "${role}" read and write on ${result.tables} tables in schema ${result.schema} (no schema changes, no audit log changes).`);
    return 0;
  }

  if (command === 'logs') {
    const settings = logSettings(dataDir);
    if (!settings.dir) throw new OpsError('The server writes no log file (GRC_LOG_DIR is off, or the data folder is "memory"); see its console output instead.');
    const file = join(settings.dir, 'grc.log');
    const count = Number(flag('lines', '40'));
    const min = flag('level', 'debug');
    if (!(LEVELS as readonly string[]).includes(min)) throw new OpsError(`--level must be one of ${LEVELS.join(', ')}.`);
    const keep = (line: string) => {
      try {
        return LEVELS.indexOf(JSON.parse(line).level) <= LEVELS.indexOf(min as (typeof LEVELS)[number]);
      } catch {
        return true;
      }
    };
    const show = (line: string) => { if (keep(line)) console.log(has('json') ? line : formatLogLine(line)); };
    if (!existsSync(file)) console.log(`No log yet in ${settings.dir} (the server writes it once started).`);
    // The previous run's file too, when the current one is short.
    let lines = lastLines(file, count * 4).filter(keep);
    if (lines.length < count) lines = [...lastLines(`${file}.1`, count * 4).filter(keep), ...lines];
    for (const l of lines.slice(-count)) console.log(has('json') ? l : formatLogLine(l));
    if (has('follow')) {
      followLog(file, show);
      await new Promise(() => {}); // until Ctrl+C
    }
    return 0;
  }

  if (command === 'version') {
    const commit = buildCommit();
    console.log(`Sandpiper GRC ${appVersion()}${commit ? ` (commit ${commit})` : ''}, Node.js ${process.version}`);
    return 0;
  }

  if (command === 'audit-deps') {
    const level = flag('level', 'high') as Severity;
    if (!SEVERITIES.includes(level)) throw new OpsError(`--level must be one of ${SEVERITIES.join(', ')}.`);
    const result = runAudit({ level, includeDev: has('all') });
    (result.code === 0 ? console.log : console.error)(result.text);
    // Exit 3 (could not run, usually no network) is a warning for local CI, not a failure.
    return result.code;
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
      // Loading needs the owner's rights (it switches triggers off while it loads), so with a
      // least-privilege set-up it runs as the owner and grants the run-time role afterwards.
      const { db, close } = await asOwner(() => buildApp({ dataDir, serveWeb: false })); // creates and migrates the database
      try {
        const result = await importAll(db, { inDir, filesDir: dataDir === 'memory' ? null : join(dataDir, 'files') });
        const rows = result.tables.reduce((sum, t) => sum + t.rows, 0);
        console.log(`Imported ${rows} rows into ${result.tables.length} tables and ${result.files} files from ${resolve(given)}`);
        for (const note of result.notes) console.log(`  Note: ${note}`);
        const role = runtimeRole();
        if (migrateUrl() && role) console.log(`  Granted "${role}" on ${(await grantRuntimeRole(db, role)).tables} tables.`);
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
