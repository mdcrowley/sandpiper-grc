// Runs one board book job (reading or appending the PDF papers of a meeting) in a separate process
// (book-reader.mjs, book-worker.mjs), killed after a time limit and ending itself past a memory cap,
// so whatever a paper does to the PDF library, the server process is not affected. Never parse an
// uploaded PDF inside the server process.
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BOOK_TIME_LIMIT_MS = 120_000;
export const BOOK_MAX_MEMORY_MB = 1024;
/** Pages of a whole board book, appended papers included. */
export const BOOK_MAX_PAGES = 3_000;
/** The PDF papers appended to one book, together. */
export const BOOK_MAX_APPENDED_BYTES = 150 * 1024 * 1024;

export type BookResult<T> = { ok: true; result: T } | { ok: false; error: string; code: string | null; stopped?: boolean };

function run<T>(task: 'inspect' | 'merge', payload: Record<string, unknown>, opts: { timeoutMs?: number; maxMemoryMb?: number } = {}): Promise<BookResult<T>> {
  return new Promise((resolve) => {
    let settled = false;
    let child: ChildProcess | undefined;
    const limitMs = opts.timeoutMs ?? BOOK_TIME_LIMIT_MS;
    const done = (r: BookResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, error: `took longer than ${Math.round(limitMs / 1000)} seconds`, code: 'time', stopped: true }), limitMs);
    try {
      child = fork(fileURLToPath(new URL('./book-reader.mjs', import.meta.url)), [], {
        execArgv: ['--max-old-space-size=256'],
        serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
      });
    } catch (err) {
      done({ ok: false, error: `could not start the book maker: ${(err as Error).message}`.slice(0, 300), code: 'unavailable' });
      return;
    }
    child.once('message', (m) => done(m as BookResult<T>));
    child.once('error', (err) => done({ ok: false, error: `could not start the book maker: ${err.message}`.slice(0, 300), code: 'unavailable' }));
    child.once('exit', (code, signal) => done({ ok: false, error: `the book maker stopped (${signal ?? code})`, code: 'stopped', stopped: true }));
    child.send({ task, maxMemoryMb: opts.maxMemoryMb ?? BOOK_MAX_MEMORY_MB, payload },
      (err) => { if (err) done({ ok: false, error: `could not start the book maker: ${err.message}`.slice(0, 300), code: 'unavailable' }); });
  });
}

const bytesOf = (b: Buffer) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

/** One PDF paper: its pages and whether its structure is merged into the book (tagged; else why not), or why it cannot be appended. */
export type Inspected = { ok: true; pages: number; tagged: boolean; untagged?: string } | { ok: false; code: string; error: string };

/** Pages of each PDF and whether its tags are merged, or why it cannot be appended (encrypted, unreadable, too large). */
export async function inspectPdfs(files: Buffer[]): Promise<Inspected[]> {
  if (!files.length) return [];
  const r = await run<Inspected[]>('inspect', { files: files.map(bytesOf), maxPages: BOOK_MAX_PAGES });
  if (!r.ok) return files.map(() => ({ ok: false as const, code: r.code ?? 'failed', error: r.error }));
  return r.result;
}

/**
 * The book with the files' pages appended: a tagged paper's structure merged under a Part element named
 * by its title (E45-61), an untagged paper's drawing marked as artifacts. Throws when it cannot be made.
 */
export async function appendPdfs(book: Buffer, files: Buffer[], titles: string[] = []): Promise<Buffer> {
  if (!files.length) return book;
  const r = await run<{ bytes: Uint8Array; pages: number; tagged: boolean[] }>('merge', { book: bytesOf(book), files: files.map(bytesOf), titles, maxPages: BOOK_MAX_PAGES });
  if (!r.ok) throw new Error(`The papers could not be appended to the book (${r.error}).`);
  return Buffer.from(r.result.bytes.buffer, r.result.bytes.byteOffset, r.result.bytes.byteLength);
}
