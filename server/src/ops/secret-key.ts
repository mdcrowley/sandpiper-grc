import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { defaultKeyFile, fingerprint, isInside, LEGACY_KEY_FILE, parseKey, previousKeyFile } from '../core/secretkey.ts';
import { OpsError } from './errors.ts';
import { PRIVATE_DIR, PRIVATE_FILE } from './files.ts';

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
    + 'To restore into another data folder or on another machine, put a copy beside the restored data folder under that folder\'s name (<data folder>.secret.key), or set GRC_SECRET_KEY or GRC_SECRET_KEY_FILE: restore refuses until the key is there.';
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
    mkdirSync(dirname(target), { recursive: true, mode: PRIVATE_DIR });
    copyFileSync(restored, target);
    chmodSync(target, PRIVATE_FILE); // SP-07: the copy would otherwise keep the extracted file's mode
    return `The secret key from the backup was put in ${target}.`;
  }
  if (parseKey(readFileSync(target, 'utf8')).equals(key)) return `The secret key in the backup is the one already in ${target}.`;
  appendFileSync(previousKeyFile(target), `${key.toString('hex')}\n`, { mode: 0o600 });
  return `The backup's secret key differs from the one in ${target}; it was added to ${previousKeyFile(target)} so its values are re-encrypted with the current key at the next start.`;
}

/** The key file a data folder uses (GRC_SECRET_KEY_FILE, or the default beside it); null when the key comes from GRC_SECRET_KEY. */
function keyFileFor(dataDir: string): string | null {
  if (process.env.GRC_SECRET_KEY) return null;
  return process.env.GRC_SECRET_KEY_FILE ? resolve(process.env.GRC_SECRET_KEY_FILE) : defaultKeyFile(dataDir);
}

const fingerprintOfFile = (file: string): string | null => {
  try {
    return fingerprint(parseKey(readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
};

/**
 * Fingerprint of the key a data folder's stored secrets are encrypted with, without creating
 * one: recorded in backups and exports so a restore can tell whether it has that key (DOC-01).
 * Null when there is no key yet (or `memory`).
 */
export function currentKeyFingerprint(dataDir: string): string | null {
  if (process.env.GRC_SECRET_KEY) return fingerprint(parseKey(process.env.GRC_SECRET_KEY));
  if (dataDir === 'memory' && !process.env.GRC_SECRET_KEY_FILE) return null;
  const file = keyFileFor(dataDir)!;
  if (existsSync(file)) return fingerprintOfFile(file);
  const legacy = join(resolve(dataDir), LEGACY_KEY_FILE);
  return existsSync(legacy) ? fingerprintOfFile(legacy) : null;
}

/** Fingerprints of every key a server on this data folder would read values with: the current key and the retired ones. */
export function availableKeyFingerprints(dataDir: string): string[] {
  const out: string[] = [];
  const current = currentKeyFingerprint(dataDir);
  if (current) out.push(current);
  for (const k of String(process.env.GRC_SECRET_KEY_PREVIOUS ?? '').split(',').filter((s) => s.trim())) {
    try { out.push(fingerprint(parseKey(k))); } catch { /* a bad entry is reported at start-up */ }
  }
  const file = keyFileFor(dataDir);
  if (file && existsSync(previousKeyFile(file))) {
    for (const line of readFileSync(previousKeyFile(file), 'utf8').split(/\r?\n/)) {
      try { if (line.trim()) out.push(fingerprint(parseKey(line))); } catch { /* as above */ }
    }
  }
  return out;
}

/** Restore anyway without the backup's secret key (GRC_RESTORE_NEW_SECRET_KEY=1 or `restore --new-secret-key`). */
export const allowNewSecretKey = () => /^(1|true|yes)$/i.test(String(process.env.GRC_RESTORE_NEW_SECRET_KEY ?? '').trim());

/**
 * Before a restore touches anything (DOC-01): the restored database's stored secrets
 * (authenticator keys, webhook, sign-in provider and mail secrets) can only be read with the key
 * they were written with. Without it a start would make a new key and nobody with a second factor
 * could sign in. Refuses unless that key will be available: in GRC_SECRET_KEY, the data folder's
 * key file (or its retired keys), carried in the backup (`carried`), or a key file inside the
 * restored data itself (backups from before the key moved out). `expected` is the fingerprint the
 * backup recorded; for older backups that recorded none, any key at all will do.
 * Returns a note for the operator, or null.
 */
export function checkRestoreKey(opts: { dataDir: string; expected: string | null | undefined; carried?: string[]; allowNew?: boolean }): string | null {
  const have = [...availableKeyFingerprints(opts.dataDir), ...(opts.carried ?? []).map(fingerprintOfFile).filter((f): f is string => Boolean(f))];
  const where = keyFileFor(opts.dataDir);
  const put = where
    ? `Copy the key file it was made with to ${where} (or point GRC_SECRET_KEY_FILE at it, or set GRC_SECRET_KEY) and run restore again.`
    : 'Set GRC_SECRET_KEY to the key it was made with (the current one can go in GRC_SECRET_KEY_PREVIOUS) and run restore again.';
  const lose = 'To restore without it, set GRC_RESTORE_NEW_SECRET_KEY=1 (or add --new-secret-key): a new key is then made, '
    + 'everyone who uses an authenticator app must set it up again, and webhook, sign-in provider and mail secrets must be entered again.';
  if (opts.expected) {
    if (have.includes(opts.expected)) return null;
    const message = `The backup's stored secrets (authenticator keys, webhook and sign-in provider secrets) are encrypted with the secret key whose fingerprint is ${opts.expected}, `
      + `and that key is not available for ${opts.dataDir}${have.length ? ` (the key there has fingerprint ${have[0]})` : ''}.`;
    if (opts.allowNew) return `${message} Restored anyway, as asked: those secrets cannot be read and must be set again.`;
    throw new OpsError(`${message} Current data is untouched. ${put} ${lose}`);
  }
  if (have.length) return null;
  const message = `There is no secret key for ${opts.dataDir}, and this backup does not say which key its stored secrets (authenticator keys, webhook and sign-in provider secrets) were encrypted with.`;
  if (opts.allowNew) return `${message} Restored anyway, as asked: a new key is made at the next start, and any stored secrets must be set again.`;
  throw new OpsError(`${message} Current data is untouched. ${put} ${lose}`);
}
