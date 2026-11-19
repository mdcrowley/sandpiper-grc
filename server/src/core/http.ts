import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BlockList, isIP } from 'node:net';
import { createSecureContext } from 'node:tls';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isHttps } from './request.ts';

/**
 * How the server is reached: listen address, HTTPS, reverse proxies and strict transport
 * security. Settings come from the environment (see docs/installation.md):
 *
 * - GRC_HOST (default 127.0.0.1), GRC_PORT (default 8080)
 * - GRC_TLS_CERT, GRC_TLS_KEY: PEM files; when both are set the server speaks HTTPS itself
 * - GRC_TRUST_PROXY: who may set X-Forwarded-For / -Proto / -Host (see `trustProxyFn`)
 * - GRC_ALLOW_INSECURE=1: allow plain HTTP on a non-loopback address (a TLS proxy is in front)
 * - GRC_HSTS_MAX_AGE (seconds, default one year, 0 = off), GRC_HSTS_INCLUDE_SUBDOMAINS=1
 */

type Env = Record<string, string | undefined>;

const truthy = (v: string | undefined) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase());
const falsy = (v: string | undefined) => ['', '0', 'false', 'no', 'off'].includes(String(v ?? '').trim().toLowerCase());

// ---------------------------------------------------------------------------------------------
// Trusted proxies

/** Addresses named by keyword in GRC_TRUST_PROXY. */
const KEYWORDS: Record<string, [string, number, 'ipv4' | 'ipv6'][]> = {
  loopback: [['127.0.0.0', 8, 'ipv4'], ['::1', 128, 'ipv6']],
  private: [['10.0.0.0', 8, 'ipv4'], ['172.16.0.0', 12, 'ipv4'], ['192.168.0.0', 16, 'ipv4'], ['fc00::', 7, 'ipv6']],
  linklocal: [['169.254.0.0', 16, 'ipv4'], ['fe80::', 10, 'ipv6']],
};

export type TrustFn = (address: string, hop: number) => boolean;

/**
 * Parses GRC_TRUST_PROXY:
 * - unset, `0`, `off`: forwarded headers are ignored (the default)
 * - `1`, `true`, or a number n: trust that many proxy hops in front of the server, whatever
 *   their address. Use only when the server cannot be reached except through the proxy.
 * - a comma-separated list of addresses, CIDR ranges and the keywords `loopback`, `private`,
 *   `linklocal`: trust a hop only when its address is in the list (recommended).
 */
export function parseTrustProxy(value: string | undefined): TrustFn {
  const raw = String(value ?? '').trim();
  if (falsy(raw)) return () => false;
  if (truthy(raw)) return (_a, hop) => hop < 1;
  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    return (_a, hop) => hop < hops;
  }
  const list = new BlockList();
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const keyword = KEYWORDS[entry.toLowerCase()];
    if (keyword) {
      for (const [net, prefix, type] of keyword) list.addSubnet(net, prefix, type);
      continue;
    }
    const [addr, prefixText] = entry.split('/');
    const family = isIP(addr);
    if (!family) throw new Error(`GRC_TRUST_PROXY: "${entry}" is not an address, a CIDR range or one of loopback, private, linklocal.`);
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefixText === undefined) list.addAddress(addr, type);
    else {
      const prefix = Number(prefixText);
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > (family === 4 ? 32 : 128)) throw new Error(`GRC_TRUST_PROXY: "${entry}" has an invalid prefix length.`);
      list.addSubnet(addr, prefix, type);
    }
  }
  return (address) => {
    if (!address) return false;
    // An IPv4 peer on a dual-stack socket appears as ::ffff:a.b.c.d.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    const addr = mapped ? mapped[1] : address;
    const family = isIP(addr);
    return family ? list.check(addr, family === 4 ? 'ipv4' : 'ipv6') : false;
  };
}

/**
 * The web server's trust-proxy option. Reads GRC_TRUST_PROXY at the time of each request (so
 * a changed setting needs no rebuild of the server object), parsing each distinct value once.
 */
export function trustProxyFn(env: Env = process.env): TrustFn {
  let seen: string | undefined;
  let fn: TrustFn = () => false;
  return (address, hop) => {
    const value = env.GRC_TRUST_PROXY ?? '';
    if (value !== seen) {
      fn = parseTrustProxy(value);
      seen = value;
    }
    return fn(address, hop);
  };
}

