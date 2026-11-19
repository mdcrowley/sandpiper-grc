// A small POP3 client (RFC 1939, STLS from RFC 2595) on node:net and node:tls, for reading a
// service desk mailbox (E15-06). No dependency.
//
//   const box = await Pop3.connect({ host, port: 995, tls: 'tls', username, password });
//   for (const m of await box.list()) { const raw = await box.retrieve(m.number); ...; await box.delete(m.number); }
//   await box.quit();   // deletions take effect only on a clean QUIT
//
// TLS checks the server's certificate as usual. `tls: 'none'` sends the password in clear text
// and is meant for a mail relay on the same machine or for tests.
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';

export type Pop3Tls = 'tls' | 'starttls' | 'none';

export interface Pop3Options {
  host: string;
  port: number;
  tls: Pop3Tls;
  username: string;
  password: string;
  /** Milliseconds to wait for any one answer (default 20 s). */
  timeoutMs?: number;
}

export interface Pop3Message { number: number; size: number; uid: string }

export class Pop3Error extends Error {
  constructor(message: string, readonly retryable = true) { super(message); }
}

const MAX_LINE = 64 * 1024;

export class Pop3 {
  private buffer = Buffer.alloc(0);
  private waiting: (() => void) | null = null;
  private failure: Error | null = null;

  private constructor(private socket: Socket | TLSSocket, private timeoutMs: number) {
    this.attach(socket);
  }

  private attach(socket: Socket | TLSSocket) {
    this.socket = socket;
    socket.on('data', (chunk: Buffer) => { this.buffer = Buffer.concat([this.buffer, chunk]); this.wake(); });
    socket.on('error', (err) => { this.failure = err; this.wake(); });
    socket.on('close', () => { this.failure ??= new Pop3Error('The mail server closed the connection.'); this.wake(); });
  }

  private wake() {
    const w = this.waiting;
    this.waiting = null;
    w?.();
  }

  private async until<T>(take: () => T | undefined): Promise<T> {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      const got = take();
      if (got !== undefined) return got;
      if (this.failure) throw this.failure;
      const left = deadline - Date.now();
      if (left <= 0) throw new Pop3Error('The mail server did not answer in time.');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiting = () => { clearTimeout(timer); resolve(); };
      });
    }
  }

  /** One status line: "+OK ..." resolves with the text, "-ERR ..." throws. */
  private async status(): Promise<string> {
    const line = await this.until(() => {
      const i = this.buffer.indexOf('\r\n');
      if (i < 0) {
        if (this.buffer.length > MAX_LINE) throw new Pop3Error('The mail server sent a line that is too long.', false);
        return undefined;
      }
      const l = this.buffer.subarray(0, i).toString('utf8');
      this.buffer = this.buffer.subarray(i + 2);
      return l;
    });
    if (line.startsWith('+OK')) return line.slice(3).trim();
    throw new Pop3Error(`The mail server answered: ${line.replace(/^-ERR\s*/, '').slice(0, 200) || 'error'}`, !/auth|password|login|user/i.test(line));
  }

  /** The body of a multi-line answer, up to the line holding a single dot, with dot-stuffing undone. */
  private async multiline(maxBytes = 64 * 1024 * 1024): Promise<Buffer> {
    const raw = await this.until(() => {
      const end = this.buffer.indexOf('\r\n.\r\n');
      const empty = this.buffer.subarray(0, 3).toString('latin1') === '.\r\n';
      if (empty) { this.buffer = this.buffer.subarray(3); return Buffer.alloc(0); }
      if (end < 0) {
        if (this.buffer.length > maxBytes) throw new Pop3Error('The message is larger than the limit.', false);
        return undefined;
      }
      const body = this.buffer.subarray(0, end + 2);
      this.buffer = this.buffer.subarray(end + 5);
      return body;
    });
    // Lines starting with "." had another "." added by the server.
    return Buffer.from(raw.toString('latin1').replace(/(^|\r\n)\.\./g, '$1.'), 'latin1');
  }

  private send(command: string): void {
    if (/[\r\n]/.test(command)) throw new Pop3Error('Invalid characters in a mail command.', false);
    this.socket.write(`${command}\r\n`);
  }

  private async command(command: string): Promise<string> {
    this.send(command);
    return this.status();
  }

  static async connect(opts: Pop3Options): Promise<Pop3> {
    const timeoutMs = opts.timeoutMs ?? 20_000;
    const socket = opts.tls === 'tls'
      ? tlsConnect({ host: opts.host, port: opts.port, servername: opts.host })
      : netConnect({ host: opts.host, port: opts.port });
    socket.setTimeout(timeoutMs * 2, () => socket.destroy(new Pop3Error('The connection to the mail server timed out.')));
    const box = new Pop3(socket, timeoutMs);
    try {
      await box.status(); // greeting
      if (opts.tls === 'starttls') {
        await box.command('STLS');
        box.socket.removeAllListeners('data');
        const secure = tlsConnect({ socket: box.socket as Socket, servername: opts.host });
        await new Promise<void>((resolve, reject) => { secure.once('secureConnect', resolve); secure.once('error', reject); });
        box.buffer = Buffer.alloc(0);
        box.attach(secure);
      }
      await box.command(`USER ${opts.username}`);
      await box.command(`PASS ${opts.password}`);
      return box;
    } catch (err) {
      box.close();
      throw err instanceof Pop3Error ? err : new Pop3Error(`Could not reach the mail server: ${(err as Error).message}`);
    }
  }

  /** Messages in the mailbox with their sizes and unique ids (UIDL; the number when the server has none). */
  async list(): Promise<Pop3Message[]> {
    await this.command('LIST');
    const sizes = new Map<number, number>();
    for (const line of (await this.multiline()).toString('latin1').split('\r\n')) {
      const [n, size] = line.trim().split(/\s+/);
      if (n && /^\d+$/.test(n)) sizes.set(Number(n), Number(size) || 0);
    }
    const uids = new Map<number, string>();
    try {
      await this.command('UIDL');
      for (const line of (await this.multiline()).toString('latin1').split('\r\n')) {
        const [n, uid] = line.trim().split(/\s+/);
        if (n && uid && /^\d+$/.test(n)) uids.set(Number(n), uid.slice(0, 200));
      }
    } catch (err) {
      if (this.failure) throw err;
    }
    return [...sizes.entries()].sort((a, b) => a[0] - b[0]).map(([number, size]) => ({ number, size, uid: uids.get(number) ?? `n:${number}:${size}` }));
  }

  async retrieve(number: number, maxBytes?: number): Promise<Buffer> {
    await this.command(`RETR ${Math.trunc(number)}`);
    return this.multiline(maxBytes);
  }

  async delete(number: number): Promise<void> {
    await this.command(`DELE ${Math.trunc(number)}`);
  }

  /** Ends the session; the server applies deletions now. */
  async quit(): Promise<void> {
    try { await this.command('QUIT'); } finally { this.close(); }
  }

  close(): void {
    this.socket.destroy();
  }
}
