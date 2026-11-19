// Shows where the secret key comes from, or writes a new one (E02-16).
//
//   npx tsx server/src/core/secretkey-cli.ts show
//   npx tsx server/src/core/secretkey-cli.ts rotate     (stop the server first)
//
// Uses GRC_DATA_DIR (default ./data) and the same GRC_SECRET_KEY* variables as the server.
// Never prints the key itself, only a short fingerprint for telling keys apart.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeSecretKey, rotateSecretKey } from './secretkey.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const dataDir = process.env.GRC_DATA_DIR ? resolve(process.env.GRC_DATA_DIR) : resolve(repoRoot, 'data');
const command = process.argv[2] ?? 'show';

try {
  if (command === 'show') {
    console.log(`Data folder: ${dataDir}`);
    for (const line of describeSecretKey(dataDir)) console.log(line);
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
