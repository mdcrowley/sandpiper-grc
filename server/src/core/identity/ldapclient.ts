// A minimal LDAP v3 client (RFC 4511) for directory sign-in (E02-26): simple bind, search,
// StartTLS (RFC 4513 section 3) and unbind. Nothing else is needed to check a directory password
// and read a person's entry and groups, so nothing else is implemented.
//
// Why not a package: the protocol subset is small, the same BER code serves the stand-in directory
// used by the tests, and a hand-written client keeps the security rules in one place:
//
// - Encrypted only: ldaps:// (TLS from the first byte) or ldap:// with StartTLS before anything else
//   is sent. Plain LDAP is refused, except to this machine's loopback address (for tests).
// - The server certificate is checked (host name and chain). With a pinned CA certificate, only that
//   CA (or that very certificate) is trusted; otherwise the system and built-in trust stores are.
// - TLS 1.2 or later. Every operation has a time limit; answers have size and entry limits.
// - An empty password is never sent in a bind (RFC 4513 5.1.2: it would be an "unauthenticated" bind
//   that many directories answer with success).
import { connect as netConnect, isIP, type Socket } from 'node:net';
import { connect as tlsConnect, getCACertificates, rootCertificates, type TLSSocket } from 'node:tls';
import {
  BerError, children, constructed, enumerated, integer, octets, readElement, readInteger, readString, sequence, boolean, type Element,
} from './ber.ts';
import { encodeFilter, type Filter } from './ldapfilter.ts';

export const STARTTLS_OID = '1.3.6.1.4.1.1466.20037';
const MAX_MESSAGE = 1024 * 1024;
const MAX_ENTRIES = 1000;

/** Result codes this application acts on (RFC 4511 appendix A). */
export const RESULT = {
  success: 0, operationsError: 1, protocolError: 2, timeLimitExceeded: 3, sizeLimitExceeded: 4, authMethodNotSupported: 7,
  strongerAuthRequired: 8, noSuchObject: 32, invalidDNSyntax: 34, inappropriateAuthentication: 48, invalidCredentials: 49,
  insufficientAccessRights: 50, busy: 51, unavailable: 52, unwillingToPerform: 53,
} as const;

export class LdapError extends Error {
  /** Short reason for the audit log (never holds a password or a bind DN). */
  reason: string;
  code: number | null;
  /** The directory's diagnostic message (Active Directory puts its "data 52e" sub-code here). */
  diagnostic: string;
  constructor(reason: string, code: number | null = null, diagnostic = '') {
    super(reason);
    this.name = 'LdapError';
    this.reason = reason;
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

export interface LdapEndpoint {
  url: string;
  /** Use StartTLS on an ldap:// address. */
  startTls: boolean;
  /** PEM: trust only this CA (or this certificate). Empty = the system and built-in trust stores. */
  caCert?: string;
  timeoutMs?: number;
}

export interface LdapEntry {
  dn: string;
  /** Attribute name (as the directory sent it) to values. */
  attributes: Record<string, Buffer[]>;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '[::1]']);

/** Reads an LDAP address. Null problem when it may be used with these settings. */
export function readLdapUrl(raw: string, startTls: boolean): { host: string; port: number; secure: boolean; problem: string | null } {
  let url: URL;
  try { url = new URL(raw); } catch { return { host: '', port: 0, secure: false, problem: 'is not an LDAP address (ldaps://host or ldap://host)' }; }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const secure = url.protocol === 'ldaps:';
  const port = url.port ? Number(url.port) : secure ? 636 : 389;
  if (url.protocol !== 'ldaps:' && url.protocol !== 'ldap:') return { host, port, secure, problem: 'must start with ldaps:// (or ldap:// with StartTLS)' };
  if (url.username || url.password) return { host, port, secure, problem: 'must not contain a user name or password' };
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) return { host, port, secure, problem: 'must be only the scheme, host and port (put the base DN in its own field)' };
  if (!host) return { host, port, secure, problem: 'has no host name' };
  if (!secure && !startTls && !LOOPBACK.has(host)) {
    return { host, port, secure, problem: 'uses plain LDAP, which sends passwords unencrypted: use ldaps://, or switch StartTLS on (plain LDAP is allowed only to 127.0.0.1)' };
  }
  return { host, port, secure, problem: null };
}

const trustStore = (caCert?: string): string[] | undefined => {
  if (caCert && caCert.trim()) return [caCert];
  // The operating system's store as well as the built-in one: a directory's certificate usually
  // comes from the organization's own CA, which the system store holds.
  try { return [...new Set([...rootCertificates, ...getCACertificates('system')])]; } catch { return undefined; }
};

/** One connection to a directory. Requests are made one at a time. */
export class LdapConnection {
  private socket: Socket | TLSSocket;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private waiting: { id: number; onMessage: (op: Element) => boolean; reject: (err: Error) => void } | null = null;
  private closed: Error | null = null;
  private readonly timeoutMs: number;

