import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildApp, repoRoot } from './app.ts';
import type { LookupValue, SeedOptions } from './core/module.ts';

// Command-line tasks. The embedded database allows one process at a time, so stop the
// server first (grc.ps1 does this for you).

const [command, ...args] = process.argv.slice(2);
const dataDir = process.env.GRC_DATA_DIR ?? resolve(repoRoot, 'data');

function flag(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

if (dataDir !== 'memory' && existsSync(join(dataDir, 'grc.pid'))) {
  console.error('The server appears to be running (data/grc.pid exists). Stop it first: .\\grc.ps1 stop');
  process.exit(1);
}

if (command === 'seed') {
  const profile = flag('profile', 'pilot') as SeedOptions['profile'];
  const seedDir = process.env.GRC_SEED_DIR ?? resolve(repoRoot, 'seed');
  if (profile === 'pilot' && !existsSync(seedDir)) {
    console.error(`Seed folder not found: ${seedDir}. Use --profile dev for generated sample data.`);
    process.exit(1);
  }
  const { ctx, modules, close } = await buildApp({ dataDir, serveWeb: false });
  let failed = false;

  // Organisation profile: only read in the pilot profile, so `dev` never needs private files.
  const orgFile = join(seedDir, 'organisation.json');
  const organisation = profile === 'pilot' && existsSync(orgFile) ? JSON.parse(readFileSync(orgFile, 'utf8')) : {};
  if (typeof organisation.appName === 'string' && !(await ctx.db.one(`select 1 from settings where key = 'app.name'`))) {
    await ctx.settings.set('app.name', organisation.appName);
  }
  for (const [list, values] of Object.entries(organisation.lookups ?? {})) {
    await ctx.lookups.ensure(list, values as LookupValue[]);
  }
  console.log(`seed organisation profile: ${Object.keys(organisation).length ? Object.keys(organisation).join(', ') : 'none'}`);

  for (const m of modules) {
    if (!m.seed) continue;
    try {
      const note = await m.seed(ctx, { profile, seedDir, organisation });
      console.log(`seed ${m.key}: ${note || 'done'}`);
    } catch (err) {
      failed = true;
      console.error(`seed ${m.key}: FAILED - ${(err as Error).message}`);
    }
  }
  await close();
  process.exit(failed ? 1 : 0);
} else if (command === 'migrate') {
  const { close } = await buildApp({ dataDir, serveWeb: false });
  console.log('Database is up to date.');
  await close();
} else {
  console.log('Usage: cli.ts seed [--profile pilot|dev] | migrate');
  process.exit(command ? 1 : 0);
}
