// Searching inside attached files (E41-16). A background job reads the text of PDF, Word (.docx) and
// plain-text files into `attachment_texts` (migration 005), with a search vector; the global search
// (core/search-global.ts) finds a record by that text under the record's own visibility rules, as
// it does by its comments and file names. Nothing here decides who may see what: a file's text is
// only ever reached through its record.
//
// Limits: a file larger than TEXT_MAX_BYTES is not read; each file is read in a worker thread with
// its own memory limit that is ended after TEXT_TIME_LIMIT_MS; at most TEXT_MAX_CHARS characters
// (and TEXT_MAX_PAGES pages of a PDF) are kept. Reading never runs macros or outside programs
// (text-worker.mjs).
import { Worker } from 'node:worker_threads';
import { ensureJobs, scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { SEARCH_CONFIG } from '../../core/search.ts';

export const TEXT_JOB = 'attachments.text_index';
/** The file types whose text is read. */
export const TEXT_EXTENSIONS = ['pdf', 'docx', 'txt', 'md', 'log', 'csv'];
export const TEXT_MAX_BYTES = 25 * 1024 * 1024;
export const TEXT_TIME_LIMIT_MS = 30_000;
export const TEXT_MAX_CHARS = 300_000;
export const TEXT_MAX_PAGES = 2_000;
/** A .docx whose text parts unpack beyond this is read only as far as it fits (zip bombs). */
const MAX_UNPACKED = 100 * 1024 * 1024;
const BATCH = 25;
const HOUR = 3_600_000;

export type TextResult = { ok: true; text: string } | { ok: false; error: string; unavailable?: boolean };

/** Reads the text of one file's bytes in a worker thread, ended after the time limit. */
export function extractText(bytes: Buffer, extension: string, opts: { timeoutMs?: number; maxChars?: number } = {}): Promise<TextResult> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: TextResult) => { if (!settled) { settled = true; resolve(r); } };
    let worker: Worker;
    try {
      worker = new Worker(new URL('./text-worker.mjs', import.meta.url), {
        workerData: {
          bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), extension,
          maxChars: opts.maxChars ?? TEXT_MAX_CHARS, maxPages: TEXT_MAX_PAGES, maxUnpacked: MAX_UNPACKED,
        },
        resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 64, stackSizeMb: 8 },
        stdout: true, stderr: true, // pdf.js warnings about damaged files stay out of the log
      });
    } catch (err) {
      done({ ok: false, error: `could not start the reader: ${(err as Error).message}` });
      return;
    }
    const timer = setTimeout(() => {
      done({ ok: false, error: `took longer than ${Math.round((opts.timeoutMs ?? TEXT_TIME_LIMIT_MS) / 1000)} seconds` });
      void worker.terminate();
    }, opts.timeoutMs ?? TEXT_TIME_LIMIT_MS);
    worker.once('message', (m: TextResult) => { clearTimeout(timer); done(m); void worker.terminate(); });
    worker.once('error', (err: Error) => { clearTimeout(timer); done({ ok: false, error: /memory/i.test(err.message) ? 'needed too much memory' : err.message.slice(0, 300) }); });
    worker.once('exit', (code) => { clearTimeout(timer); done({ ok: false, error: `the reader stopped (${code})` }); });
  });
}

