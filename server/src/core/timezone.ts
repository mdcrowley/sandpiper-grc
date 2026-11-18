/**
 * The organisation's time zone: business hours, "today" and due dates are worked out in it.
 * Set GRC_TIMEZONE to an IANA name (for example Europe/London); the default is the zone of
 * the machine the server runs on.
 */
export const TIME_ZONE: string = (() => {
  const zone = process.env.GRC_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    throw new Error(`GRC_TIMEZONE "${zone}" is not a known time zone.`);
  }
})();

/** Today's calendar date (YYYY-MM-DD) in the organisation's time zone. */
export function todayInZone(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(at);
}
