import type { ModuleDef } from '../../core/module.ts';
import { registerCalendarFeeds } from './calendar.ts';
import { defineFeedSources } from './sources.ts';
import { seedFeeds } from './seed.ts';
import { registerTrackerWithJobs } from './tracker.ts';

/**
 * Calendar feeds and the work-tracker bridge (E36-03, E36-06). Not a feature area: each connection is off
 * until an administrator switches it on (`feeds.calendar_enabled`; a work-tracker connection's own switch
 * plus `integrations.outbound_enabled`). Calendar feeds read the calendar source registry
 * (core/calendar.ts); this module also defines the sources of the modules built before wave 11
 * (sources.ts). Evidence by link (E36-05) lives in the attachments module.
 */
const mod: ModuleDef = {
  key: 'feeds',
  async register(ctx) {
    defineFeedSources(ctx.app);
    registerCalendarFeeds(ctx);
    await registerTrackerWithJobs(ctx);
  },
  async seed(ctx, opts) {
    return (await seedFeeds(ctx, opts)) ?? undefined;
  },
};
export default mod;
