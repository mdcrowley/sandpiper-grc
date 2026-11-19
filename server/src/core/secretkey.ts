import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

/**
 * Where the secret key (the key that encrypts authenticator keys and webhook secrets in the
 * database, see secretbox.ts) comes from, and keeping it OUT of the data folder (E02-16), so that a
 * copy of the data folder or a `backup` does not hold both the encrypted values and their key.
 *
 * In order:
 *   1. GRC_SECRET_KEY        the key itself (64 hex characters or base64)
 *   2. GRC_SECRET_KEY_FILE   a file holding it (created on first start if missing)
 *   3. <data folder>.secret.key, BESIDE the data folder: for data folder C:\grc\data the file is
 *      C:\grc\data.secret.key. Generated on first start.
 *
 * Installations from before this change kept the key at <data folder>/secret.key. At start-up that
 * file is moved beside the data folder (copied, read back and compared, then deleted). When both
 * exist (an old backup restored over the data folder) and hold the same key, the inner copy is
 * deleted; when they differ, the outer one is used, the inner one is read as a retired key so values
 * written with it are re-encrypted, and the inner file is left for the operator to delete.
 *
 * Retired keys: GRC_SECRET_KEY_PREVIOUS (comma-separated) and the lines of <key file>.previous,
 * which `secret-key rotate` writes.
 */

export const LEGACY_KEY_FILE = 'secret.key';

/** The default key file for a data folder: beside it, named after it. */
export function defaultKeyFile(dataDir: string): string {
  const abs = resolve(dataDir);
  return join(dirname(abs), `${basename(abs)}.secret.key`);
}

export const previousKeyFile = (keyFile: string) => `${keyFile}.previous`;

/** True when `file` is inside `dir` (or is it). */
export function isInside(dir: string, file: string): boolean {
  const rel = relative(resolve(dir), resolve(file));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function parseKey(text: string): Buffer {
  const t = text.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(t) ? Buffer.from(t, 'hex') : Buffer.from(t, 'base64');
  if (key.length !== 32) throw new Error('The secret key must be 32 bytes, given as 64 hex characters or as base64.');
  return key;
}

/** A short fingerprint for telling keys apart in messages. Reveals nothing useful about the key. */
export const fingerprint = (key: Buffer) => createHash('sha256').update(key).digest('hex').slice(0, 12);

const newKeyText = () => `${randomBytes(32).toString('hex')}\n`;

function writeNewFile(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, { flag: 'wx', mode: 0o600 }); // `wx`: never overwrite a key that appeared meanwhile
}

const readKeyFile = (file: string) => parseKey(readFileSync(file, 'utf8'));

function readPrevious(file: string | null): Buffer[] {
  const out = String(process.env.GRC_SECRET_KEY_PREVIOUS ?? '').split(',').filter((s) => s.trim()).map(parseKey);
  if (file && existsSync(previousKeyFile(file))) {
    for (const line of readFileSync(previousKeyFile(file), 'utf8').split(/\r?\n/)) if (line.trim()) out.push(parseKey(line));
  }
  return out;
}

export interface ResolvedKey {
  key: Buffer;
  previous: Buffer[];
  source: 'environment' | 'file' | 'memory';
  file: string | null;
  /** Plain-English start-up messages: what was used, and anything moved or needing attention. */
  notes: string[];
  /** Notes that need the operator's attention (printed as errors). */
  warnings: string[];
}

/** Finds the key for a data folder, moving an old in-folder key out and creating one on first start. */
export function resolveSecretKey(dataDir: string): ResolvedKey {
  const notes: string[] = [];
  const warnings: string[] = [];
  const legacy = dataDir === 'memory' ? null : join(resolve(dataDir), LEGACY_KEY_FILE);
  const legacyKey = () => (legacy && existsSync(legacy) ? readKeyFile(legacy) : null);

  if (process.env.GRC_SECRET_KEY) {
    const key = parseKey(process.env.GRC_SECRET_KEY);
    const previous = readPrevious(null);
    const old = legacyKey();
    notes.push('Using the key from GRC_SECRET_KEY.');
    if (old && !old.equals(key)) {
      previous.push(old);
      warnings.push(`An older key file is still in the data folder (${legacy}). Values written with it are being re-encrypted with GRC_SECRET_KEY; delete that file once the server has started cleanly.`);
    } else if (old) {
      warnings.push(`A copy of the key is still in the data folder (${legacy}), so backups of the data folder contain it. Delete that file.`);
    }
    return { key, previous, source: 'environment', file: null, notes, warnings };
  }
  if (dataDir === 'memory' && !process.env.GRC_SECRET_KEY_FILE) {
    return { key: randomBytes(32), previous: readPrevious(null), source: 'memory', file: null, notes, warnings };
  }

  if (process.env.GRC_SECRET_KEY_FILE) {
    const file = resolve(process.env.GRC_SECRET_KEY_FILE);
    if (!existsSync(file)) {
      writeNewFile(file, newKeyText());
      notes.push(`Generated a new key in ${file} (GRC_SECRET_KEY_FILE).`);
    } else {
      notes.push(`Using the key in ${file} (GRC_SECRET_KEY_FILE).`);
    }
    if (dataDir !== 'memory' && isInside(dataDir, file)) {
      warnings.push(`GRC_SECRET_KEY_FILE (${file}) is inside the data folder, so every backup holds the key beside the values it protects. Move it outside the data folder.`);
    }
    return { key: readKeyFile(file), previous: readPrevious(file), source: 'file', file, notes, warnings };
  }

  const outside = defaultKeyFile(dataDir);
  const inside = legacy!;
  let file = outside;
  const previousExtra: Buffer[] = [];
  if (existsSync(outside) && existsSync(inside)) {
    const a = readKeyFile(outside);
    const b = readKeyFile(inside);
    if (a.equals(b)) {
      rmSync(inside, { force: true });
      notes.push(`Removed a second copy from the data folder (${inside}); the key is kept in ${outside}.`);
    } else {
      previousExtra.push(b);
      warnings.push(`Two different secret keys were found: ${outside} (used) and ${inside} in the data folder (perhaps restored from an older backup). `
        + 'Values written with the older key are re-encrypted with the one in use. Delete the file in the data folder once the server has started cleanly.');
    }
  } else if (existsSync(inside)) {
    // An installation from before E02-16: move the key beside the data folder.
    try {
      const text = readFileSync(inside, 'utf8');
      writeNewFile(outside, text);
      if (!readKeyFile(outside).equals(parseKey(text))) throw new Error('the copy does not match');
      rmSync(inside, { force: true });
      notes.push(`Moved the key out of the data folder, from ${inside} to ${outside}. Back that file up separately from the data folder: backups of the data folder no longer contain it.`);
    } catch (err) {
      file = inside;
      warnings.push(`The secret key could not be moved out of the data folder (${(err as Error).message}); still using ${inside}. `
        + 'Backups of the data folder contain it. Set GRC_SECRET_KEY_FILE to a path outside the data folder, or make its parent folder writable.');
    }
  } else if (!existsSync(outside)) {
    try {
      writeNewFile(outside, newKeyText());
      notes.push(`Generated a new key in ${outside}, beside the data folder. Back it up separately from the data folder.`);
    } catch (err) {
      file = inside;
      writeNewFile(inside, newKeyText());
      warnings.push(`The secret key could not be written beside the data folder (${(err as Error).message}); it was generated in ${inside} instead, `
        + 'so backups of the data folder contain it. Set GRC_SECRET_KEY_FILE to a path outside the data folder.');
    }
  }
  if (file === outside && !notes.length && !warnings.length) notes.push(`Using the key in ${outside}, outside the data folder.`);
  return { key: readKeyFile(file), previous: [...readPrevious(file), ...previousExtra], source: 'file', file, notes, warnings };
}

