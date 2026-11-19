import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * A self-signed certificate for trying HTTPS locally or in tests. Browsers do not trust it
 * (they warn, and the address must be accepted by hand); never use it for a real service.
 * Written with Node's crypto alone so it works on any machine without OpenSSL.
 *
 * Command line:
 *   npx tsx server/src/core/tls-selfsigned.ts <folder> [name ...]
 * writes <folder>/cert.pem and <folder>/key.pem for the names given (default localhost,
 * 127.0.0.1 and ::1), valid for 30 days.
 */

// --- minimal DER encoding -------------------------------------------------------------------

function len(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag: number, body: Buffer) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
const octets = (b: Buffer) => tlv(0x04, b);
const bits = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const bool = (v: boolean) => tlv(0x01, Buffer.from([v ? 0xff : 0]));
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));
const explicit = (n: number, body: Buffer) => tlv(0xa0 + n, body);

function int(b: Buffer): Buffer {
  let body = b;
  while (body.length > 1 && body[0] === 0 && !(body[1] & 0x80)) body = body.subarray(1);
  if (body[0] & 0x80) body = Buffer.concat([Buffer.from([0]), body]);
  return tlv(0x02, body);
}

function oid(dotted: string): Buffer {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const out = [40 * a + b];
  for (const n of rest) {
    const chunk: number[] = [n & 0x7f];
    for (let v = n >>> 7; v > 0; v >>>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

function time(d: Date): Buffer {
  const iso = d.toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${iso}Z`));
}

function ipBytes(ip: string): Buffer {
  if (isIP(ip) === 4) return Buffer.from(ip.split('.').map(Number));
  const [head, tail = ''] = ip.split('::');
  const part = (s: string) => (s ? s.split(':') : []);
  const h = part(head);
  const t = ip.includes('::') ? part(tail) : [];
  const groups = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return Buffer.concat(groups.map((g) => { const b = Buffer.alloc(2); b.writeUInt16BE(parseInt(g, 16)); return b; }));
}

const OID = {
  ecdsaSha256: '1.2.840.10045.4.3.2',
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
  subjectAltName: '2.5.29.17',
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
  extKeyUsage: '2.5.29.37',
  serverAuth: '1.3.6.1.5.5.7.3.1',
};

const extension = (id: string, critical: boolean, value: Buffer) =>
  seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));

export interface SelfSigned {
  cert: string;
  key: string;
}

/** A fresh P-256 key and a self-signed server certificate for the given DNS names and addresses. */
export function makeSelfSigned(names: string[] = ['localhost', '127.0.0.1', '::1'], days = 30): SelfSigned {
  if (!names.length) throw new Error('At least one name is needed.');
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const now = Date.now();
  const algorithm = seq(oid(OID.ecdsaSha256));
  const name = seq(
    set(seq(oid(OID.organization), utf8('Sandpiper GRC self-signed test certificate'))),
    set(seq(oid(OID.commonName), utf8(names[0]))),
  );
  const altNames = names.map((n) => (isIP(n) ? tlv(0x87, ipBytes(n)) : tlv(0x82, Buffer.from(n, 'ascii'))));
  const extensions = seq(
    extension(OID.basicConstraints, true, seq()),
    extension(OID.keyUsage, true, bits(Buffer.from([0x80]))), // digitalSignature
    extension(OID.extKeyUsage, false, seq(oid(OID.serverAuth))),
    extension(OID.subjectAltName, false, seq(...altNames)),
  );
  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  const tbs = seq(
    explicit(0, int(Buffer.from([2]))), // version 3
    int(serial),
    algorithm,
    name,
    seq(time(new Date(now - 60_000)), time(new Date(now + days * 86_400_000))),
    name,
    publicKey.export({ type: 'spki', format: 'der' }) as Buffer,
    explicit(3, extensions),
  );
  const signature = sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' });
  const der = seq(tbs, algorithm, bits(signature));
  const pem = (label: string, body: Buffer) =>
    `-----BEGIN ${label}-----\n${body.toString('base64').replace(/.{1,64}/g, '$&\n')}-----END ${label}-----\n`;
  return { cert: pem('CERTIFICATE', der), key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string };
}

/** Writes cert.pem and key.pem (the key readable by its owner only, where the system supports it). */
export function writeSelfSigned(folder: string, names?: string[], days?: number): { certPath: string; keyPath: string } {
  mkdirSync(folder, { recursive: true });
  const { cert, key } = makeSelfSigned(names, days);
  const certPath = join(folder, 'cert.pem');
  const keyPath = join(folder, 'key.pem');
  writeFileSync(certPath, cert);
  writeFileSync(keyPath, key, { mode: 0o600 });
  return { certPath, keyPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [folder, ...names] = process.argv.slice(2);
  if (!folder) {
    console.error('Usage: npx tsx server/src/core/tls-selfsigned.ts <folder> [name ...]');
    process.exit(2);
  }
  const { certPath, keyPath } = writeSelfSigned(resolve(folder), names.length ? names : undefined);
  console.log(`Wrote ${certPath} and ${keyPath} (self-signed, 30 days; browsers will warn - for testing only).`);
  console.log(`Start with: GRC_TLS_CERT=${certPath} GRC_TLS_KEY=${keyPath}`);
}
