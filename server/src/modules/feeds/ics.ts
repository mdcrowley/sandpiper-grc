// A small iCalendar (RFC 5545) writer for calendar feeds: VCALENDAR with VEVENTs, text escaped and
// lines folded at 75 octets. Hand-written, so no package is needed.

export interface IcsEvent {
  uid: string;
  title: string;
  /** `YYYY-MM-DD` with allDay, or an ISO date and time. */
  start: string;
  end?: string;
  allDay: boolean;
  url?: string;
  description?: string;
}

/** Escapes a TEXT value: backslash, semicolon, comma and line breaks. */
export function escapeText(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds a content line at 75 octets, continuing with CRLF and a space (never inside a character). */
export function fold(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    const limit = parts.length ? 74 : 75; // continuation lines start with a space
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const compactDate = (d: string) => d.slice(0, 10).replace(/-/g, '');

/** A date-time in UTC: 20261121T150000Z. */
export function utcStamp(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function nextDay(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function writeCalendar(opts: { name: string; prodId: string; events: IcsEvent[]; now?: Date }): string {
  const stamp = utcStamp(opts.now ?? new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${escapeText(opts.prodId)}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.name)}`,
    // Ask calendar programs to look again every hour.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const e of opts.events) {
    lines.push('BEGIN:VEVENT', `UID:${escapeText(e.uid)}`, `DTSTAMP:${stamp}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(e.start)}`);
      const end = e.end && e.end.slice(0, 10) > e.start.slice(0, 10) ? e.end.slice(0, 10) : e.start;
      lines.push(`DTEND;VALUE=DATE:${compactDate(nextDay(end))}`);
      lines.push('TRANSP:TRANSPARENT');
    } else {
      lines.push(`DTSTART:${utcStamp(e.start)}`);
      if (e.end && new Date(e.end).getTime() > new Date(e.start).getTime()) lines.push(`DTEND:${utcStamp(e.end)}`);
    }
    lines.push(`SUMMARY:${escapeText(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
