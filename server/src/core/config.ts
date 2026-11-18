/** Installation-wide defaults. Nothing here is specific to one organisation. */

/** Shown until an administrator sets a name under Administration > Settings. */
export const DEFAULT_APP_NAME = 'GRC Platform';

/** ISO 4217 code used to display money fields. Set GRC_CURRENCY to change it. */
export const CURRENCY: string = (process.env.GRC_CURRENCY || 'USD').toUpperCase();

export { TIME_ZONE, todayInZone } from './timezone.ts';
