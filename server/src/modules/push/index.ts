// Push notifications on the phone (E38-14; part of the Mobile app area, off by default). See
// docs/mobile.md ("Push notifications") and the user guide page "The mobile app".
//
// - Services: Apple's push service (apns.ts), Firebase Cloud Messaging HTTP v1 (fcm.ts) and
//   UnifiedPush through Web Push (webpush.ts), each with the organization's own credentials, set
//   under Administration > Push notifications (config.ts, routes.ts). No Expo push service, no relay.
// - A push says only "You have N new notifications" (shared/push-api.ts pushMessageText).
// - Delivery (deliver.ts): the notifications module calls app.pushNotify(userIds) after it adds to
//   someone's list; that queues `push.deliver` a few seconds later (bursts become one push), and the
//   sweep `push.sweep` every five minutes catches anything else. Each person is claimed before sending.
// - While the Mobile app area is off, every route here answers 404 `switched_off` and every push.* job
//   is skipped (core/features.ts), and pushNotify does nothing.
import { scheduleWork, ensureJobs } from '../../core/jobs/index.ts';
import type { ModuleDef } from '../../core/module.ts';
import { deliverPending, pushPossible } from './deliver.ts';
import { registerPushRoutes } from './routes.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** Present when the push module is loaded: guard with `app.hasDecorator('pushNotify')`. Never throws. */
    pushNotify(userIds: string[]): Promise<void>;
  }
}

/** How long the hook waits before delivering, so a burst of notifications becomes one push. */
export const DELIVER_DELAY_MS = 5_000;

const mod: ModuleDef = {
  key: 'push',
  async register(ctx) {
    const { app, db } = ctx;
    const jobs = await ensureJobs(ctx);
    registerPushRoutes(ctx);

    jobs.register('push.deliver', async () => deliverPending(ctx), { maxAttempts: 3 });
    await scheduleWork(ctx, 'push.sweep', () => deliverPending(ctx), { every: 5 * 60_000, firstRunInMs: 60_000 });

    if (!app.hasDecorator('pushNotify')) {
      app.decorate('pushNotify', async (userIds: string[]) => {
        try {
          const ids = [...new Set(userIds)].filter(Boolean);
          if (!ids.length || !(await pushPossible(ctx))) return;
          const any = await db.one('select 1 from push_registrations where user_id = any($1::uuid[]) limit 1', [ids]);
          if (!any) return;
          // One waiting job at a time (same key): it delivers to everyone who is due. A delivery
          // already running may have read who is due before this notification, so it runs once more.
          await jobs.enqueue('push.deliver', {}, { key: 'push.deliver', delayMs: DELIVER_DELAY_MS, rerunIfRunning: true });
        } catch (err) {
          console.error('[push] could not queue a delivery:', err);
        }
      });
    }
  },
};
export default mod;
