import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, renameSync, rmSync, statSync } from 'node:fs';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { format } from 'node:util';

// Server logging (E16-16): one JSON object per line, written to a log file that rotates by size,
// and to the console. Each request is one line with its request identifier (the X-Request-Id the
// server sends back, also recorded on audit events as request_id), so a complaint, an audit event
// and a log line can be matched. Nothing secret is logged: request lines carry the path without
// its query string, and every message passes through `redact`.
//
// Settings (environment):
//   GRC_LOG_LEVEL    error | warn | info (default) | debug
//   GRC_LOG_DIR      folder for grc.log (default <data>/logs); "off" writes no file
//   GRC_LOG_MAX_MB   size at which grc.log is rotated (default 10)
//   GRC_LOG_FILES    rotated files kept: grc.log.1 (newest) ... grc.log.N (default 5)
//   GRC_LOG_CONSOLE  text (default: start-up, warnings and errors as plain lines) | json (every
//                    entry as JSON; the container image uses this) | off
//   GRC_LOG_REQUESTS on (default) | off: one line per request

export const LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type Level = (typeof LEVELS)[number];

type Env = Record<string, string | undefined>;

export interface LogSettings {
  level: Level;
  /** Folder of grc.log, or null for no file. */
  dir: string | null;
  maxBytes: number;
  files: number;
  console: 'text' | 'json' | 'off';
  requests: boolean;
}

function positive(env: Env, name: string, fallback: number, min: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) throw new Error(`${name} must be a number of at least ${min} (got "${raw}").`);
  return n;
}

export function logSettings(dataDir: string, env: Env = process.env): LogSettings {
  const level = (env.GRC_LOG_LEVEL?.trim().toLowerCase() || 'info') as Level;
  if (!LEVELS.includes(level)) throw new Error(`GRC_LOG_LEVEL must be one of ${LEVELS.join(', ')} (got "${env.GRC_LOG_LEVEL}").`);
  const dirSetting = env.GRC_LOG_DIR?.trim();
  const dir = dirSetting && ['off', 'none', '0', 'false'].includes(dirSetting.toLowerCase()) ? null
    : dirSetting ? resolve(dirSetting) : dataDir === 'memory' ? null : join(dataDir, 'logs');
  const consoleMode = (env.GRC_LOG_CONSOLE?.trim().toLowerCase() || 'text') as LogSettings['console'];
  if (!['text', 'json', 'off'].includes(consoleMode)) throw new Error(`GRC_LOG_CONSOLE must be text, json or off (got "${env.GRC_LOG_CONSOLE}").`);
  return {
    level,
    dir,
    maxBytes: Math.round(positive(env, 'GRC_LOG_MAX_MB', 10, 0.01) * 1024 * 1024),
    files: Math.round(positive(env, 'GRC_LOG_FILES', 5, 1)),
    console: consoleMode,
    requests: !['off', '0', 'false', 'no'].includes(String(env.GRC_LOG_REQUESTS ?? '').trim().toLowerCase()),
  };
}

// ---------------------------------------------------------------------------------------------
// Redaction

/** Keys whose values are never logged, wherever they appear in an object. */
const SECRET_KEY = /pass(word|phrase)?|secret|token|authorization|cookie|csrf|totp|recovery|credential|api[-_]?key|private[-_]?key|signature|^code$|^otp$|^session(_?id)?$/i;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Path segments that are themselves secrets: the token of a link sent to someone outside. */
const SECRET_SEGMENT_AFTER = /(\/(?:api\/(?:v\d+\/)?)?vendor-response\/)[^/?#\s"']+/gi;

/**
 * A path or URL without its secrets: the segment after /vendor-response/ (API and web page), any
 * other segment of 32 or more letters, digits, "-" or "_" that is not a record id (a UUID), and
 * the values of a query string.
 */
export function redactPath(text: string): string {
  return text
    .replace(SECRET_SEGMENT_AFTER, '$1***')
    .replace(/(\/)([A-Za-z0-9_-]{32,})(?=[/?#\s"'),]|$)/g, (m, slash: string, seg: string) => (UUID.test(seg) ? m : `${slash}***`))
    .replace(/([?&][^=\s&#?/]+=)[^&\s#"']*/g, '$1***');
}

/** Replaces secrets inside free text: paths (above), bearer and personal access tokens, URL passwords, key=value pairs. */
export function redactText(text: string): string {
  return redactPath(text)
    .replace(/grc_(pat|ses|sid)_[A-Za-z0-9_-]+/g, 'grc_$1_***')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, '$1***@')
    .replace(/\b((?:pass(?:word|phrase)?|secret|token|api[-_]?key|code|otp)["']?\s*[=:]\s*["']?)[^\s"'&,;}]+/gi, '$1***');
}

/** A copy of `value` with secret keys masked and secrets in text removed (depth-limited). */
export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 5) return '[...]';
  if (value instanceof Error) return { name: value.name, message: redactText(value.message), stack: value.stack ? redactText(value.stack) : undefined };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) && v !== null && v !== undefined && v !== '' ? '***' : redact(v, depth + 1)]),
  );
}

