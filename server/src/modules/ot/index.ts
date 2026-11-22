import type { ModuleContext, ModuleDef } from '../../core/module.ts';
import { seedOtLists, seedSharedValues } from './lists.ts';
import { registerRoutes } from './routes.ts';
import { seedOt } from './seed.ts';
import { guardZoneRefs, registerZones } from './zones.ts';

/**
 * OT and rail-systems security (E33). Operational technology attributes on systems and assets (the
 * fields are inventory's, `inventory/fields-ot.ts`), security zones and the conduits between them
 * with target and achieved levels, an overview, and a starter structure file for an OT control
 * catalog (`frameworks/starters/`). It shares the `systems` permissions; restricted zones need
 * `security.view`. Feature area `ot` (Administration > Features): while it is off, its routes answer
 * 404 and its record types and the OT fields are hidden everywhere.
 */

async function register(ctx: ModuleContext) {
  await seedSharedValues(ctx);
  registerZones(ctx);
  guardZoneRefs(ctx);
  registerRoutes(ctx);
}

const mod: ModuleDef = {
  key: 'ot',
  seedDefaults: seedOtLists,
  register,
  seed: seedOt,
};
export default mod;
