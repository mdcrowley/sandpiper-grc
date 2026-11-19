import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { parseKey, resolveSecretKey } from './secretkey.ts';

export { parseKey };

/**
 * Field-level encryption for secrets kept in the database (authenticator keys).
 *
 * Stored format, versioned so the scheme can change later:  enc:v1:<iv>:<tag>:<ciphertext>
 * (AES-256-GCM, 12-byte random iv, each part base64url). The `context` (for example
 * "totp:<user id>") is authenticated with the value, so a ciphertext copied onto another
 * row does not decrypt.
 *
 * The key comes from, in order (see secretkey.ts):
 *   1. GRC_SECRET_KEY            - 32 bytes as 64 hex characters or base64
 *   2. GRC_SECRET_KEY_FILE       - path of a file holding the same
 *   3. <data folder>.secret.key  - beside (not inside) the data folder, generated on first start
 * Retired keys (GRC_SECRET_KEY_PREVIOUS, comma-separated, and <key file>.previous): values written
 * with them still decrypt, and are re-encrypted with the current key at start-up.
 */

const PREFIX = 'enc:v1:';
/** The key file's name inside the data folder in installations from before E02-16 (moved out at start-up). */
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

/**
 * Loads the key for a data folder (secretkey.ts: from the environment, or a key file kept beside the
 * data folder, created on first start; an old key inside the data folder is moved out). `memory`
 * gets a throwaway key. Says at start-up where the key came from and anything that needs attention.
 */
export function loadSecretBox(dataDir: string): SecretBox {
  const found = resolveSecretKey(dataDir);
  if (found.source !== 'memory') {
    for (const note of found.notes) console.log(`[secret key] ${note}`);
    for (const warning of found.warnings) console.error(`[secret key] ${warning}`);
  }
  return makeSecretBox(found.key, found.previous, found.source);
}