// ---------------------------------------------------------------------------------------------
// Rotating file

/** A log file that rotates when it passes `maxBytes`: grc.log -> grc.log.1 -> ... -> grc.log.N (dropped). */
export class RotatingFile {
  readonly path: string;
  private size = 0;

  constructor(readonly dir: string, readonly maxBytes: number, readonly files: number, name = 'grc.log') {
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, name);
    this.size = existsSync(this.path) ? statSync(this.path).size : 0;
  }

  /** Moves the current file aside (the previous run's log survives a restart as grc.log.1). */
  rotate(): void {
    if (!existsSync(this.path) || statSync(this.path).size === 0) return;
    rmSync(`${this.path}.${this.files}`, { force: true });
    for (let i = this.files - 1; i >= 1; i--) {
      if (existsSync(`${this.path}.${i}`)) renameSync(`${this.path}.${i}`, `${this.path}.${i + 1}`);
    }
    renameSync(this.path, `${this.path}.1`);
    this.size = 0;
  }

  write(line: string): void {
    const bytes = Buffer.byteLength(line) + 1;
    if (this.size > 0 && this.size + bytes > this.maxBytes) this.rotate();
    appendFileSync(this.path, `${line}\n`);
    this.size += bytes;
  }

  /** The rotated files, newest first (for tests and the logs command). */
  rotated(): string[] {
    return readdirSync(this.dir).filter((f) => /^grc\.log\.\d+$/.test(f)).sort((a, b) => Number(a.split('.').pop()) - Number(b.split('.').pop()));
  }
}

// ---------------------------------------------------------------------------------------------
// Logger

export interface LogEntry {
  time: string;
  level: Level;
  msg: string;
  [field: string]: unknown;
}

export interface Logger {
  settings: LogSettings;
  file: RotatingFile | null;
  log(level: Level, msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
}

export interface ConsoleOut {
  out: (line: string) => void;
  err: (line: string) => void;
}

export function createLogger(settings: LogSettings, out: ConsoleOut, now: () => Date = () => new Date()): Logger {
  const file = settings.dir ? new RotatingFile(settings.dir, settings.maxBytes, settings.files) : null;
  file?.rotate(); // a new run starts a new file
  const rank = (l: Level) => LEVELS.indexOf(l);
  let fileFailed = false;
  const log = (level: Level, msg: string, fields: Record<string, unknown> = {}) => {
    if (rank(level) > rank(settings.level)) return;
    const { console: _toConsole, ...rest } = fields;
    const entry: LogEntry = { time: now().toISOString(), level, msg: redactText(msg), ...(redact(rest) as object) };
    const json = JSON.stringify(entry);
    if (file) {
      try {
        file.write(json);
      } catch (err) {
        if (!fileFailed) out.err(`Cannot write the log file ${file.path}: ${(err as Error).message}`);
        fileFailed = true;
      }
    }
    if (settings.console === 'json') (level === 'error' || level === 'warn' ? out.err : out.out)(json);
    else if (settings.console === 'text' && (fields.console === true || level === 'error' || level === 'warn')) {
      const extra = fields.error && typeof fields.error === 'object' ? `\n${(entry.error as { stack?: string; message?: string }).stack ?? (entry.error as { message?: string }).message}` : '';
      (level === 'error' || level === 'warn' ? out.err : out.out)(`${level === 'info' ? '' : `[${level}] `}${entry.msg}${extra}`);
    }
  };
  return {
    settings,
    file,
    log,
    error: (m, f) => log('error', m, f),
    warn: (m, f) => log('warn', m, f),
    info: (m, f) => log('info', m, f),
    debug: (m, f) => log('debug', m, f),
  };
}

/**
 * Sends console.log/info/warn/error/debug through the logger, so messages written anywhere in the
 * server (modules use the console) are leveled, redacted and rotated with the rest. Returns a
 * function that puts the console back.
 */
export function captureConsole(logger: Logger): () => void {
  const original = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  const send = (level: Level) => (...args: unknown[]) => {
    const error = args.find((a): a is Error => a instanceof Error);
    const text = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : format('%o', a))).join(' ');
    logger.log(level, text, error ? { error } : {});
  };
  console.log = send('info');
  console.info = send('info');
  console.warn = send('warn');
  console.error = send('error');
  console.debug = send('debug');
  return () => Object.assign(console, original);
}