/** Reads a stored file into memory, refusing one larger than `max` bytes. */
async function readStored(ctx: ModuleContext, att: Row, max: number): Promise<Buffer | null> {
  const storage = ctx.app.attachmentStores.forDriver(att.storage_driver);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of await storage.get(att.storage_key)) {
    size += (chunk as Buffer).length;
    if (size > max) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function store(ctx: ModuleContext, id: string, status: string, detail: string | null, text: string | null) {
  const sql = (content: string | null) => ctx.db.query(
    `insert into attachment_texts (attachment_id, status, detail, chars, content, vector)
     select $1, $2, $3, $4, $5::text,
       case when $5::text is null then null else to_tsvector('${SEARCH_CONFIG}', $5::text) || to_tsvector('simple', $5::text) end
     where exists (select 1 from attachments where id = $1 and deleted_at is null)
     on conflict (attachment_id) do update set status = excluded.status, detail = excluded.detail, chars = excluded.chars,
       content = excluded.content, vector = excluded.vector, extracted_at = now()`,
    [id, status, detail, content?.length ?? 0, content]);
  try {
    await sql(text);
  } catch {
    // A text whose search vector would be too large keeps its first part.
    await sql(text ? text.slice(0, 50_000) : null);
  }
}

/** Types whose reader library is missing from this installation (until the next start): left waiting. */
const unavailable = new Set<string>();
const readable = () => TEXT_EXTENSIONS.filter((e) => !unavailable.has(e));

/** Reads the text of the next files that have not been looked at yet. */
export async function indexFileTexts(ctx: ModuleContext, limit = BATCH, opts: { timeoutMs?: number } = {}) {
  const files = await ctx.db.query<Row>(
    `select a.id, a.extension, a.size_bytes, a.storage_driver, a.storage_key from attachments a
     where a.deleted_at is null and a.storage_driver <> 'link' and a.extension = any($1::text[])
       and not exists (select 1 from attachment_texts x where x.attachment_id = a.id)
     order by a.created_at desc limit $2`, [readable(), limit]);
  const sum = { read: 0, indexed: 0, empty: 0, skipped: 0, failed: 0, waiting: 0 };
  for (const att of files) {
    sum.read += 1;
    if (Number(att.size_bytes) > TEXT_MAX_BYTES) {
      await store(ctx, att.id, 'skipped', `larger than ${TEXT_MAX_BYTES / 1024 / 1024} MB`, null);
      sum.skipped += 1;
      continue;
    }
    let bytes: Buffer | null;
    try {
      bytes = await readStored(ctx, att, TEXT_MAX_BYTES);
    } catch (err) {
      // Missing from its store, or the store cannot be reached: recorded, so the queue moves on
      // (the integrity check reports missing files; a file put back is read again).
      await store(ctx, att.id, 'failed', `could not be read from storage: ${(err as Error).message}`.slice(0, 300), null);
      sum.failed += 1;
      continue;
    }
    if (!bytes) { await store(ctx, att.id, 'skipped', `larger than ${TEXT_MAX_BYTES / 1024 / 1024} MB`, null); sum.skipped += 1; continue; }
    const r = await extractText(bytes, att.extension, opts);
    if (!r.ok && r.unavailable) {
      // The reader library is missing from this installation: nothing is recorded, so the file is
      // read once it is there, and files of other types go on being read meanwhile.
      unavailable.add(att.extension);
      console.warn(`[attachments] text of .${att.extension} files not read: ${r.error}`);
      sum.waiting += 1;
      continue;
    }
    if (!r.ok) {
      await store(ctx, att.id, 'failed', r.error, null);
      sum.failed += 1;
    } else if (!r.text) {
      await store(ctx, att.id, 'empty', null, null);
      sum.empty += 1;
    } else {
      await store(ctx, att.id, 'indexed', null, r.text);
      sum.indexed += 1;
    }
  }
  const remaining = (await ctx.db.one<{ n: number }>(
    `select count(*)::int as n from attachments a where a.deleted_at is null and a.storage_driver <> 'link' and a.extension = any($1::text[])
       and not exists (select 1 from attachment_texts x where x.attachment_id = a.id)`, [readable()]))?.n ?? 0;
  return { ...sum, remaining };
}

/** Asks for the files waiting to be read now (after an upload); one run at a time. */
export async function queueFileTexts(ctx: ModuleContext): Promise<void> {
  if (!ctx.app.hasDecorator('jobs')) return;
  await ctx.app.jobs.enqueue(TEXT_JOB, {}, { key: TEXT_JOB, rerunIfRunning: true });
}

export async function registerFileText(ctx: ModuleContext) {
  await ensureJobs(ctx);
  // Hourly, and after every upload: the files not read yet, a batch at a time. Existing files are
  // read by the same runs, newest first; a run that leaves more queues the next one.
  await scheduleWork(ctx, TEXT_JOB, async () => {
    const r = await indexFileTexts(ctx);
    if (r.remaining > 0 && r.read > r.waiting) await ctx.app.jobs.enqueue(TEXT_JOB, {}, { key: `${TEXT_JOB}:more`, delayMs: 5_000 });
    return r;
  }, { every: HOUR, firstRunInMs: 180_000, leaseSeconds: 1800 });
}
