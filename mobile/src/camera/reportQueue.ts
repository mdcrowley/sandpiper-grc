// The phone's report queue (./reports.ts) with its files in the app's private documents folder, the
// server as transport, and the hooks that wipe it on sign-out and count it for the sign-out warning.
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { ApiError, apiFetch } from '../api/client';
import { onWipe, registerUnsentWork } from '../auth/session';
import { uploadPhoto } from './photos';
import { ReportQueue, type QueuedReport, type ReportStore, type ReportTransport } from './reports';

const folder = () => new Directory(Paths.document, 'reports');
const queueFile = () => new File(folder(), 'queue.json');

export const fileStore: ReportStore = {
  async load() {
    try {
      const f = queueFile();
      if (!f.exists) return [];
      const parsed = JSON.parse(await f.text()) as QueuedReport[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },
  async save(reports) {
    const dir = folder();
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const f = queueFile();
    if (!f.exists) f.create();
    await f.write(JSON.stringify(reports));
  },
  async keep(reportId, uri, name) {
    const dir = new Directory(folder(), reportId);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const target = new File(dir, name);
    await new File(uri).copy(target);
    return target.uri;
  },
  async drop(reportId) {
    const dir = new Directory(folder(), reportId);
    if (dir.exists) dir.delete();
  },
  async wipe() {
    const dir = folder();
    if (dir.exists) dir.delete();
  },
};

export const serverTransport: ReportTransport = {
  async reachable() {
    try {
      await apiFetch('/api/version');
      return true;
    } catch {
      return false;
    }
  },
  async create(path, body, idempotencyKey) {
    const row = await apiFetch<{ id: string; ref?: string | null }>(path, { method: 'POST', body, idempotencyKey });
    return { id: row.id, ref: row.ref ?? null };
  },
  async upload(recordType, recordId, file, name) {
    // A photo that is no longer on the phone cannot be sent again: it is listed as not accepted.
    if (!new File(file).exists) throw new ApiError(410, 'file_missing', 'This photo is no longer on the phone.');
    await uploadPhoto(recordType, recordId, file, name);
  },
  async link(fromType, fromId, to) {
    await apiFetch('/api/links', { method: 'POST', body: { from_type: fromType, from_id: fromId, to_type: to.type, to_id: to.id } });
  },
};

let queue: ReportQueue | null = null;

/** The one queue of the app (created on first use, with its sign-out hooks). */
export function reportQueue(): ReportQueue {
  if (!queue) {
    const q = new ReportQueue(fileStore, serverTransport);
    onWipe(() => q.wipe());
    registerUnsentWork(() => q.unsent());
    queue = q;
  }
  return queue;
}

const RETRY_MS = 30_000;

/** The queue's reports for a screen; keeps sending while the app is open and something waits. */
export function useReportQueue(): QueuedReport[] {
  const [reports, setReports] = useState<QueuedReport[]>([]);
  useEffect(() => {
    const q = reportQueue();
    const off = q.subscribe(setReports);
    void q.process();
    const timer = setInterval(() => void q.process(), RETRY_MS);
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') void q.process(); });
    return () => { off(); clearInterval(timer); app.remove(); };
  }, []);
  return reports;
}