/** True when a trusted proxy is configured (forwarded headers may be believed from someone). */
export const proxyConfigured = (env: Env = process.env) => !falsy(env.GRC_TRUST_PROXY);

// ---------------------------------------------------------------------------------------------
// Strict transport security

/** The Strict-Transport-Security value to send, or null when switched off. */
export function hstsValue(env: Env = process.env): string | null {
  const raw = env.GRC_HSTS_MAX_AGE?.trim();
  const maxAge = raw ? Number(raw) : 31536000;
  if (!Number.isInteger(maxAge) || maxAge <= 0) return null;
  return `max-age=${maxAge}${truthy(env.GRC_HSTS_INCLUDE_SUBDOMAINS) ? '; includeSubDomains' : ''}`;
}

/** Adds Strict-Transport-Security to a response that went out over HTTPS (directly or via a trusted proxy). */
export function addHsts(req: FastifyRequest, reply: FastifyReply): void {
  if (!isHttps(req)) return;
  const value = hstsValue();
  if (value) reply.header('strict-transport-security', value);
}

// ---------------------------------------------------------------------------------------------
// Listen address and HTTPS

export interface TlsFiles {
  cert: Buffer;
  key: Buffer;
  certPath: string;
  keyPath: string;
}

export interface ListenPlan {
  host: string;
  port: number;
  tls?: TlsFiles;
  /** The address people type, for the start-up message. */
  url: string;
}

const LOOPBACK_NAMES = new Set(['localhost', 'ip6-localhost', 'ip6-loopback']);

/** True for an address only this machine can reach (127.0.0.0/8, ::1, localhost). */
export function isLoopback(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (LOOPBACK_NAMES.has(h)) return true;
  if (isIP(h) === 4) return h.startsWith('127.');
  if (h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  return !!mapped && mapped[1].startsWith('127.');
}

export class ListenError extends Error {}

/**
 * Decides where and how to listen, or explains why it will not. Plain HTTP on an address other
 * machines can reach is refused unless GRC_ALLOW_INSECURE=1 says a TLS proxy is in front.
 */
export function planListen(env: Env = process.env, read: (path: string) => Buffer = (p) => readFileSync(p)): ListenPlan {
  const host = (env.GRC_HOST ?? '127.0.0.1').trim() || '127.0.0.1';
  const portText = (env.GRC_PORT ?? '8080').trim();
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ListenError(`GRC_PORT must be a port number (got "${portText}").`);

  const certPath = env.GRC_TLS_CERT?.trim();
  const keyPath = env.GRC_TLS_KEY?.trim();
  if (!!certPath !== !!keyPath) throw new ListenError('Set both GRC_TLS_CERT and GRC_TLS_KEY (PEM files) to serve HTTPS, or neither.');
  let tls: TlsFiles | undefined;
  if (certPath && keyPath) {
    const load = (path: string, what: string) => {
      try {
        return read(path);
      } catch (err) {
        throw new ListenError(`Cannot read the TLS ${what} file ${path}: ${(err as Error).message}`);
      }
    };
    tls = { cert: load(certPath, 'certificate'), key: load(keyPath, 'key'), certPath, keyPath };
    if (!/-----BEGIN [A-Z ]*CERTIFICATE-----/.test(tls.cert.toString('utf8'))) throw new ListenError(`${certPath} is not a PEM certificate.`);
    if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(tls.key.toString('utf8'))) throw new ListenError(`${keyPath} is not a PEM private key.`);
  }

  if (!tls && !isLoopback(host) && !truthy(env.GRC_ALLOW_INSECURE)) {
    throw new ListenError(
      `Refusing to serve plain HTTP on ${host}, which other machines can reach. Either set GRC_TLS_CERT and GRC_TLS_KEY to serve HTTPS, ` +
        `or put a reverse proxy that terminates HTTPS in front and set GRC_ALLOW_INSECURE=1 (with GRC_TRUST_PROXY naming the proxy). ` +
        `To stay on this machine only, leave GRC_HOST unset (127.0.0.1).`,
    );
  }
  const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host.includes(':') ? `[${host}]` : host;
  return { host, port, tls, url: `${tls ? 'https' : 'http'}://${shown}:${port}` };
}

