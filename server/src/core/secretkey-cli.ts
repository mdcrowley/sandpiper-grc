// Shows where the secret key comes from, or writes a new one (E02-16).
//
//   npx tsx server/src/core/secretkey-cli.ts show
//   npx tsx server/src/core/secretkey-cli.ts rotate     (stop the server first)
//
// Uses GRC_DATA_DIR (default ./data) and the same GRC_SECRET_KEY* variables as the server.
// Never prints the key itself, only a short fingerprint for telling keys apart.
// `show` also opens the database (read only) and says whether any stored value still needs a
// retired key (E02-20). With the embedded database that needs the server stopped; otherwise the
// server's start-up log says the same.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseUrl, openDb } from './db.ts';
import { makeSecretBox } from './secretbox.ts';
import { defaultKeyFile, describeSecretKey, LEGACY_KEY_FILE, resolveSecretKey, rotateSecretKey } from './secretkey.ts';
import { resealStoredSecrets, retiredKeyAdvice } from './secretkey-reseal.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const dataDir = process.env.GRC_DATA_DIR ? resolve(process.env.GRC_DATA_DIR) : resolve(repoRoot, 'data');
const command = process.argv[2] ?? 'show';

/** Whether stored values still need a retired key, read from the database without changing it. */
async function retiredKeyCheck(): Promise<string> {
  if (!databaseUrl() && !existsSync(join(dataDir, 'pg'))) return 'No database yet: nothing is stored with any key.';
  if (!databaseUrl() && existsSync(join(dataDir, 'grc.pid'))) {
    return 'The server is running, so the stored values were not checked; its start-up log says whether the retired keys are still needed.';
  }
  // Only when the key can be read without moving or creating anything (`show` changes nothing).
  const keyFile = process.env.GRC_SECRET_KEY_FILE ? resolve(process.env.GRC_SECRET_KEY_FILE) : defaultKeyFile(dataDir);
  if (!process.env.GRC_SECRET_KEY && (!existsSync(keyFile) || (!process.env.GRC_SECRET_KEY_FILE && existsSync(join(dataDir, LEGACY_KEY_FILE))))) {
    return 'The stored values were not checked: start the server once so the key is put in its place.';
  }
  const found = resolveSecretKey(dataDir);
  const box = makeSecretBox(found.key, found.previous, found.source);
  const db = await openDb(dataDir);
  try {
    return retiredKeyAdvice(await resealStoredSecrets(db, box, { write: false }), found.previous.length);
  } finally {
    await db.close();
  }
}

try {
  if (command === 'show') {
    console.log(`Data folder: ${dataDir}`);
    for (const line of describeSecretKey(dataDir)) console.log(line);
    try {
      console.log(await retiredKeyCheck());
    } catch (err) {
      console.log(`The stored values could not be checked: ${(err as Error).message}`);
    }
  } else if (command === 'rotate') {
    for (const line of rotateSecretKey(dataDir)) console.log(line);
  } else {
    console.error('Usage: secretkey-cli.ts show | rotate');
    process.exitCode = 2;
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
}
