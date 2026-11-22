// Looking after stored files: usage figures, purging removed files after the retention period,
// files whose record has gone, the integrity check, scanning files that were attached before
// a scanner was switched on, and moving files between the local disk and the object store.
import { createHash } from 'node:crypto';
import { holdsOn } from '../../core/holds.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { readPurgeDays } from './config.ts';
import { noScanner, type ScanResult } from './scanner.ts';
import { formatBytes } from './service.ts';
import type { FileStorage } from './storage.ts';

const stores = (ctx: ModuleContext) => ctx.app.attachmentStores;

// ---------------------------------------------------------------- usage

export interface Usage {
  byDriver: { driver: string; files: number; bytes: number }[];
  active: { files: number; bytes: number };
  removed: { files: number; bytes: number };
  purged: { files: number; bytes: number };
  notScanned: number;
}

export async function usage(ctx: ModuleContext): Promise<Usage> {
  const rows = await ctx.db.query<Row>(
    `select storage_driver, case when purged_at is not null then 'purged' when deleted_at is not null then 'removed' else 'active' end as state,
            count(*)::int as files, coalesce(sum(size_bytes), 0)::bigint as bytes,
            count(*) filter (where deleted_at is null and scan_status = 'not_scanned')::int as not_scanned
       from attachments where storage_driver <> 'link' group by 1, 2`,
  );
  const sum = (state: string) => rows.filter((r) => r.state === state)
    .reduce<{ files: number; bytes: number }>((a, r) => ({ files: a.files + Number(r.files), bytes: a.bytes + Number(r.bytes) }), { files: 0, bytes: 0 });
  const drivers = new Map<string, { files: number; bytes: number }>();
  for (const r of rows.filter((x) => x.state !== 'purged')) {
    const d = drivers.get(r.storage_driver) ?? { files: 0, bytes: 0 };
    drivers.set(r.storage_driver, { files: d.files + r.files, bytes: d.bytes + Number(r.bytes) });
  }
  return {
    byDriver: [...drivers].map(([driver, v]) => ({ driver, ...v })).sort((a, b) => a.driver.localeCompare(b.driver)),
    active: sum('active'), removed: sum('removed'), purged: sum('purged'),
    notScanned: rows.reduce((a, r) => a + r.not_scanned, 0),
  };
}

// ---------------------------------------------------------------- files whose record has gone

/**
 * A file whose record has been deleted for good (by a retention review) is marked removed, so
 * that it follows the purge period like any other removed file. Records that are only
 * soft-deleted keep their files: the retention review decides about them. Nothing here ever
 * deletes a record.
 */
export async function markOrphans(ctx: ModuleContext): Promise<number> {
  let marked = 0;
  const types = await ctx.db.query<{ record_type: string }>('select distinct record_type from attachments where deleted_at is null');
  for (const { record_type } of types) {
    const def = ctx.resources.get(record_type);
    if (!def) continue; // that module is not loaded: say nothing about its records
    const gone = await ctx.db.query<Row>(
      `update attachments a set deleted_at = now(), updated_at = now(), removed_reason = 'record_gone'
        where a.record_type = $1 and a.deleted_at is null
          and not exists (select 1 from ${def.table} t where t.id = a.record_id)
        returning a.id, a.record_id, a.file_name`,
      [record_type],
    );
    for (const row of gone) {
      await ctx.audit(null, {
        action: 'attachment.delete', recordType: record_type, recordId: row.record_id,
        summary: `File removed because its record was deleted: ${row.file_name}`, before: { attachment_id: row.id },
      });
    }
    marked += gone.length;
  }
  return marked;
}

// ---------------------------------------------------------------- purge

export interface PurgeResult { purged: number; bytes: number; failed: number; days: number }

/** Deletes from storage the files removed more than `days` ago. The rows stay, marked purged. */
export async function purgeRemoved(ctx: ModuleContext, now = new Date()): Promise<PurgeResult> {
  const days = await readPurgeDays(ctx);
  const result: PurgeResult = { purged: 0, bytes: 0, failed: 0, days };
  if (days === 0) return result;
  const due = await ctx.db.query<Row>(
    `select * from attachments where deleted_at is not null and purged_at is null
       and deleted_at < $1::timestamptz - make_interval(days => $2::int) order by deleted_at limit 5000`,
    [now.toISOString(), days],
  );
  for (const att of due) {
    // A removed file of a record under a legal hold is kept until the hold is released (wave 11 C1).
    if ((await holdsOn(ctx.db, att.record_type, att.record_id)).length) continue;
    try {
      await stores(ctx).forDriver(att.storage_driver).delete(att.storage_key);
    } catch (err) {
      result.failed += 1;
      console.error(`[attachments] purge of ${att.id} failed:`, (err as Error).message);
      continue;
    }
    await ctx.db.query('update attachments set purged_at = now() where id = $1', [att.id]);
    await ctx.audit(null, {
      action: 'attachment.purge', recordType: att.record_type, recordId: att.record_id,
      summary: `Removed file purged from storage after ${days} days: ${att.file_name} (${formatBytes(Number(att.size_bytes))})`,
      before: { attachment_id: att.id, sha256: att.sha256, removed_at: att.deleted_at },
    });
    result.purged += 1;
    result.bytes += Number(att.size_bytes);
  }
  return result;
}

