// The mobile app's server side (wave 13, E38; area `mobile`, off by default). See docs/mobile.md and
// the user guide page "The mobile app".
//
// - signin.ts: the `mobile` OAuth client kind (built in, client_id com.sandpipergrc), its sign-in
//   page's API, and the app's access tokens on every /api route as the person.
// - devices.ts: Account > Devices and the administrator's devices card.
// - home.ts: GET /api/mobile/home (My work in one call).
// - settings.ts: GET /api/mobile/hello (public), GET /api/mobile/settings, Administration > Mobile app.
// - package.ts: GET /api/mobile/package (the offline package; parts added with definePackagePart).
// - sync.ts: POST /api/mobile/sync and PUT /api/mobile/sync/attachment (the outbox, each item at most
//   once; kinds added with defineSyncKind). Wave 14, E38-10.
// - fieldwork.ts: inspections, condition assessments and inventory counts offline: their sync kinds
//   and package parts. Wave 15, E38-11 and E38-12.
//
// While the area is off every /api/mobile route answers 404 `switched_off` (module folder `mobile`),
// the OAuth client does not exist, tokens are refused, and every device signed in before the switch
// stays signed out when the area is switched on again.
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleDef } from '../../core/module.ts';
import { registerDevices } from './devices.ts';
import { registerFieldwork } from './fieldwork.ts';
import { registerHome } from './home.ts';
import { registerAppSettings } from './settings.ts';
import { registerPackage } from './package.ts';
import { registerSignIn } from './signin.ts';
import { callAs, registerSync } from './sync.ts';
import { settleDisabled, settleSwitchedOff } from './state.ts';

const DAY = 24 * 60 * 60_000;

const mod: ModuleDef = {
  key: 'mobile',
  async register(ctx) {
    const signIn = registerSignIn(ctx);
    registerDevices(ctx);
    registerHome(ctx);
    registerAppSettings(ctx);
    const sync = registerSync(ctx);
    registerPackage(ctx, (req) => callAs(ctx.app, req));
    registerFieldwork(ctx);
    // Daily (skipped while the area is off, like every mobile.* job): lapsed codes and tokens go,
    // outbox answers older than 7 days go, and devices that signed in before the area was last
    // switched off are marked signed out.
    await scheduleWork(ctx, 'mobile.cleanup', async () => {
      await signIn.cleanup();
      const syncAnswers = await sync.cleanup();
      return { signedOut: (await settleSwitchedOff(ctx.db)) + (await settleDisabled(ctx.db)), syncAnswers };
    }, { every: DAY, firstRunInMs: 15 * 60_000 });
  },
};
export default mod;
