// Writes the whole OpenAPI document (every record type and route, not cut down to one person's
// permissions) to a file, or to standard output:
//
//   npx tsx server/src/core/openapi-cli.ts [file]
//
// It builds an in-memory application, so it reads no data and needs no running server.
// GRC_MODULES limits the modules described, as it does everywhere else.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildApp } from '../app.ts';

const out = process.argv[2];
const built = await buildApp({ dataDir: 'memory', serveWeb: false });
try {
  const json = `${JSON.stringify(await built.core.openapi.build(null), null, 2)}\n`;
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(resolve(out), json);
    console.error(`OpenAPI document written to ${resolve(out)}`);
  } else {
    process.stdout.write(json);
  }
} finally {
  await built.close();
}