  private constructor(socket: Socket | TLSSocket, timeoutMs: number) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.attach(socket);
  }

  private attach(socket: Socket | TLSSocket) {
    socket.on('data', (chunk: Buffer) => this.receive(chunk));
    socket.on('error', (err) => this.fail(new LdapError(`connection error (${(err as NodeJS.ErrnoException).code ?? 'unknown'})`)));
    socket.on('close', () => this.fail(new LdapError('the directory closed the connection')));
  }

  /** Opens an encrypted connection (ldaps://, or ldap:// then StartTLS). */
  static async open(endpoint: LdapEndpoint): Promise<LdapConnection> {
    const { host, port, secure, problem } = readLdapUrl(endpoint.url, endpoint.startTls);
    if (problem) throw new LdapError(`address ${problem}`);
    const timeoutMs = endpoint.timeoutMs ?? 10_000;
    const tlsOptions = {
      host, port, ca: trustStore(endpoint.caCert), minVersion: 'TLSv1.2' as const, rejectUnauthorized: true,
      ...(isIP(host) ? {} : { servername: host }),
    };
    if (secure) {
      const socket = await withTimeout(new Promise<TLSSocket>((resolve, reject) => {
        const s = tlsConnect(tlsOptions, () => resolve(s));
        s.once('error', (err) => reject(tlsError(err)));
      }), timeoutMs, 'TLS connection timed out');
      return new LdapConnection(socket, timeoutMs);
    }
    const plain = await withTimeout(new Promise<Socket>((resolve, reject) => {
      const s = netConnect({ host, port }, () => resolve(s));
      s.once('error', (err) => reject(new LdapError(`could not connect (${(err as NodeJS.ErrnoException).code ?? 'error'})`)));
    }), timeoutMs, 'connection timed out');
    const conn = new LdapConnection(plain, timeoutMs);
    if (!endpoint.startTls) return conn; // only to the loopback address (readLdapUrl)
    // StartTLS: the extended request, then the TLS handshake on the same socket, before anything else.
    const res = await conn.request(constructed(0x77, octets(STARTTLS_OID, 0x80)), 0x78);
    const result = ldapResult(res);
    if (result.code !== RESULT.success) {
      conn.close();
      throw new LdapError('the directory refused StartTLS', result.code, result.diagnostic);
    }
    plain.removeAllListeners('data');
    plain.removeAllListeners('error');
    plain.removeAllListeners('close');
    const secured = await withTimeout(new Promise<TLSSocket>((resolve, reject) => {
      const s = tlsConnect({ ...tlsOptions, socket: plain }, () => resolve(s));
      s.once('error', (err) => reject(tlsError(err)));
    }), timeoutMs, 'TLS handshake timed out').catch((err) => { plain.destroy(); throw err; });
    conn.socket = secured;
    conn.buffer = Buffer.alloc(0);
    conn.attach(secured);
    return conn;
  }

  /** Simple bind. Returns the result code; throws only when the exchange itself fails. */
  async bind(dn: string, password: string): Promise<{ code: number; diagnostic: string }> {
    if (!password) throw new LdapError('empty password refused (it would be an unauthenticated bind)');
    if (dn.length > 1024 || password.length > 1024) throw new LdapError('name or password too long');
    const res = await this.request(constructed(0x60, integer(3), octets(dn), octets(password, 0x80)), 0x61);
    const r = ldapResult(res);
    return { code: r.code, diagnostic: r.diagnostic };
  }

  /** Searches. Scope: 0 base, 1 one level, 2 subtree. Throws on any result other than success. */
  async search(base: string, scope: 0 | 1 | 2, filter: Filter, attributes: string[], sizeLimit: number): Promise<LdapEntry[]> {
    const entries: LdapEntry[] = [];
    const op = constructed(0x63,
      octets(base), enumerated(scope), enumerated(0 /* never dereference aliases */), integer(sizeLimit),
      integer(Math.ceil(this.timeoutMs / 1000)), boolean(false), encodeFilter(filter), sequence(...attributes.map((a) => octets(a))));
    let done: Element | null = null;
    await this.exchange(op, (msg) => {
      if (msg.tag === 0x64) {
        if (entries.length >= MAX_ENTRIES) throw new LdapError('too many entries');
        entries.push(readEntry(msg));
        return false;
      }
      if (msg.tag === 0x73) return false; // continuation references are not followed
      if (msg.tag === 0x65) { done = msg; return true; }
      throw new LdapError('unexpected answer to a search');
    });
    const r = ldapResult(done!);
    if (r.code !== RESULT.success) {
      throw new LdapError(r.code === RESULT.sizeLimitExceeded ? 'more entries than expected' : `search refused (result ${r.code})`, r.code, r.diagnostic);
    }
    return entries;
  }

  /** What the encrypted connection is: TLS version and the directory's certificate (for "Test connection"). */
  tlsInfo(): { protocol: string; subject: string; issuer: string; validTo: string } | null {
    const s = this.socket as TLSSocket;
    if (typeof s.getPeerCertificate !== 'function') return null;
    const cert = s.getPeerCertificate();
    const name = (n: unknown) => (n && typeof n === 'object' ? Object.entries(n as Record<string, unknown>).map(([k, v]) => `${k}=${String(v)}`).join(', ') : '');
    return { protocol: s.getProtocol?.() ?? '', subject: name(cert?.subject).slice(0, 200), issuer: name(cert?.issuer).slice(0, 200), validTo: cert?.valid_to ?? '' };
  }

  /** Unbinds and closes. Never throws. */
  close(): void {
    if (this.closed) return;
    try { this.socket.write(sequence(integer(this.nextId++), Buffer.from([0x42, 0x00]))); } catch { /* closing anyway */ }
    this.closed = new LdapError('connection closed');
    this.socket.end();
    this.socket.destroy();
  }

  private request(op: Buffer, expectTag: number): Promise<Element> {
    let answer: Element | null = null;
    return this.exchange(op, (msg) => {
      if (msg.tag !== expectTag) throw new LdapError('unexpected answer');
      answer = msg;
      return true;
    }).then(() => answer!);
  }

  private exchange(op: Buffer, onMessage: (op: Element) => boolean): Promise<void> {
    if (this.closed) return Promise.reject(this.closed);
    if (this.waiting) return Promise.reject(new LdapError('one request at a time'));
    const id = this.nextId++;
    return withTimeout(new Promise<void>((resolve, reject) => {
      this.waiting = {
        id,
        onMessage: (msg) => {
          if (onMessage(msg)) { this.waiting = null; resolve(); }
          return true;
        },
        reject: (err) => { this.waiting = null; reject(err); },
      };
      this.socket.write(sequence(integer(id), op));
    }), this.timeoutMs, 'the directory did not answer in time').catch((err) => {
      this.waiting = null;
      if (err instanceof LdapError && err.reason.includes('in time')) this.close();
      throw err;
    });
  }

  private receive(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    try {
      for (;;) {
        const r = readElement(this.buffer, 0, MAX_MESSAGE);
        if (!r) {
          if (this.buffer.length > MAX_MESSAGE + 16) throw new LdapError('answer too large');
          return;
        }
        this.buffer = this.buffer.subarray(r.end);
        const parts = children(r.el);
        if (r.el.tag !== 0x30 || parts.length < 2) throw new LdapError('not an LDAP message');
        const id = readInteger(parts[0]);
        const op = parts[1];
        if (id === 0) {
          // Notice of disconnection (RFC 4511 4.4.1): the server is going away.
          this.fail(new LdapError('the directory ended the connection'));
          return;
        }
        if (!this.waiting || this.waiting.id !== id) throw new LdapError('answer to a request that was not made');
        this.waiting.onMessage(op);
      }
    } catch (err) {
      this.fail(err instanceof LdapError ? err : new LdapError(err instanceof BerError ? `malformed answer (${err.message})` : 'malformed answer'));
      this.socket.destroy();
    }
  }

  private fail(err: Error) {
    if (!this.closed) this.closed = err;
    const w = this.waiting;
    this.waiting = null;
    w?.reject(err);
  }
}