/** The daily work: files of deleted records, then the purge. */
export async function dailyHousekeeping(ctx: ModuleContext): Promise<{ orphans: number; purge: PurgeResult }> {
  const orphans = await markOrphans(ctx);
  const purge = await purgeRemoved(ctx);
  return { orphans, purge };
}

// ---------------------------------------------------------------- integrity check

export interface IntegrityReport {
  checkedAt: string;
  rows: number;
  stored: number;
  /** Rows (not purged) whose bytes are missing. */
  missing: { id: string; file_name: string; driver: string }[];
  missingCount: number;
  /** Stored objects no row refers to. */
  unreferenced: { driver: string; key: string; size: number }[];
  unreferencedCount: number;
  /** Stores that could not be listed. */
  unavailable: { driver: string; reason: string }[];
}

export async function checkIntegrity(ctx: ModuleContext): Promise<IntegrityReport> {
  const rows = await ctx.db.query<Row>("select id, file_name, storage_driver, storage_key, purged_at from attachments where storage_driver <> 'link'");
  const report: IntegrityReport = {
    checkedAt: new Date().toISOString(), rows: 0, stored: 0, missing: [], missingCount: 0, unreferenced: [], unreferencedCount: 0, unavailable: [],
  };
  const drivers = new Map<string, FileStorage>([[stores(ctx).local.driver, stores(ctx).local]]);
  const remote = stores(ctx).s3();
  if (remote) drivers.set('s3', remote);
  const listed = new Map<string, Map<string, number>>();
  for (const [name, store] of drivers) {
    try {
      listed.set(name, new Map((await store.list()).map((o) => [o.key, o.size])));
    } catch (err) {
      report.unavailable.push({ driver: name, reason: (err as Error).message });
    }
  }
  if (stores(ctx).s3Problem()) report.unavailable.push({ driver: 's3', reason: stores(ctx).s3Problem()! });
  const referenced = new Map<string, Set<string>>();
  for (const r of rows) {
    const driver = r.storage_driver === 'disk' || r.storage_driver === 'memory' ? stores(ctx).local.driver : r.storage_driver;
    if (!referenced.has(driver)) referenced.set(driver, new Set());
    referenced.get(driver)!.add(r.storage_key);
    if (r.purged_at) continue;
    report.rows += 1;
    const have = listed.get(driver);
    if (!have) continue; // that store could not be listed; reported above
    if (!have.has(r.storage_key)) {
      report.missingCount += 1;
      if (report.missing.length < 50) report.missing.push({ id: r.id, file_name: r.file_name, driver: r.storage_driver });
    }
  }
  for (const [driver, have] of listed) {
    report.stored += have.size;
    const refs = referenced.get(driver) ?? new Set();
    for (const [key, size] of have) {
      if (refs.has(key)) continue;
      report.unreferencedCount += 1;
      if (report.unreferenced.length < 50) report.unreferenced.push({ driver, key, size });
    }
  }
  return report;
}

// ---------------------------------------------------------------- scanning earlier files

export interface RescanResult { checked: number; clean: number; infected: number; errors: number; remaining: number; engine: string }

