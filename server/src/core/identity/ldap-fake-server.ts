// A stand-in LDAP directory for tests and local trials (E02-26). NEVER used by the application itself.
//
// It listens on this machine only (localhost, any free port), speaks the part of LDAP v3 the
// application's client uses (simple bind, search, StartTLS, unbind), and answers from entries held
// in memory. Its TLS key and certificate are made when it starts (no key is ever committed). Modes:
// `ldaps` (TLS from the first byte), `starttls` (plain, upgraded by StartTLS; `refuseStartTls`
// answers the upgrade with an error) and `none` (plain LDAP, which the client allows only to 127.0.0.1).
//
// Bind answers imitate Active Directory's diagnostic sub-codes (data 52e wrong password, 533
// disabled, 775 locked). Every request is recorded (`log`), with filters in their string form, so a
// test can check exactly what reached the directory.
import { generateKeyPairSync } from 'node:crypto';
import { createServer as netServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { createSecureContext, createServer as tlsServer, TLSSocket } from 'node:tls';
import {
  children, constructed, enumerated, integer, octets, readElement, readInteger, readString, sequence, set, type Element,
} from './ber.ts';
import { decodeFilter, filterToString, IN_CHAIN, type Filter } from './ldapfilter.ts';
import { STARTTLS_OID } from './ldapclient.ts';
import { selfSignedCertificate } from './x509.ts';

export interface FakeLdapEntry {
  dn: string;
  attributes: Record<string, (string | Buffer)[]>;
  /** The entry's password, for a simple bind. */
  password?: string;
  /** Bind answers "data 533" (Active Directory: account disabled). */
  disabled?: boolean;
  /** Bind answers "data 775" (Active Directory: account locked). */
  locked?: boolean;
}

export interface FakeLdapRequest { op: 'bind' | 'search' | 'starttls' | 'unbind' | 'other'; dn?: string; base?: string; filter?: string; ok?: boolean }

export interface FakeLdap {
  port: number;
  /** The address to configure: ldaps://localhost:<port>, ldap://localhost:<port> or ldap://127.0.0.1:<port>. */
  url: string;
  /** The server's certificate (PEM): pin it as the CA certificate. */
  cert: string;
  entries: FakeLdapEntry[];
  log: FakeLdapRequest[];
  close(): Promise<void>;
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const normDn = (dn: string) => dn.replace(/\s*,\s*/g, ',').toLowerCase();

function result(tag: number, code: number, diagnostic = ''): Buffer {
  return constructed(tag, enumerated(code), octets(''), octets(diagnostic));
}

export async function startFakeLdap(opts: { mode: 'ldaps' | 'starttls' | 'none'; refuseStartTls?: boolean; entries?: FakeLdapEntry[] } = { mode: 'ldaps' }): Promise<FakeLdap> {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const cert = selfSignedCertificate(publicKey, privateKey, 'localhost', 1);
  const key = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const context = createSecureContext({ key, cert });
  const entries: FakeLdapEntry[] = opts.entries ?? [];
  const log: FakeLdapRequest[] = [];
  const sockets = new Set<Socket>();

  const values = (e: FakeLdapEntry, attr: string): string[] => {
    if (eq(attr, 'distinguishedName')) return [e.dn];
    for (const [k, v] of Object.entries(e.attributes)) if (eq(k, attr)) return v.map((x) => (Buffer.isBuffer(x) ? x.toString('latin1') : x));
    return [];
  };
  const byDn = (dn: string) => entries.find((e) => normDn(e.dn) === normDn(dn));
  /** Groups `dn` is in, directly or through other groups. */
  const groupsOf = (dn: string, seen = new Set<string>()): Set<string> => {
    for (const g of entries) {
      if (values(g, 'member').some((m) => normDn(m) === normDn(dn)) && !seen.has(normDn(g.dn))) {
        seen.add(normDn(g.dn));
        groupsOf(g.dn, seen);
      }
    }
    return seen;
  };

  const matches = (e: FakeLdapEntry, f: Filter): boolean => {
    switch (f.op) {
      case 'and': return f.list.every((x) => matches(e, x));
      case 'or': return f.list.some((x) => matches(e, x));
      case 'not': return !matches(e, f.filter);
      case 'present': return eq(f.attr, 'objectClass') || values(e, f.attr).length > 0;
      case 'eq': case 'approx': return values(e, f.attr).some((v) => eq(v, f.value.toString('utf8')) || v === f.value.toString('latin1'));
      case 'ge': return values(e, f.attr).some((v) => v >= f.value.toString('utf8'));
      case 'le': return values(e, f.attr).some((v) => v <= f.value.toString('utf8'));
      case 'substr': return values(e, f.attr).some((raw) => {
        let v = raw.toLowerCase();
        if (f.initial) { const i = f.initial.toString('utf8').toLowerCase(); if (!v.startsWith(i)) return false; v = v.slice(i.length); }
        for (const a of f.any) { const at = v.indexOf(a.toString('utf8').toLowerCase()); if (at < 0) return false; v = v.slice(at + a.length); }
        return !f.final || v.endsWith(f.final.toString('utf8').toLowerCase());
      });
      case 'ext': {
        const value = f.value.toString('utf8');
        if (f.rule === IN_CHAIN && f.attr && eq(f.attr, 'member')) return groupsOf(value).has(normDn(e.dn));
        if (f.rule === IN_CHAIN && f.attr && eq(f.attr, 'memberOf')) return groupsOf(e.dn).has(normDn(value));
        return f.attr ? values(e, f.attr).some((v) => eq(v, value)) : false;
      }
      default: return false;
    }
  };

  const inScope = (e: FakeLdapEntry, base: string, scope: number) => {
    const d = normDn(e.dn);
    const b = normDn(base);
    if (scope === 0) return d === b;
    if (!d.endsWith(`,${b}`)) return false;
    return scope === 2 || !d.slice(0, -(b.length + 1)).includes(',');
  };

  const serve = (socket: Socket | TLSSocket, plain: Socket) => {
    let buffer = Buffer.alloc(0);
    const send = (id: number, op: Buffer) => socket.write(sequence(integer(id), op));
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        let r: ReturnType<typeof readElement>;
        try { r = readElement(buffer); } catch { socket.destroy(); return; }
        if (!r) return;
        buffer = buffer.subarray(r.end);
        let parts: Element[];
        try { parts = children(r.el); } catch { socket.destroy(); return; }
        const id = readInteger(parts[0]);
        const op = parts[1];
        if (op.tag === 0x42) { log.push({ op: 'unbind' }); socket.end(); return; }
        if (op.tag === 0x77) {
          const name = readString(children(op)[0]);
          log.push({ op: 'starttls' });
          if (name !== STARTTLS_OID || opts.mode !== 'starttls' || opts.refuseStartTls || socket !== plain) {
            send(id, constructed(0x78, enumerated(2), octets(''), octets('StartTLS not available')));
            continue;
          }
          send(id, constructed(0x78, enumerated(0), octets(''), octets('')));
          socket.removeListener('data', onData);
          const secured = new TLSSocket(plain, { isServer: true, secureContext: context });
          secured.on('error', () => secured.destroy());
          serve(secured, plain);
          return;
        }
        if (op.tag === 0x60) {
          const [, name, auth] = children(op);
          const dn = readString(name);
          const password = auth.tag === 0x80 ? readString(auth) : '';
          const e = byDn(dn);
          let code = 49;
          let diag = '80090308: LdapErr: DSID-0C090447, comment: AcceptSecurityContext error, data 52e, v3839';
          if (!dn && !password) code = 0; // anonymous
          else if (e && e.password !== undefined && e.password === password) {
            if (e.disabled) diag = diag.replace('52e', '533');
            else if (e.locked) diag = diag.replace('52e', '775');
            else { code = 0; diag = ''; }
          }
          log.push({ op: 'bind', dn, ok: code === 0 });
          send(id, result(0x61, code, diag));
          continue;
        }
        if (op.tag === 0x63) {
          const [base, scope, , size, , , filterEl, attrs] = children(op);
          let filter: Filter;
          try { filter = decodeFilter(filterEl); } catch { send(id, result(0x65, 2, 'bad filter')); continue; }
          const wanted = children(attrs).map(readString);
          log.push({ op: 'search', base: readString(base), filter: filterToString(filter) });
          const found = entries.filter((e) => inScope(e, readString(base), readInteger(scope)) && matches(e, filter));
          const limit = readInteger(size);
          for (const e of found.slice(0, limit || found.length)) {
            const attributes = Object.entries(e.attributes)
              .filter(([k]) => !wanted.length || wanted.some((w) => eq(w, k)))
              .map(([k, vs]) => sequence(octets(k), set(...vs.map((v) => octets(v)))));
            send(id, constructed(0x64, octets(e.dn), sequence(...attributes)));
          }
          send(id, limit && found.length > limit ? result(0x65, 4, 'size limit exceeded') : result(0x65, 0));
          continue;
        }
        log.push({ op: 'other' });
        send(id, result(0x65, 53, 'not supported'));
      }
    };
    socket.on('data', onData);
  };

  let server: Server;
  if (opts.mode === 'ldaps') {
    server = tlsServer({ key, cert }, (s) => { sockets.add(s); s.on('error', () => s.destroy()); serve(s, s); });
    server.on('tlsClientError', () => undefined);
  } else {
    server = netServer((s) => { sockets.add(s); s.on('error', () => s.destroy()); serve(s, s); });
  }
  const host = opts.mode === 'none' ? '127.0.0.1' : 'localhost';
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    url: `${opts.mode === 'ldaps' ? 'ldaps' : 'ldap'}://${host}:${port}`,
    cert,
    entries,
    log,
    close: () => new Promise<void>((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }),
  };
}
