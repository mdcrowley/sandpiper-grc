// Reports in the outbox (E38-06 through E38-10): a report is one `record.create` item followed by one
// `attachment` item per photo, which waits for the report. Saved on the phone first, so a report
// written without signal is sent on its own when the connection comes back; each item has its own id,
// which the server remembers, so a report or a photo sent twice (a lost connection, a retry, the app
// closed mid-way) arrives once. A refusal stays under Needs attention with the server's reason.
// Pure: what to save, and how the Report tab shows it.
import type { NewOutboxItem } from '../offline/outbox';
import type { OutboxError, OutboxItem } from '../offline/types';

export type ReportKind = 'problem' | 'hazard';

export interface ReportToSave {
  kind: ReportKind;
  /** Where it is created and the type of the record it creates. */
  path: string;
  recordType: string;
  body: Record<string, unknown>;
  title: string;
  /** A record to link the new one to (a tag card's prefill.link). */
  link?: { type: string; id: string } | null;
}

/** The outbox items of one report: the report first, then its photos (each waiting for the report). */
export function reportItems(r: ReportToSave, photos: { uri: string; name: string }[], id?: string): NewOutboxItem[] {
  return [
    {
      id, kind: 'record.create', label: r.title,
      payload: { path: r.path, recordType: r.recordType, body: r.body, link: r.link ?? null, reportKind: r.kind },
    },
    ...photos.map((p, n): NewOutboxItem => ({
      kind: 'attachment', label: `Photo ${n + 1}`, dependsOn: 0, file: { uri: p.uri, name: p.name },
      payload: { name: p.name },
    })),
  ];
}

export type ReportState = 'waiting' | 'sending' | 'attention' | 'done';

export interface ReportView {
  group: string;
  title: string;
  kind: ReportKind;
  state: ReportState;
  /** The new record's reference once it arrived (TKT-00042). */
  ref: string | null;
  photos: number;
  photosSent: number;
  /** Why it waits (no connection), or the server's reason (Needs attention). */
  error: OutboxError | null;
  warning: string | null;
  savedAt: string;
}

/** Messages people see. */
export const REPORT_TEXT = {
  waiting: 'Saved on this phone. It is sent on its own when there is a connection.',
  sending: 'Sending…',
  sent: 'Arrived',
  attention: 'Needs attention',
  photos: (sent: number, all: number) => `${sent} of ${all} photo${all === 1 ? '' : 's'} sent`,
};

/** The reports in the outbox, newest first. */
export function reportViews(items: OutboxItem[]): ReportView[] {
  const groups = new Map<string, OutboxItem[]>();
  for (const i of items) groups.set(i.group, [...(groups.get(i.group) ?? []), i]);
  const out: ReportView[] = [];
  for (const [group, all] of groups) {
    const report = all.find((i) => i.kind === 'record.create');
    if (!report || !report.payload.reportKind) continue;
    const photos = all.filter((i) => i.kind === 'attachment');
    const rejected = all.find((i) => i.state === 'rejected');
    const state: ReportState = rejected ? 'attention'
      : all.some((i) => i.state === 'sending') ? 'sending'
        : all.every((i) => i.state === 'done') ? 'done' : 'waiting';
    out.push({
      group, title: report.label, kind: report.payload.reportKind as ReportKind, state,
      ref: report.result?.ref ?? null, photos: photos.length, photosSent: photos.filter((p) => p.state === 'done').length,
      error: rejected?.error ?? (state === 'waiting' ? all.find((i) => i.state === 'pending' && i.error)?.error ?? null : null),
      warning: report.result?.warning ?? null, savedAt: report.createdAt,
    });
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
