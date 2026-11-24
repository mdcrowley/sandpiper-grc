// The audit archive run as the database owner (E40-14).
//
// With a least-privilege database role (docs/installation.md) the account the server uses may not
// delete audit events, so the daily job cannot archive. This runs the same archive
// (core/audit-archive.ts: write, read back and check, then remove exactly those events, audited as
// `audit.archive`) on a connection made as the owner (GRC_DATABASE_MIGRATE_URL, with
// GRC_DATABASE_MIGRATE_PASSWORD(_FILE)). It uses the settings an administrator chose under Audit log >
// Archive old events (on or off, the age, the folder); `folder` may name another folder for this run,
// for a command run on a machine other than the server's.
//
//   npm run cli -- audit-archive [--folder <dir>]     (grc audit-archive in the container)
//
// It never changes the schema or the grants: the owner's connection is used for the archive only.
import { isAbsolute } from 'node:path';
import { archiveAuditEvents, archiveSettingsProblems, mayRemoveAuditEvents, readArchiveSettings, type ArchiveResult } from '../core/audit-archive.ts';
import type { Db } from '../core/db.ts';
import { makeAudit, makeSettings } from '../core/services.ts';
import { OpsError } from './errors.ts';

export interface OwnerArchiveOptions {
  dataDir: string;
  /** Write the file here instead of the folder in the settings (absolute, outside the data folder). */
  folder?: string;
  now?: Date;
  onProgress?: (line: string) => void;
}

/** One archive run on `db`, which must be a connection as an account that may delete audit events. */
export async function archiveAsOwner(db: Db, opts: OwnerArchiveOptions): Promise<ArchiveResult & { account: string }> {
  const audit = makeAudit(db);
  const settings = makeSettings(db, audit);
  const account = (await db.one<{ u: string }>('select current_user as u'))!.u;
  const saved = await readArchiveSettings({ settings });
  if (!saved.enabled) {
    throw new OpsError('The audit archive is off. An administrator switches it on, with the age and the folder, under Audit log > Archive old events; nothing was archived.');
  }
  const s = { ...saved, folder: opts.folder?.trim() || saved.folder };
  if (opts.folder && !isAbsolute(opts.folder)) throw new OpsError('--folder needs a full path.');
  const problems = archiveSettingsProblems(s, opts.dataDir);
  if (Object.keys(problems).length) throw new OpsError(`The archive settings cannot be used: ${Object.values(problems).join(' ')}`);
  if (!(await mayRemoveAuditEvents(db))) {
    throw new OpsError(`The database account "${account}" may not remove audit events either. Run this as the owner of the tables: set GRC_DATABASE_MIGRATE_URL (and GRC_DATABASE_MIGRATE_PASSWORD_FILE) to the owner account.`);
  }
  const result = await archiveAuditEvents({ db, audit, settings }, {
    now: opts.now, settings: s, by: `the owner command (database account ${account})`,
    onProgress: async (p) => {
      opts.onProgress?.(p.stage === 'removing' ? `  ${p.removed} of ${p.events} events removed` : `  ${p.events} events written`);
    },
  });
  return { ...result, account };
}