/**
 * The secure-cookie default for a deployment: when GRC_COOKIE_SECURE is unset and the server is
 * on HTTPS or behind a trusted proxy, `auto` (the flag is set whenever the request is HTTPS).
 * Returns the value to set, or undefined to leave the setting alone.
 */
export function defaultCookieSecure(plan: Pick<ListenPlan, 'tls'>, env: Env = process.env): string | undefined {
  if (env.GRC_COOKIE_SECURE !== undefined && env.GRC_COOKIE_SECURE.trim() !== '') return undefined;
  return plan.tls || proxyConfigured(env) ? 'auto' : undefined;
}

// ---------------------------------------------------------------------------------------------
// Reloading the certificate (E16-33)

export interface TlsReloadResult {
  ok: boolean;
  /** What happened, for the log: the new certificate's subject and expiry, or why it was refused. */
  message: string;
}

export interface TlsReloader {
  /** Reads the files now and switches to them if they changed and are valid. Null when unchanged. */
  check(force?: boolean): TlsReloadResult | null;
  stop(): void;
}

/** Seconds between looks at the certificate files: GRC_TLS_RELOAD_SECONDS (default 60, 0 = only on SIGHUP). */
export function tlsReloadSeconds(env: Env = process.env): number {
  const raw = env.GRC_TLS_RELOAD_SECONDS?.trim();
  if (!raw) return 60;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new ListenError(`GRC_TLS_RELOAD_SECONDS must be a number of seconds, 0 or more (got "${raw}").`);
  return n;
}

/**
 * Watches the certificate and key files of an HTTPS server and, when they change, checks the new
 * pair (both PEM, the key matches the certificate) and gives it to the server for new
 * connections; connections already open carry on. A broken or half-written pair is reported and
 * the certificate in use stays; it is tried again when either file changes.
 */
export function watchTlsFiles(
  server: { setSecureContext(options: { cert: Buffer; key: Buffer }): void },
  files: Pick<TlsFiles, 'certPath' | 'keyPath' | 'cert' | 'key'>,
  opts: { intervalMs: number; onResult: (r: TlsReloadResult) => void; read?: (path: string) => Buffer },
): TlsReloader {
  const read = opts.read ?? ((p: string) => readFileSync(p));
  const sig = (cert: Buffer, key: Buffer) => createHash('sha256').update(cert).update('\0').update(key).digest('hex');
  let seen = sig(files.cert, files.key);
  let readError = '';
  const check = (force = false): TlsReloadResult | null => {
    let cert: Buffer;
    let key: Buffer;
    try {
      cert = read(files.certPath);
      key = read(files.keyPath);
    } catch (err) {
      const r = { ok: false, message: `Cannot read the TLS files; the certificate in use stays: ${(err as Error).message}` };
      if (r.message === readError && !force) return null; // said once until it changes
      readError = r.message;
      opts.onResult(r);
      return r;
    }
    readError = '';
    const now = sig(cert, key);
    if (now === seen && !force) return null;
    seen = now;
    let result: TlsReloadResult;
    try {
      if (!/-----BEGIN [A-Z ]*CERTIFICATE-----/.test(cert.toString('utf8'))) throw new Error(`${files.certPath} is not a PEM certificate`);
      if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key.toString('utf8'))) throw new Error(`${files.keyPath} is not a PEM private key`);
      createSecureContext({ cert, key }); // throws when the key does not match the certificate
      const x509 = new X509Certificate(cert);
      server.setSecureContext({ cert, key });
      result = { ok: true, message: `TLS certificate reloaded: ${x509.subject.replace(/\n/g, ', ')}, valid until ${new Date(x509.validTo).toISOString()}` };
    } catch (err) {
      result = { ok: false, message: `The new TLS certificate was NOT loaded (the previous one stays in use): ${(err as Error).message}` };
    }
    opts.onResult(result);
    return result;
  };
  const timer = opts.intervalMs > 0 ? setInterval(() => check(), opts.intervalMs) : null;
  timer?.unref();
  return { check, stop: () => timer && clearInterval(timer) };
}