/** What `secret-key show` prints: where the key comes from, without changing anything. */
export function describeSecretKey(dataDir: string): string[] {
  const out: string[] = [];
  const legacy = join(resolve(dataDir), LEGACY_KEY_FILE);
  if (process.env.GRC_SECRET_KEY) {
    out.push(`Source: the GRC_SECRET_KEY environment variable (fingerprint ${fingerprint(parseKey(process.env.GRC_SECRET_KEY))}).`);
  } else {
    const file = process.env.GRC_SECRET_KEY_FILE ? resolve(process.env.GRC_SECRET_KEY_FILE) : defaultKeyFile(dataDir);
    const how = process.env.GRC_SECRET_KEY_FILE ? 'GRC_SECRET_KEY_FILE' : 'the default, beside the data folder';
    if (existsSync(file)) out.push(`Source: the file ${file} (${how}; fingerprint ${fingerprint(readKeyFile(file))}).`);
    else if (!process.env.GRC_SECRET_KEY_FILE && existsSync(legacy)) out.push(`Source: ${legacy}, inside the data folder (fingerprint ${fingerprint(readKeyFile(legacy))}). It will be moved to ${file} at the next start.`);
    else out.push(`No key yet: one is generated in ${file} (${how}) at the next start.`);
    if (existsSync(previousKeyFile(file))) out.push(`Retired keys: ${previousKeyFile(file)} (delete it once every value has been re-encrypted; see docs/security.md).`);
    if (isInside(dataDir, file)) out.push('Warning: the key file is inside the data folder, so backups of the data folder contain it.');
  }
  if (process.env.GRC_SECRET_KEY_PREVIOUS) out.push('Retired keys: GRC_SECRET_KEY_PREVIOUS is set.');
  if (existsSync(legacy) && (process.env.GRC_SECRET_KEY || process.env.GRC_SECRET_KEY_FILE)) out.push(`Note: ${legacy} is not in use. Delete it once the server has started cleanly.`);
  return out;
}

/**
 * `secret-key rotate`: writes a new key to the key file and keeps the old one in <file>.previous,
 * so the next start re-encrypts stored values with the new key. Refused while the server runs and
 * when the key comes from GRC_SECRET_KEY (change the variable instead).
 */
export function rotateSecretKey(dataDir: string): string[] {
  if (process.env.GRC_SECRET_KEY) {
    throw new Error('The key comes from GRC_SECRET_KEY. To change it, set the new key there and the old one in GRC_SECRET_KEY_PREVIOUS for one start (docs/security.md).');
  }
  if (existsSync(join(resolve(dataDir), 'grc.pid'))) throw new Error('The server appears to be running (grc.pid is in the data folder). Stop it first.');
  const resolved = resolveSecretKey(dataDir); // also moves an old in-folder key out first
  const file = resolved.file!;
  const old = resolved.key;
  writeFileSync(previousKeyFile(file), `${old.toString('hex')}\n`, { flag: 'a', mode: 0o600 });
  const tmp = `${file}.new`;
  rmSync(tmp, { force: true });
  writeNewFile(tmp, newKeyText());
  renameSync(tmp, file);
  return [
    ...resolved.notes, ...resolved.warnings,
    `New secret key written to ${file} (fingerprint ${fingerprint(readKeyFile(file))}); the old one (fingerprint ${fingerprint(old)}) is kept in ${previousKeyFile(file)}.`,
    'Start the server: stored values are re-encrypted with the new key at start-up. Then back up the new key file.',
  ];
}
