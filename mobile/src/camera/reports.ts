// Sending reports and their photos (E38-06): a small queue kept on the phone, so a report and its
// photos survive a lost connection or the app being closed. Each report is created once, then each
// photo is uploaded whole to it; a photo that fails is sent again later (the server has no partial
// uploads, so "resume" means the photo is re-sent from the start, never the report re-created).
//
// Creating a record safely before the server honors Idempotency-Key (E38-10, wave 15):
//  - the record's id is stored the moment the create succeeds, and photos go to that id;
//  - before creating, the app checks the server can be reached, so a report written without signal
//    just waits and is sent later on its own;
//  - if the connection breaks during the create itself (or a gateway answers 502/503/504), the app
//    cannot know whether the record was made: the report waits as "Not sure it arrived" until the
//    person checks and chooses Send again or Discard. Only that choice can make a second record.
//  - the Idempotency-Key header (the report's own id) is sent anyway, so it takes effect with E38-10.
// A photo whose upload reached the server but whose answer was lost is uploaded again (two copies).
// Signing out deletes the queue and its photos (after the warning about unsent work).
import { ApiError, CLIENT_ERRORS } from '../api/client';

export type ReportKind = 'problem' | 'hazard';
export type ReportState = 'waiting' | 'sending' | 'uncertain' | 'refused' | 'done';

export interface QueuedPhoto {
  /** The fitted JPEG kept in the queue's folder. */
  file: string;
  name: string;
  state: 'pending' | 'sent' | 'refused';
  attempts: number;
  error: string | null;
}

export interface QueuedReport {
  /** The report's own id (also its Idempotency-Key). */
  id: string;
  kind: ReportKind;
  /** Where it is created (POST), and the type of the record it creates. */
  path: string;
  recordType: string;
  body: Record<string, unknown>;
  title: string;
  /** A record to link the new one to after creating it (a tag card's prefill.link: POST /api/links). */
  link?: { type: string; id: string } | null;
  linked?: boolean;
  created: { id: string; ref: string | null } | null;
  state: ReportState;
  error: string | null;
  fields: Record<string, string>;
  photos: QueuedPhoto[];
  queuedAt: string;
}

/** Where the queue is kept (files in the app's private documents folder). */
export interface ReportStore {
  load(): Promise<QueuedReport[]>;
  save(reports: QueuedReport[]): Promise<void>;
  /** Copies a photo into the report's folder; returns the copy's uri. */
  keep(reportId: string, uri: string, name: string): Promise<string>;
  /** Removes a report's folder (its photos). */
  drop(reportId: string): Promise<void>;
  /** Removes everything. */
  wipe(): Promise<void>;
}

/** How reports reach the server. */
export interface ReportTransport {
  reachable(): Promise<boolean>;
  create(path: string, body: Record<string, unknown>, idempotencyKey: string): Promise<{ id: string; ref?: string | null }>;
  upload(recordType: string, recordId: string, file: string, name: string): Promise<void>;
  /** Links the new record to another (safe to repeat: the server keeps one link). */
  link(fromType: string, fromId: string, to: { type: string; id: string }): Promise<void>;
}

/** Messages people see. */
export const REPORT_TEXT = {
  uncertain: 'The connection was lost while sending, so the app cannot tell whether this report arrived. Check My work or the web, then send it again or discard it.',
  waiting: 'Waiting for a connection. It is sent on its own.',
  photoRetry: 'Not sent yet. It is sent again on its own.',
};

const isGateway = (s: number) => s === 502 || s === 503 || s === 504;

export class ReportQueue {
  private reports: QueuedReport[] = [];
  private loaded: Promise<void> | null = null;
  private running: Promise<void> | null = null;
  private listeners = new Set<(reports: QueuedReport[]) => void>();

  constructor(private store: ReportStore, private transport: ReportTransport) {}

  private async ready(): Promise<void> {
    this.loaded ??= this.store.load().then((r) => { this.reports = r; });
    return this.loaded;
  }

  private async commit(): Promise<void> {
    await this.store.save(this.reports);
    const copy = this.reports.map((r) => ({ ...r, photos: r.photos.map((p) => ({ ...p })) }));
    for (const l of this.listeners) l(copy);
  }

  subscribe(fn: (reports: QueuedReport[]) => void): () => void {
    this.listeners.add(fn);
    void this.ready().then(() => fn(this.reports.map((r) => ({ ...r }))));
    return () => this.listeners.delete(fn);
  }