/** Scans files that were attached without a scan. An infected one is removed at once and reported. */
export async function rescanNotScanned(ctx: ModuleContext, limit = 200): Promise<RescanResult> {
  const scanner = ctx.app.fileScanner.current();
  if (scanner === noScanner || scanner.name === noScanner.name) ctx.fail(409, 'no_scanner', 'Switch malware scanning on first.');
  const due = await ctx.db.query<Row>(
    `select * from attachments where deleted_at is null and scan_status = 'not_scanned' order by created_at limit $1`, [limit],
  );
  const result: RescanResult = { checked: 0, clean: 0, infected: 0, errors: 0, remaining: 0, engine: scanner.name };
  for (const att of due) {
    result.checked += 1;
    let store: FileStorage;
    let scan: ScanResult;
    try {
      store = stores(ctx).forDriver(att.storage_driver);
      scan = await scanner.scan({
        fileName: att.file_name, extension: att.extension, size: Number(att.size_bytes), sha256: att.sha256,
        open: () => store.get(att.storage_key),
      });
    } catch (err) {
      scan = { verdict: 'error', detail: (err as Error).message };
    }
    if (scan.verdict === 'clean') {
      await ctx.db.query(`update attachments set scan_status = 'clean', scan_engine = $2, scanned_at = now() where id = $1`, [att.id, scanner.name]);
      result.clean += 1;
    } else if (scan.verdict === 'infected') {
      await stores(ctx).forDriver(att.storage_driver).delete(att.storage_key).catch(() => undefined);
      await ctx.db.query(
        `update attachments set scan_status = 'infected', scan_engine = $2, scanned_at = now(), deleted_at = now(), purged_at = now(),
           removed_reason = 'infected', updated_at = now() where id = $1`, [att.id, scanner.name]);
      await ctx.audit(null, {
        action: 'attachment.quarantine', recordType: att.record_type, recordId: att.record_id,
        summary: `File removed: malware found by ${scanner.name} (${scan.detail ?? 'infected'}): ${att.file_name}`,
        before: { attachment_id: att.id, sha256: att.sha256, uploaded_by: att.created_by },
      });
      result.infected += 1;
    } else {
      result.errors += 1;
    }
  }
  result.remaining = (await ctx.db.one<{ n: number }>(`select count(*)::int as n from attachments where deleted_at is null and scan_status = 'not_scanned'`))?.n ?? 0;
  if (result.infected && ctx.app.hasDecorator('notify')) {
    await ctx.app.notify({
      permission: 'admin.administer', kind: 'general',
      title: `Malware found in ${result.infected} attached file${result.infected === 1 ? '' : 's'}; ${result.infected === 1 ? 'it was' : 'they were'} removed`,
      body: 'See the audit log (action attachment.quarantine) for which files and records.',
      route: '/admin/attachments',
    });
  }
  await ctx.audit(null, {
    action: 'attachment.rescan', recordType: 'attachments',
    summary: `Scanned ${result.checked} earlier file(s) with ${scanner.name}: ${result.clean} clean, ${result.infected} infected, ${result.errors} could not be checked`,
  });
  return result;
}

// ---------------------------------------------------------------- moving between stores

export interface MoveResult { moved: number; skipped: number; failed: number }

/**
 * Moves every file (in use or removed, not purged) to `to`. Each one is copied, read back and
 * checked against its SHA-256 before the row is switched and the old copy deleted, so an
 * interruption leaves every file readable from one place or the other.
 */
export async function moveFiles(
  ctx: ModuleContext, to: 'disk' | 's3', log: (line: string) => void = () => undefined,
  progress?: (sofar: MoveResult & { total: number }) => Promise<void>,
): Promise<MoveResult> {
  await stores(ctx).reload();
  const target = to === 's3' ? stores(ctx).s3() : stores(ctx).local;
  if (!target) throw new Error(`The object store cannot be used: ${stores(ctx).s3Problem() ?? 'it is not configured on the File settings page'}.`);
  const rows = await ctx.db.query<Row>("select * from attachments where purged_at is null and storage_driver <> $1 and storage_driver <> 'link' order by created_at", [target.driver]);
  const result: MoveResult = { moved: 0, skipped: 0, failed: 0 };
  result.skipped = (await ctx.db.one<{ n: number }>('select count(*)::int as n from attachments where purged_at is null and storage_driver = $1', [target.driver]))?.n ?? 0;
  await progress?.({ ...result, total: rows.length });
  for (const att of rows) {
    try {
      const source = stores(ctx).forDriver(att.storage_driver);
      if (source === target) { result.skipped += 1; continue; }
      await target.put(att.storage_key, await source.get(att.storage_key));
      const hash = createHash('sha256');
      for await (const chunk of await target.get(att.storage_key)) hash.update(chunk as Buffer);
      if (hash.digest('hex') !== att.sha256) {
        await target.delete(att.storage_key).catch(() => undefined);
        throw new Error('the copy does not match the checksum');
      }
      await ctx.db.query('update attachments set storage_driver = $2 where id = $1', [att.id, target.driver]);
      await source.delete(att.storage_key);
      result.moved += 1;
      if (result.moved % 100 === 0) log(`${result.moved} moved so far`);
      if (result.moved % 20 === 0) await progress?.({ ...result, total: rows.length });
    } catch (err) {
      result.failed += 1;
      log(`FAILED ${att.file_name} (${att.id}): ${(err as Error).message}`);
    }
  }
  await ctx.audit(null, {
    action: 'attachment.move', recordType: 'attachments',
    summary: `Files moved to ${to === 's3' ? 'the object store' : 'the local disk'}: ${result.moved} moved, ${result.failed} failed`,
  });
  return result;
}
