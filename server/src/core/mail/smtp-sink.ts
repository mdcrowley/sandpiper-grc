// A tiny SMTP server for tests: listens on a free port on 127.0.0.1, accepts messages and
// keeps them in memory. Plain connections only (no STARTTLS), optional AUTH PLAIN / LOGIN,
// and it can be told to refuse the next few messages to exercise retries.
import { createServer, type Server, type Socket } from 'node:net';

export interface SunkMessage {
  from: string;
  to: string[];
  raw: string;
  /** Decoded Subject header. */
  subject: string;
  /** The raw message with quoted-printable decoded: good enough to search for text. */
  body: string;
  /** User name that signed in, if any. */
  user: string | null;
}

export interface SmtpSink {
  port: number;
  messages: SunkMessage[];
  /** Refuse the next `count` messages with this reply code (default 451, "try later"). */
  refuseNext(count: number, code?: number, text?: string): void;
  /** Resolves when at least `count` messages have arrived (or rejects after `ms`). */
  waitFor(count: number, ms?: number): Promise<SunkMessage[]>;
  close(): Promise<void>;
}

export function decodeQuotedPrintable(s: string): string {
  const bytes: number[] = [];
  const text = s.replace(/=\r?\n/g, '');
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '=' && /^[0-9A-F]{2}$/i.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      for (const b of Buffer.from(text[i], 'utf8')) bytes.push(b);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([QBqb])\?([^?]*)\?=\s*/g, (_m, _cs, enc: string, data: string) =>
    enc.toUpperCase() === 'B' ? Buffer.from(data, 'base64').toString('utf8') : decodeQuotedPrintable(data.replace(/_/g, ' ')));
}

function headerOf(raw: string, name: string): string {
  const head = raw.split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, ' ');
  const line = head.split(/\r?\n/).find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return line ? decodeWords(line.slice(name.length + 1).trim()) : '';
}

/** Decodes base64 body parts too, so tests can search the text of any part. */
function readableBody(raw: string): string {
  const qp = decodeQuotedPrintable(raw);
  const b64 = [...raw.matchAll(/Content-Transfer-Encoding: base64\r?\n(?:[^\r\n]+\r?\n)*\r?\n([A-Za-z0-9+/=\r\n]+)/g)]
    .map((m) => Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf8'));
  return [qp, ...b64].join('\n');
}

export async function startSmtpSink(opts: { auth?: { user: string; pass: string } } = {}): Promise<SmtpSink> {
  const messages: SunkMessage[] = [];
  let refuse = 0;
  let refuseCode = 451;
  let refuseText = '';
  const waiters: (() => void)[] = [];
  const sockets = new Set<Socket>();

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    let buffer = '';
    let mode: 'command' | 'data' | 'auth-plain' | 'auth-user' | 'auth-pass' = 'command';
    let from = '';
    let to: string[] = [];
    let data: string[] = [];
    let user: string | null = null;
    let pendingUser = '';
    const send = (line: string) => { if (!socket.destroyed) socket.write(`${line}\r\n`); };
    const checkPlain = (b64: string) => {
      const [, u, p] = Buffer.from(b64, 'base64').toString('utf8').split('\u0000');
      return opts.auth && u === opts.auth.user && p === opts.auth.pass ? u : null;
    };
    const authResult = (u: string | null) => {
      mode = 'command';
      if (u) { user = u; send('235 2.7.0 Authentication successful'); } else send('535 5.7.8 Authentication credentials invalid');
    };

    const handle = (line: string) => {
      if (mode === 'data') {
        if (line === '.') {
          mode = 'command';
          const raw = data.join('\r\n');
          if (refuse > 0) {
            refuse -= 1;
            send(`${refuseCode} ${refuseText || (refuseCode >= 500 ? '5.7.1 Refused' : '4.3.0 Try again later')}`);
          } else {
            messages.push({ from, to, raw, subject: headerOf(raw, 'Subject'), body: readableBody(raw), user });
            send('250 2.0.0 Ok: queued');
            for (const w of waiters.splice(0)) w();
          }
          from = ''; to = []; data = [];
        } else data.push(line.startsWith('..') ? line.slice(1) : line);
        return;
      }
      if (mode === 'auth-plain') return authResult(checkPlain(line));
      if (mode === 'auth-user') { pendingUser = Buffer.from(line, 'base64').toString('utf8'); mode = 'auth-pass'; send(`334 ${Buffer.from('Password:').toString('base64')}`); return; }
      if (mode === 'auth-pass') {
        const pass = Buffer.from(line, 'base64').toString('utf8');
        return authResult(opts.auth && pendingUser === opts.auth.user && pass === opts.auth.pass ? pendingUser : null);
      }
      const [verb, ...rest] = line.split(' ');
      const arg = rest.join(' ');
      switch (verb.toUpperCase()) {
        case 'EHLO':
          send('250-sink.test');
          if (opts.auth) send('250-AUTH PLAIN LOGIN');
          send('250 8BITMIME');
          return;
        case 'HELO': return send('250 sink.test');
        case 'AUTH': {
          const [method, initial] = arg.split(' ');
          if (!opts.auth) return send('503 5.5.1 Authentication not enabled');
          if (method?.toUpperCase() === 'PLAIN') {
            if (initial) return authResult(checkPlain(initial));
            mode = 'auth-plain';
            return send('334 ');
          }
          if (method?.toUpperCase() === 'LOGIN') { mode = 'auth-user'; return send(`334 ${Buffer.from('Username:').toString('base64')}`); }
          return send('504 5.5.4 Unrecognized authentication type');
        }
        case 'MAIL':
          if (opts.auth && !user) return send('530 5.7.0 Authentication required');
          from = /<([^>]*)>/.exec(arg)?.[1] ?? '';
          return send('250 2.1.0 Ok');
        case 'RCPT':
          to.push(/<([^>]*)>/.exec(arg)?.[1] ?? '');
          return send('250 2.1.5 Ok');
        case 'DATA':
          mode = 'data';
          return send('354 End data with <CR><LF>.<CR><LF>');
        case 'RSET': from = ''; to = []; data = []; return send('250 2.0.0 Ok');
        case 'NOOP': return send('250 2.0.0 Ok');
        case 'QUIT': send('221 2.0.0 Bye'); socket.end(); return;
        default: return send('502 5.5.2 Command not recognized');
      }
    };

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        handle(line);
      }
    });
    socket.on('error', () => undefined);
    send('220 sink.test ESMTP ready');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  return {
    port,
    messages,
    refuseNext(count, code = 451, text = '') { refuse = count; refuseCode = code; refuseText = text; },
    waitFor(count, ms = 5000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Only ${messages.length} of ${count} message(s) arrived`)), ms);
        const check = () => {
          if (messages.length >= count) { clearTimeout(timer); resolve(messages); } else waiters.push(check);
        };
        check();
      });
    },
    close() {
      for (const s of sockets) s.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
