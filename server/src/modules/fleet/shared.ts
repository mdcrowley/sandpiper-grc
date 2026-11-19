import type { ModuleContext } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';

/** Whether a vehicle status means the vehicle has left the fleet (`meta.retired` on the lookup value). */
export async function isRetired(ctx: ModuleContext, status: unknown): Promise<boolean> {
  if (!status) return false;
  return (await ctx.lookups.values('vehicle_status')).some((v) => v.value === status && v.meta?.retired === true);
}

/** Today's date in the organisation's time zone, as YYYY-MM-DD. */
export const todayIso = () => dayInZone();
