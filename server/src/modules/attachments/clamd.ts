// A client for the ClamAV daemon (clamd) over TCP, and the file scanner built on it.
//
// Protocol (clamd's own documentation): commands are sent as "z<COMMAND>\0" and answered with
// one line ending in "\0". INSTREAM is followed by the file in chunks, each a 4-byte big-endian
// length and that many bytes, and ends with a zero length. The answer is "stream: OK",
// "stream: <signature> FOUND" or "<reason> ERROR". VERSION answers
// "ClamAV <engine>/<signature version>/<signature date>".
//
// It is an outbound connection, off until an administrator switches scanning on (config.ts).
// Run clamd on the same machine (127.0.0.1) or a host you control: the file's bytes are sent to it.
import { connect, type Socket } from 'node:net';
import type { Readable } from 'node:stream';
import type { FileScanner, ScanResult } from './scanner.ts';

export interface ClamdConfig {
  host: string;
  port: number;
  /** Whole scan, connect to answer. */
  timeoutMs: number;
  /** Files larger than this are not sent (clamd's own StreamMaxLength should be at least this). */
  maxBytes: number;
}

const CHUNK = 64 * 1024;

export class ClamdUnavailable extends Error {}

/** Opens a connection, or fails with ClamdUnavailable. */
function open(cfg: ClamdConfig): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: cfg.host, port: cfg.port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new ClamdUnavailable(`no answer from ${cfg.host}:${cfg.port} within ${Math.round(cfg.timeoutMs / 1000)} seconds`));
    }, cfg.timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('error', (err) => { clearTimeout(timer); reject(new ClamdUnavailable(`cannot reach ${cfg.host}:${cfg.port} (${(err as NodeJS.ErrnoException).code ?? err.message})`)); });
  });
}

/** Collects the reply up to the terminating NUL (or the end of the connection). */
function reply(socket: Socket, cfg: ClamdConfig): Promise<string> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`the scanner did not answer within ${Math.round(cfg.timeoutMs / 1000)} seconds`)); }, cfg.timeoutMs);
    const done = () => {
      clearTimeout(timer);
      const text = Buffer.concat(parts).toString('utf8');
      const end = text.indexOf('\0');
      resolve((end >= 0 ? text.slice(0, end) : text).trim());
      socket.destroy();
    };
    socket.on('data', (d: Buffer) => {
      parts.push(d);
      if (d.includes(0)) done();
    });
    socket.once('end', done);
    socket.once('close', done);
    socket.once('error', (err) => {
      // clamd closes the connection when it refuses a stream; a reply may already be here.
      if (parts.length) done();
      else { clearTimeout(timer); reject(err); }
    });
  });
}

/** Sends one simple command (PING, VERSION) and returns the answer. */
export async function clamdCommand(cfg: ClamdConfig, command: 'PING' | 'VERSION'): Promise<string> {
  const socket = await open(cfg);
  const answer = reply(socket, cfg);
  socket.write(`z${command}\0`);
  return answer;
}

export interface ClamdVersion { engine: string; signatures: string | null; signatureDate: string | null; raw: string }

/** "ClamAV 1.3.1/27467/Mon Nov 17 09:23:45 2026" -> its parts. */
export function parseVersion(raw: string): ClamdVersion {
  const [engine, signatures, date] = raw.split('/');
  const parsed = date ? new Date(date.replace(/\s+/g, ' ')) : null;
  return {
    engine: engine?.trim() || raw,
    signatures: signatures?.trim() || null,
    signatureDate: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : date?.trim() || null,
    raw,
  };
}

/** Streams a file to clamd and reads its verdict. */
export async function clamdScan(cfg: ClamdConfig, source: Readable, size?: number): Promise<ScanResult> {
  if (size !== undefined && size > cfg.maxBytes) {
    source.destroy();
    return { verdict: 'error', detail: `larger than the scanning limit of ${Math.round(cfg.maxBytes / 1048576)} MB` };
  }
  let socket: Socket;
  try {
    socket = await open(cfg);
  } catch (err) {
    source.destroy();
    return { verdict: 'error', detail: `unavailable: ${(err as Error).message}` };
  }
  const answer = reply(socket, cfg);
  answer.catch(() => undefined); // read below
  const write = (data: Buffer) => new Promise<void>((resolve, reject) => {
    if (socket.destroyed) return reject(new Error('the scanner closed the connection'));
    socket.write(data, (err) => (err ? reject(err) : resolve()));
  });
  let sent = 0;
  try {
    await write(Buffer.from('zINSTREAM\0', 'latin1'));
    for await (const chunk of source) {
      let b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      while (b.length) {
        const part = b.subarray(0, CHUNK);
        b = b.subarray(part.length);
        sent += part.length;
        if (sent > cfg.maxBytes) {
          source.destroy();
          socket.destroy();
          return { verdict: 'error', detail: `larger than the scanning limit of ${Math.round(cfg.maxBytes / 1048576)} MB` };
        }
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length);
        await write(Buffer.concat([len, part]));
      }
    }
    await write(Buffer.alloc(4, 0));
  } catch {
    // clamd may stop reading and answer early (for example over its own size limit): use its answer.
  }
  let text: string;
  try {
    text = await answer;
  } catch (err) {
    return { verdict: 'error', detail: `no verdict: ${(err as Error).message}` };
  }
  const found = /^stream: (.+) FOUND$/.exec(text);
  if (found) return { verdict: 'infected', detail: found[1] };
  if (/^stream: OK$/.test(text)) return { verdict: 'clean' };
  return { verdict: 'error', detail: text ? `scanner said: ${text}` : 'the scanner closed the connection without a verdict' };
}

/** The scanner used for uploads when ClamAV scanning is switched on. */
export function clamdScanner(cfg: ClamdConfig): FileScanner {
  return {
    name: 'clamav',
    async scan(file) {
      return clamdScan(cfg, await file.open(), file.size);
    },
  };
}
