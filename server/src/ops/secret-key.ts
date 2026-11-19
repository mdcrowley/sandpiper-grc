import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defaultKeyFile, fingerprint, isInside, parseKey, previousKeyFile } from '../core/secretkey.ts';

// The secret key (it encrypts authenticator keys and webhook secrets in the database) is kept
// beside the data folder, not in it (core/secretkey.ts), so a backup of the data folder does not
// contain it. These helpers say so plainly, find the key file for the optional copy inside an
// encrypted backup, and put a key from such a backup in place on restore.

/** Where the key comes from, as backups see it. */
export function secretKeyLocation(dataDir: string): { source: 'environment' | 'file'; file: string | null; insideData: boolean } {
  if (process.env.GRC_SECRET_KEY) return { source: 'environment', file: null, insideData: false };
  const file = process.env.GRC_SECRET_KEY_FILE ? resolve(process.env.GRC_SECRET_KEY_FILE) : defaultKeyFile(dataDir);
  return { source: 'file', file, insideData: dataDir !== 'memory' && isInside(dataDir, file) };
}

/** One paragraph for backup, restore and status: the key is not in the backup, and what to do about it. */
export function secretKeyNote(dataDir: string, included = false): string {
  const where = secretKeyLocation(dataDir);
  if (included) return 'This backup also holds the secret key (inside the encryption): restoring it puts the key in place.';
  if (where.source === 'environment') {
    return 'The secret key comes from GRC_SECRET_KEY and is not in backups: keep a copy with your other secrets; set it again before starting a restored copy.';
  }
  if (where.insideData) return `The secret key file ${where.file} is inside the data folder, so backups contain it. Move it outside (GRC_SECRET_KEY_FILE).`;
  return `The secret key is kept in ${where.file}, beside the data folder, and is not in backups (unless an encrypted backup is told to include it). Back that file up separately. `
    + 'To restore on another machine, put it beside the restored data folder under the same name, or set GRC_SECRET_KEY or GRC_SECRET_KEY_FILE before starting.';
}

/** The key file to copy into an encrypted backup when asked to; null when the key is not in a file. */
export function secretKeyFileToInclude(dataDir: string): string | null {
  const where = secretKeyLocation(dataDir);
  return where.file && existsSync(where.file) ? where.file : null;
}

/**
 * Puts a key restored from a backup in place: where the key file belongs when there is none;
 * nothing when the same key is there; otherwise as a retired key (`<key file>.previous`), so values
 * written with it are re-encrypted with the key in use at the next start. Returns what was done.
 */
export function installRestoredKey(dataDir: string, restored: string): string {
  const key = parseKey(readFileSync(restored, 'utf8'));
  if (process.env.GRC_SECRET_KEY) {
    const current = parseKey(process.env.GRC_SECRET_KEY);
    return current.equals(key)
      ? 'The secret key in the backup is the one in GRC_SECRET_KEY.'
      : `The backup holds a different secret key (fingerprint ${fingerprint(key)}) from GRC_SECRET_KEY. Add it to GRC_SECRET_KEY_PREVIOUS before starting, or authenticator keys and webhook secrets cannot be read.`;
  }
  const target = process.env.GRC_SECRET_KEY_FILE ? resolve(process.env.GRC_SECRET_KEY_FILE) : defaultKeyFile(dataDir);
  if (!existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(restored, target);
    return `The secret key from the backup was put in ${target}.`;
  }
  if (parseKey(readFileSync(target, 'utf8')).equals(key)) return `The secret key in the backup is the one already in ${target}.`;
  appendFileSync(previousKeyFile(target), `${key.toString('hex')}\n`, { mode: 0o600 });
  return `The backup's secret key differs from the one in ${target}; it was added to ${previousKeyFile(target)} so its values are re-encrypted with the current key at the next start.`;
}
