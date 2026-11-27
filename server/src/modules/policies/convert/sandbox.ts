// Runs one document job (Word conversion or PDF stamping) in a separate process (sandbox-reader.mjs,
// sandbox-worker.mjs), killed after a time limit and ending itself past a memory cap, so whatever a
// file does to the libraries, the server process is not affected. Never parse an untrusted Word file
// or PDF inside the server process.
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SANDBOX_TIME_LIMIT_MS = 60_000;
export const SANDBOX_MAX_MEMORY_MB = 1024;
/** A .docx whose parts would unpack beyond this is refused before anything is unpacked (zip bombs). */
export const SANDBOX_MAX_UNPACKED = 200 * 1024 * 1024;

export type SandboxResult<T> = { ok: true; result: T } | { ok: false; error: string; code: string | null; stopped?: boolean };

export function runSandboxed<T>(task: 'docx' | 'stamp', bytes: Buffer, extra: Record<string, unknown> = {}, opts: { timeoutMs?: number; maxMemoryMb?: number } = {}): Promise<SandboxResult<T>> {
  return new Promise((resolve) => {
    let settled = false;
    let child: ChildProcess | undefined;
    const limitMs = opts.timeoutMs ?? SANDBOX_TIME_LIMIT_MS;
    const done = (r: SandboxResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      resolve(r);
    };
    const timer = setTimeout(() => done({ ok: false, error: `took longer than ${Math.round(limitMs / 1000)} seconds`, code: 'time', stopped: true }), limitMs);
    try {
      child = fork(fileURLToPath(new URL('./sandbox-reader.mjs', import.meta.url)), [], {
        execArgv: ['--max-old-space-size=256'],
        serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
      });
    } catch (err) {
      done({ ok: false, error: `could not start the converter: ${(err as Error).message}`.slice(0, 300), code: 'unavailable' });
      return;
    }
    child.once('message', (m) => done(m as SandboxResult<T>));
    child.once('error', (err) => done({ ok: false, error: `could not start the converter: ${err.message}`.slice(0, 300), code: 'unavailable' }));
    child.once('exit', (code, signal) => done({ ok: false, error: `the converter stopped (${signal ?? code})`, code: 'stopped', stopped: true }));
    child.send({
      task, maxMemoryMb: opts.maxMemoryMb ?? SANDBOX_MAX_MEMORY_MB,
      payload: { ...extra, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) },
    }, (err) => { if (err) done({ ok: false, error: `could not start the converter: ${err.message}`.slice(0, 300), code: 'unavailable' }); });
  });
}
