import type { ModuleContext, ModuleDef } from '../../core/module.ts';
import { registerCounts, seedCountDefaults } from './counts.ts';
import { registerHistory } from './history.ts';
import { registerLookup } from './lookup.ts';
import { registerPrint } from './print.ts';
import { seedTagSamples } from './counts-seed.ts';
import { registerStore } from './store.ts';

/**
 * Asset tags (wave 13, E37; feature area `tags`, permission module `tags`): tag values on assets,
 * vehicles, sites and systems (the taggable registry, core/asset-tags.ts), formats, stock and series,
 * attach, replace and end, lookup and the tag card, printing, inventory counts and the lookup log.
 * Spec: docs/roadmap/specs/asset-tags-and-mobile-apps.md. Contracts: shared/asset-tags-api.ts and
 * shared/tag-format.ts.
 *
 * Each part is registered from its own file, so the parts are built side by side:
 *  - store.ts (+ any other file not named below): formats, stock, series, assignments, settings;
 *  - lookup*.ts, actions*.ts: lookup and the tag card;
 *  - print*.ts: printing;
 *  - counts*.ts: inventory counts;
 *  - history*.ts: the lookup log and "Last seen".
 */

async function seedDefaults(ctx: ModuleContext) {
  await seedCountDefaults(ctx);
}

async function register(ctx: ModuleContext) {
  await registerStore(ctx);
  await registerHistory(ctx);
  await registerLookup(ctx);
  await registerPrint(ctx);
  await registerCounts(ctx);
}

const mod: ModuleDef = { key: 'tags', seedDefaults, register, seed: (ctx, opts) => seedTagSamples(ctx, opts) };
export default mod;
