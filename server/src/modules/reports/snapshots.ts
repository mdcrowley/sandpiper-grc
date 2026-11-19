// Stored snapshots: a rendered document frozen at a moment in time, worked out with one person's
// permissions and readable by that person (and, for packs, by people who could see the same data).
// The bytes go to the attachments file store when that module is loaded, otherwise into the table.
import { Readable } from 'node:stream';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { mayView } from './spec.ts';

interface Store { driver: string; put(key: string, source: Readable): Promise<void>; get(key: string): Promise<Readable>; delete(key: string): Promise<void> }

export interface SnapshotInput {
  sourceType: 'report' | 'dashboard' | 'pack';
  sourceId: string;
  scheduleId?: string | null;
  title: string;
  format: 'html' | 'csv';
  forUser: SessionUser;
  content: string;
  recordTypes: string[];
  restricted: boolean;
}

type FileStore = { storage: Store; newKey: () => string } | null;
// One store per application: the in-memory driver (tests) keeps its files in the instance.
const stores = new WeakMap<object, FileStore>();

export function makeSnapshots(ctx: ModuleContext) {
  /** The attachments module's storage driver, when that module is part of this installation. */
  async function fileStore(): Promise<FileStore> {
    if (stores.has(ctx.app)) return stores.get(ctx.app)!;
    let store: FileStore = null;
    if (ctx.app.hasDecorator('fileScanner')) {
      try {
        const mod = await import('../attachments/storage.ts');
        const dir = ctx.dataDir === 'memory' || process.env.GRC_DATA_DIR === 'memory' ? 'memory' : ctx.dataDir;
        store = { storage: mod.openStorage(dir), newKey: mod.newStorageKey };
      } catch (err) {
        console.warn('[reports] file storage is not available; snapshots are kept in the database:', (err as Error).message);
      }
    }
    stores.set(ctx.app, store);
    return store;
  }

  async function save(input: SnapshotInput): Promise<string> {
    const s = await fileStore();
    let key: string | null = null;
    if (s) {
      key = s.newKey();
      try { await s.storage.put(key, Readable.from([Buffer.from(input.content, 'utf8')])); } catch (err) {
        console.warn('[reports] snapshot file could not be written; kept in the database instead:', (err as Error).message);
        key = null;
      }
    }
    const row = await ctx.db.one<{ id: string }>(
      `insert into report_snapshots (source_type, source_id, schedule_id, title, format, for_user_id, record_types, restricted, storage_driver, storage_key, content, size_bytes)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12) returning id`,
      [input.sourceType, input.sourceId, input.scheduleId ?? null, input.title.slice(0, 200), input.format, input.forUser.id,
        JSON.stringify(input.recordTypes), input.restricted, key ? s!.storage.driver : null, key, key ? null : input.content, Buffer.byteLength(input.content, 'utf8')],
    );
    return row!.id;
  }

  /**
   * A snapshot holds figures as one person was allowed to see them. Someone else may open it only
   * when it was made from a pack and they hold view permission on every record type in it (and
   * `security.view` when it holds restricted records).
   */
  function mayOpen(user: SessionUser, row: Row, packVisible: boolean): boolean {
    if (row.for_user_id === user.id) return true;
    if (row.source_type !== 'pack' || !packVisible) return false;
    if (row.restricted && !ctx.can(user, 'security.view')) return false;
    return (row.record_types as string[]).every((t) => { const def = ctx.resources.get(t); return Boolean(def && mayView(ctx, user, def)); });
  }

  const META = 'id, source_type, source_id, schedule_id, title, format, for_user_id, record_types, restricted, size_bytes, created_at';

  async function meta(id: string): Promise<Row | undefined> {
    return UUID_RE.test(String(id)) ? ctx.db.one<Row>(`select ${META} from report_snapshots where id = $1`, [id]) : undefined;
  }

  async function content(id: string): Promise<string> {
    const row = (await ctx.db.one<Row>('select storage_key, content from report_snapshots where id = $1', [id]))!;
    if (!row.storage_key) return row.content ?? '';
    const s = await fileStore();
    if (!s) throw new Error('Snapshot file store is not available');
    const chunks: Buffer[] = [];
    for await (const chunk of await s.storage.get(row.storage_key)) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
  }

  async function listFor(user: SessionUser, limit = 50): Promise<Row[]> {
    return ctx.db.query<Row>(`select ${META} from report_snapshots where for_user_id = $1 order by created_at desc limit ${Math.min(200, limit)}`, [user.id]);
  }
  async function listForSource(sourceType: string, sourceId: string): Promise<Row[]> {
    return ctx.db.query<Row>(`select ${META} from report_snapshots where source_type = $1 and source_id = $2 order by created_at desc limit 100`, [sourceType, sourceId]);
  }

  return { save, mayOpen, meta, content, listFor, listForSource, fileStore };
}

export type Snapshots = ReturnType<typeof makeSnapshots>;