function tlsError(err: Error): LdapError {
  const code = (err as NodeJS.ErrnoException).code ?? '';
  if (/CERT|SELF_SIGNED|UNABLE_TO|HOSTNAME|ERR_TLS_CERT_ALTNAME/.test(code)) {
    return new LdapError(`the directory's certificate is not trusted (${code})`);
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH') return new LdapError(`could not connect (${code})`);
  return new LdapError(`TLS failed (${code || err.message.slice(0, 60)})`);
}

function withTimeout<T>(p: Promise<T>, ms: number, reason: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new LdapError(reason)), ms); }),
  ]);
}

/** The LDAPResult in a response (result code, matched DN, diagnostic message). */
export function ldapResult(op: Element): { code: number; diagnostic: string } {
  const parts = children(op);
  if (parts.length < 3) throw new LdapError('malformed result');
  return { code: readInteger(parts[0]), diagnostic: readString(parts[2]).slice(0, 300) };
}

function readEntry(op: Element): LdapEntry {
  const [name, attrs] = children(op);
  const attributes: Record<string, Buffer[]> = {};
  for (const a of children(attrs)) {
    const [type, vals] = children(a);
    const values = children(vals).map((v) => Buffer.from(v.value));
    attributes[readString(type)] = [...(attributes[readString(type)] ?? []), ...values].slice(0, 5000);
  }
  return { dn: readString(name), attributes };
}

/** An attribute's values, whatever case the directory used for its name. */
export function attributeValues(entry: LdapEntry, name: string): Buffer[] {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(entry.attributes)) if (k.toLowerCase() === want || k.toLowerCase().startsWith(`${want};`)) return v;
  return [];
}
