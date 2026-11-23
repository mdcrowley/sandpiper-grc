// Reports go through the outbox (E38-06, E38-10): saving a report, the Report tab's view of what is
// on its way, and moving reports left by the wave 13 report queue (reports/queue.json) into the outbox.
import { Directory, File, Paths } from 'expo-file-system';
import { outbox, sendNow, useOutbox } from '../offline';
import { reportItems, reportViews, type ReportToSave, type ReportView } from './reports';

/** Saves a report and its (already fitted) photos in the outbox, then starts sending. */
export async function saveReport(report: ReportToSave, photos: { uri: string; name: string }[], id?: string): Promise<void> {
  await outbox().add(reportItems(report, photos, id));
  sendNow();
}

/** The reports in the outbox, for the Report tab. */
export function useReports(): ReportView[] {
  return reportViews(useOutbox());
}

// ---------- the wave 13 report queue ----------

interface LegacyReport {
  id: string; kind: 'problem' | 'hazard'; path: string; recordType: string; body: Record<string, unknown>; title: string;
  link?: { type: string; id: string } | null; created: { id: string; ref: string | null } | null; state: string;
  photos: { file: string; name: string; state: string }[];
}

/**
 * Moves reports the wave 13 queue did not finish into the outbox, with their ids (the server answers
 * a repeat from memory from now on), and removes the old folder. A report already made keeps its
 * record: only its photos are moved, addressed to that record.
 */
export async function migrateLegacyQueue(): Promise<number> {
  const dir = new Directory(Paths.document, 'reports');
  if (!dir.exists) return 0;
  let moved = 0;
  const f = new File(dir, 'queue.json');
  const old = f.exists ? (JSON.parse(await f.text()) as LegacyReport[]) : [];
  for (const r of Array.isArray(old) ? old : []) {
    const photos = r.photos.filter((p) => p.state === 'pending' && new File(p.file).exists).map((p) => ({ uri: p.file, name: p.name }));
    if (r.created) {
      if (!photos.length) continue;
      await outbox().add(photos.map((p, n) => ({
        kind: 'attachment', label: `Photo ${n + 1} of ${r.title}`, file: p,
        payload: { name: p.name, recordType: r.recordType, recordId: r.created!.id },
      })));
    } else if (r.state !== 'done') {
      await outbox().add(reportItems({ kind: r.kind, path: r.path, recordType: r.recordType, body: r.body, title: r.title, link: r.link ?? null }, photos, r.id));
    }
    moved++;
  }
  // Only once everything is in the outbox (a failure leaves the old queue for the next start).
  dir.delete();
  return moved;
}