  async list(): Promise<QueuedReport[]> {
    await this.ready();
    return this.reports.map((r) => ({ ...r, photos: r.photos.map((p) => ({ ...p })) }));
  }

  /** Reports not fully sent (for the sign-out warning). */
  async unsent(): Promise<number> {
    await this.ready();
    return this.reports.filter((r) => r.state !== 'done').length;
  }

  /** Queues a report with its (already fitted) photos, then starts sending. */
  async add(report: Omit<QueuedReport, 'created' | 'state' | 'error' | 'fields' | 'photos' | 'queuedAt'>, photos: { uri: string; name: string }[], now = new Date()): Promise<QueuedReport> {
    await this.ready();
    const kept: QueuedPhoto[] = [];
    for (const p of photos) kept.push({ file: await this.store.keep(report.id, p.uri, p.name), name: p.name, state: 'pending', attempts: 0, error: null });
    const queued: QueuedReport = { ...report, created: null, state: 'waiting', error: null, fields: {}, photos: kept, queuedAt: now.toISOString() };
    this.reports.push(queued);
    await this.commit();
    return queued;
  }

  /** Sends what can be sent; one run at a time. Resolves when this run is over. */
  process(): Promise<void> {
    this.running ??= this.run().finally(() => { this.running = null; });
    return this.running;
  }

  private async run(): Promise<void> {
    await this.ready();
    for (const r of [...this.reports]) {
      if (r.state === 'uncertain' || r.state === 'refused' || r.state === 'done') continue;
      if (!r.created) {
        if (!(await this.transport.reachable())) { r.state = 'waiting'; r.error = REPORT_TEXT.waiting; await this.commit(); return; }
        r.state = 'sending'; r.error = null;
        await this.commit();
        try {
          const made = await this.transport.create(r.path, r.body, r.id);
          r.created = { id: made.id, ref: made.ref ?? null };
          r.state = 'waiting';
          await this.commit();
        } catch (e) {
          const err = e instanceof ApiError ? e : new ApiError(0, CLIENT_ERRORS.offline, String((e as Error)?.message ?? e));
          if (err.status === 0 && err.code === CLIENT_ERRORS.notConnected) { r.state = 'waiting'; r.error = err.message; }
          else if (err.status === 0 || isGateway(err.status)) { r.state = 'uncertain'; r.error = REPORT_TEXT.uncertain; }
          else if (err.status >= 500) { r.state = 'waiting'; r.error = err.message; }
          else { r.state = 'refused'; r.error = err.message; r.fields = err.fields; }
          await this.commit();
          continue;
        }
      }
      if (r.link && !r.linked) {
        try {
          await this.transport.link(r.recordType, r.created!.id, r.link);
          r.linked = true;
          await this.commit();
        } catch {
          // Tried again on the next run; the report itself is made.
        }
      }
      for (const p of r.photos.filter((x) => x.state === 'pending')) {
        try {
          await this.transport.upload(r.recordType, r.created!.id, p.file, p.name);
          p.state = 'sent'; p.error = null;
        } catch (e) {
          p.attempts++;
          const err = e instanceof ApiError ? e : null;
          if (err && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 408 && err.status !== 429) { p.state = 'refused'; p.error = err.message; }
          else p.error = REPORT_TEXT.photoRetry;
        }
        await this.commit();
      }
      if (r.photos.every((p) => p.state !== 'pending') && (!r.link || r.linked)) {
        r.state = 'done';
        await this.commit();
        if (r.photos.every((p) => p.state === 'sent')) await this.forget(r.id);
      }
    }
  }

  /** After "Not sure it arrived" or a refusal the person fixed: send the report again. */
  async sendAgain(id: string, body?: Record<string, unknown>): Promise<void> {
    await this.ready();
    const r = this.reports.find((x) => x.id === id);
    if (!r || r.created) return;
    if (body) r.body = body;
    r.state = 'waiting'; r.error = null; r.fields = {};
    await this.commit();
    await this.process();
  }

  /** Removes a report from the phone (and its photos). */
  async forget(id: string): Promise<void> {
    await this.ready();
    this.reports = this.reports.filter((x) => x.id !== id);
    await this.store.drop(id);
    await this.commit();
  }

  async wipe(): Promise<void> {
    this.reports = [];
    this.loaded = Promise.resolve();
    await this.store.wipe();
    for (const l of this.listeners) l([]);
  }
}
