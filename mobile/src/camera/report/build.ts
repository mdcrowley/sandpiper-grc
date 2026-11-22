// What a report sends (E38-06): pure, so it is tested without screens. A report started from a tag
// card uses the server's prefill (where to post, the record type, the values that link the record,
// and `link`: a record to link the new one to afterward); one started from scratch posts a ticket or a
// safety event with the person's answers. People who report through the self-service portal get the
// portal's forms (`/api/portal/requests`, `/api/portal/safety-reports`), which take plainer fields.
import type { ReportStart } from '../../tags/handoff';

export interface ReportAnswers {
  title: string;
  description: string;
  site: { id: string; label: string } | null;
  locationDetail: string;
  /** Hazards: lookup values. */
  eventType: string | null;
  severity: string | null;
  /** ISO time it happened (hazards). */
  occurredAt: string;
  /** Portal problem reports: who is affected and how urgent (the portal's own choices). */
  affects?: string | null;
  howUrgent?: string | null;
  /** Portal safety reports: how bad it was. */
  harm?: string | null;
}

export interface ReportRequest {
  path: string;
  recordType: string;
  body: Record<string, unknown>;
  link: { type: string; id: string } | null;
}

/** Where a ticket or safety event is created from scratch. */
export const DEFAULT_TARGET = {
  problem: { path: '/api/tickets', type: 'ticket' },
  hazard: { path: '/api/safety-events', type: 'safety_event' },
} as const;

/** The portal's own choices (server/src/modules/portal/words.ts and safety/portal-intake.ts). */
export const PORTAL_AFFECTS = [
  { id: 'me', label: 'Just me' },
  { id: 'team', label: 'My team, depot or station' },
  { id: 'service', label: 'Passengers, safety or the whole service' },
];
export const PORTAL_URGENCY = [
  { id: 'stopped', label: 'I cannot work at all' },
  { id: 'slowed', label: 'I can work, but it slows me down' },
  { id: 'can_wait', label: 'It can wait' },
];

type Prefill = NonNullable<ReportStart['prefill']> & { link?: { type: string; id: string } | null };

export const isPortal = (start: ReportStart | null) => Boolean(start?.prefill?.path.startsWith('/api/portal/'));

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** The form's starting values from a tag card's prefill (the person can change them). */
export function initialAnswers(start: ReportStart | null): Pick<ReportAnswers, 'title' | 'description' | 'locationDetail' | 'eventType' | 'severity'> & { site: ReportAnswers['site'] } {
  const v = start?.prefill?.values ?? {};
  const siteId = str(v.site_id) || start?.record?.siteId || null;
  return {
    title: str(v.title),
    description: str(v.description),
    locationDetail: str(v.location_detail) || str(v.where),
    eventType: str(v.event_type) || null,
    severity: str(v.severity) || null,
    site: siteId ? { id: siteId, label: start?.record?.siteId === siteId ? start?.record?.siteLabel ?? '' : '' } : null,
  };
}

function place(a: ReportAnswers): string {
  return [a.site?.label, a.locationDetail.trim()].filter(Boolean).join(', ');
}

export function buildReport(kind: 'problem' | 'hazard', a: ReportAnswers, start: ReportStart | null): ReportRequest {
  const prefill = (start?.prefill ?? null) as Prefill | null;
  const target = prefill ? { path: prefill.path, type: prefill.type } : DEFAULT_TARGET[kind];
  const link = prefill?.link ?? null;
  const title = a.title.trim();
  const description = a.description.trim();

  if (isPortal(start)) {
    const where = place(a).slice(0, 200) || str(prefill?.values.where);
    const body: Record<string, unknown> = kind === 'problem'
      ? { title, details: description, where, affects: a.affects ?? 'me', how_urgent: a.howUrgent ?? 'slowed' }
      : { title, description, event_type: a.eventType, harm: a.harm ?? 'none', occurred_at: a.occurredAt, where };
    return { path: target.path, recordType: target.type, body, link: null };
  }

  const body: Record<string, unknown> = { ...(prefill?.values ?? {}), title };
  if (kind === 'problem') {
    // Tickets have no site field: the place goes into the text.
    const where = place(a);
    const lines = [description];
    if (where && !description.includes(where)) lines.push(`Location: ${where}`);
    if (start?.record && !prefill && !description.includes(start.record.label)) lines.push(`Reported from the tag of ${start.record.label}.`);
    body.description = lines.filter(Boolean).join('\n\n');
    // Without the server's prefill, link the record the report started from when a ticket can hold it.
    if (!prefill && start?.record && (start.record.type === 'asset' || start.record.type === 'system')) body[`${start.record.type}_id`] = start.record.id;
  } else {
    body.description = description;
    body.occurred_at = a.occurredAt;
    if (a.eventType) body.event_type = a.eventType;
    if (a.severity) body.severity = a.severity;
    if (a.site) body.site_id = a.site.id; else delete body.site_id;
    if (a.locationDetail.trim()) body.location_detail = a.locationDetail.trim(); else delete body.location_detail;
    if (!prefill && start?.record?.type === 'vehicle') body.vehicle_id = start.record.id;
    if (!prefill && start?.record?.type === 'site' && !a.site) body.site_id = start.record.id;
  }
  return { path: target.path, recordType: target.type, body, link };
}

/** The first value of a list that is in `preferred`, else the first value. */
export function pickDefault(values: string[], preferred: string[]): string | null {
  return preferred.find((p) => values.includes(p)) ?? values[0] ?? null;
}
