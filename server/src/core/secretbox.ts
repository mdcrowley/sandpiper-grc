import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Field-level encryption for secrets kept in the database (authenticator keys).
 *
 * Stored format, versioned so the scheme can change later:  enc:v1:<iv>:<tag>:<ciphertext>
 * (AES-256-GCM, 12-byte random iv, each part base64url). The `context` (for example
 * "totp:<user id>") is authenticated with the value, so a ciphertext copied onto another
 * row does not decrypt.
 *
 * The key comes from, in order:
 *   1. GRC_SECRET_KEY            - 32 bytes as 64 hex characters or base64
 *   2. GRC_SECRET_KEY_FILE       - path of a file holding the same
 *   3. <data folder>/secret.key  - generated on first start
 * GRC_SECRET_KEY_PREVIOUS (comma-separated, same format) lists retired keys: values written
 * with them still decrypt, and are re-encrypted with the current key at start-up.
 */

const PREFIX = 'enc:v1:';
export const KEY_FILE_NAME = 'secret.key';

export interface SecretBox {
  encrypt(plain: string, context: string): string;
  /** Decrypts a stored value. A value that was never encrypted (older data) is returned as it is. */
  decrypt(stored: string, context: string): string;
  /** True when the value is already encrypted with the CURRENT key. */
  isCurrent(stored: string, context: string): boolean;
  source: 'environment' | 'file' | 'memory';
}

export const isEncrypted = (stored: string) => stored.startsWith('enc:');

export function parseKey(text: string): Buffer {
  const t = text.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(t) ? Buffer.from(t, 'hex') : Buffer.from(t, 'base64');
  if (key.length !== 32) throw new Error('The secret key must be 32 bytes, given as 64 hex characters or as base64.');
  return key;
}

function seal(key: Buffer, plain: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join(':');
}

function open(key: Buffer, stored: string, context: string): string | null {
  if (!stored.startsWith(PREFIX)) return null;
  const [iv, tag, body] = stored.slice(PREFIX.length).split(':').map((p) => Buffer.from(p ?? '', 'base64url'));
  if (iv?.length !== 12 || tag?.length !== 16 || !body) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    return null; // wrong key, wrong context or altered value
  }
}

export function makeSecretBox(key: Buffer, previous: Buffer[] = [], source: SecretBox['source'] = 'memory'): SecretBox {
  return {
    source,
    encrypt: (plain, context) => seal(key, plain, context),
    decrypt(stored, context) {
      if (!isEncrypted(stored)) return stored;
      for (const k of [key, ...previous]) {
        const plain = open(k, stored, context);
        if (plain !== null) return plain;
      }
      throw new Error('A stored secret could not be decrypted: the secret key is not the one it was written with.');
    },
    isCurrent: (stored, context) => open(key, stored, context) !== null,
  };
}

/** Loads the key for a data folder, creating the key file on first start. `memory` gets a throwaway key. */
export function loadSecretBox(dataDir: string): SecretBox {
  const previous = String(process.env.GRC_SECRET_KEY_PREVIOUS ?? '').split(',').filter((s) => s.trim()).map(parseKey);
  if (process.env.GRC_SECRET_KEY) return makeSecretBox(parseKey(process.env.GRC_SECRET_KEY), previous, 'environment');
  if (dataDir === 'memory' && !process.env.GRC_SECRET_KEY_FILE) return makeSecretBox(randomBytes(32), previous, 'memory');
  const file = process.env.GRC_SECRET_KEY_FILE ? resolve(process.env.GRC_SECRET_KEY_FILE) : join(dataDir, KEY_FILE_NAME);
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    // `wx`: never overwrite a key that appeared in the meantime.
    writeFileSync(file, `${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
  }
  return makeSecretBox(parseKey(readFileSync(file, 'utf8')), previous, 'file');
}