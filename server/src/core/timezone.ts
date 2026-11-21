/**
 * The organization's time zone: business hours, "today" and due dates are worked out in it.
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

/** Today's calendar date (YYYY-MM-DD) in the organization's time zone. */
export function todayInZone(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(at);
}

/**
 * The calendar date (YYYY-MM-DD) `offsetDays` days from today, in the organization's time zone.
 * Use this, never `new Date().getDate()` or `toISOString().slice(0, 10)`: those give the
 * machine's or UTC's date, which differs from the organization's for part of every day.
 */
export function dayInZone(offsetDays = 0, at: Date = new Date()): string {
  const base = Date.parse(`${todayInZone(at)}T00:00:00Z`);
  return new Date(base + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Oct 2, 2030" for a 'YYYY-MM-DD' date, as the web app writes dates: for text people read
 * (notification titles and bodies, emails, audit summaries), never the ISO form (BW-08).
 */
export function displayDate(date: string): string {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  return MONTHS[m - 1] && d ? `${MONTHS[m - 1]} ${d}, ${y}` : String(date);
}