/**
 * One log line per request, at the moment the answer is finished: method, path (never the query
 * string, which can hold search words or one-time codes), status, duration, client address and the
 * request identifier. A 5xx answer is logged as an error, everything else as info (a refused
 * password is not a server problem). Attached to the plain Node server, so it sees every
 * request whatever the routes do.
 */
export function logRequests(server: Server, logger: Logger, clientIp: (req: IncomingMessage) => string | undefined = (req) => req.socket.remoteAddress): void {
  if (!logger.settings.requests) return;
  // First in line, so it is in place before the application answers.
  server.prependListener('request', (req: IncomingMessage, res: ServerResponse) => {
    const started = process.hrtime.bigint();
    // The web framework passes its headers straight to writeHead, where getHeader cannot see them.
    let reqId: unknown = undefined;
    const writeHead = res.writeHead;
    res.writeHead = function (this: ServerResponse, ...args: unknown[]) {
      const headers = args.find((a): a is Record<string, unknown> => !!a && typeof a === 'object' && !Array.isArray(a));
      if (headers) reqId = headers['x-request-id'] ?? headers['X-Request-Id'];
      return (writeHead as (...a: unknown[]) => ServerResponse).apply(this, args);
    } as typeof res.writeHead;
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const path = redactPath((req.url ?? '').split('?')[0]);
      // Static files of the web application are not worth a line each, unless they fail.
      // Nor is every health check of a monitor or container runtime.
      const quiet = (!path.startsWith('/api/') && path !== '/mcp') || ['/api/health', '/api/v1/health', '/api/ready', '/api/v1/ready'].includes(path);
      if (res.statusCode < 400 && quiet && logger.settings.level !== 'debug') return;
      reqId ??= res.getHeader('x-request-id');
      logger.log(res.statusCode >= 500 ? 'error' : 'info', 'request', {
        reqId: reqId === undefined ? undefined : String(reqId),
        method: req.method,
        path,
        status: res.statusCode,
        ms: Math.round(ms * 10) / 10,
        ip: clientIp(req),
      });
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Reading the log (the `logs` command)

const FIXED = new Set(['time', 'level', 'msg']);

/** One JSON log line as a readable line: local-looking time, level, message, then the other fields. */
export function formatLogLine(line: string): string {
  let e: LogEntry;
  try {
    e = JSON.parse(line);
  } catch {
    return line;
  }
  if (e.msg === 'request') {
    return `${e.time}  ${String(e.status ?? '').padEnd(5)}${String(e.method ?? '').padEnd(7)}${e.path ?? ''}  ${e.ms ?? '?'} ms  ${e.ip ?? ''}${e.reqId ? `  id ${e.reqId}` : ''}`;
  }
  const extra = Object.entries(e).filter(([k]) => !FIXED.has(k))
    .map(([k, v]) => (k === 'error' && v && typeof v === 'object' ? `\n    ${(v as { stack?: string; message?: string }).stack ?? (v as { message?: string }).message}` : ` ${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`))
    .join('');
  return `${e.time}  ${e.level.toUpperCase().padEnd(6)}${e.msg}${extra}`;
}

/** The last `count` lines of a file (reads only its end). */
export function lastLines(path: string, count: number): string[] {
  if (!existsSync(path)) return [];
  const size = statSync(path).size;
  const want = Math.min(size, Math.max(64 * 1024, count * 600));
  const buf = Buffer.alloc(want);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, buf, 0, want, size - want);
  } finally {
    closeSync(fd);
  }
  const lines = buf.toString('utf8').split('\n').filter((l) => l.trim());
  if (want < size) lines.shift(); // probably cut in half
  return lines.slice(-count);
}

/** Keeps printing what is appended to the log, following it across a rotation. */
export function followLog(path: string, print: (line: string) => void, intervalMs = 1000): () => void {
  let pos = existsSync(path) ? statSync(path).size : 0;
  let rest = '';
  const timer = setInterval(() => {
    if (!existsSync(path)) return;
    const size = statSync(path).size;
    if (size < pos) pos = 0; // rotated
    if (size === pos) return;
    const buf = Buffer.alloc(size - pos);
    const fd = openSync(path, 'r');
    try {
      readSync(fd, buf, 0, buf.length, pos);
    } finally {
      closeSync(fd);
    }
    pos = size;
    const parts = (rest + buf.toString('utf8')).split('\n');
    rest = parts.pop() ?? '';
    for (const l of parts) if (l.trim()) print(l);
  }, intervalMs);
  return () => clearInterval(timer);
}
