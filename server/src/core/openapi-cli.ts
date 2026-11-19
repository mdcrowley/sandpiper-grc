// Writes the whole OpenAPI document (every record type and route, not cut down to one person's
// permissions) to a file, or to standard output, after checking its structure:
//
//   npx tsx server/src/core/openapi-cli.ts [file] [--unversioned]
//
// Paths are under the stable base path /api/v1 (docs/api.md); `--unversioned` writes them under
// /api as the web application uses them. The structure is checked (core/api/validate.ts: tags,
// operation ids, path parameters, references, no undescribed route) and the command fails with
// the problems listed when the check does not pass; nothing is written then.
//
// It builds an in-memory application, so it reads no data and needs no running server.
// GRC_MODULES limits the modules described, as it does everywhere else.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildApp } from '../app.ts';
import { validateOpenApi } from './api/validate.ts';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--'));
const version = args.includes('--unversioned') ? null : 'v1';
const built = await buildApp({ dataDir: 'memory', serveWeb: false });
try {
  const doc = await built.core.openapi.build(null, { version });
  const problems = validateOpenApi(doc);
  if (problems.length) {
    console.error(`The OpenAPI document has ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    const json = `${JSON.stringify(doc, null, 2)}\n`;
    const count = Object.values(doc.paths as Record<string, object>).reduce((n, ops) => n + Object.keys(ops).length, 0);
    if (out) {
      mkdirSync(dirname(resolve(out)), { recursive: true });
      writeFileSync(resolve(out), json);
      console.error(`OpenAPI document (${count} operations, base path ${version ? '/api/v1' : '/api'}) written to ${resolve(out)}`);
    } else {
      process.stdout.write(json);
    }
  }
} finally {
  await built.close();
}
