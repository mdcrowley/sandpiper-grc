// Certificates for SAML 2.0 sign-in (E02-10): reading the identity provider's signing certificates,
// and making the self-signed certificate this application publishes in its service-provider metadata.
//
// Node can read X.509 certificates (`X509Certificate`) but not make them, so `selfSignedCertificate`
// writes the few DER structures a self-signed certificate needs (RFC 5280: version 3, serial, issuer
// and subject with one common name, validity, the public key, signed with SHA-256 and RSA). Nobody
// relies on this certificate's chain or dates: SAML trusts the key in it because an administrator
// gives the metadata to the identity provider.
import { createHash, randomBytes, sign, X509Certificate, type KeyObject } from 'node:crypto';

// ---------- a minimal DER writer ----------

function derLength(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag: number, body: Buffer) => Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
/** A non-negative INTEGER in DER: no leading zero bytes, except one before a byte whose top bit is set. */
function integer(raw: Buffer): Buffer {
  let i = 0;
  while (i < raw.length - 1 && raw[i] === 0) i++;
  const v = raw.subarray(i);
  return tlv(0x02, v[0] & 0x80 ? Buffer.concat([Buffer.from([0]), v]) : v);
}
const NULL = Buffer.from([0x05, 0x00]);
function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  const out = [40 * parts[0] + parts[1]];
  for (const p of parts.slice(2)) {
    const chunk = [p & 0x7f];
    for (let v = Math.floor(p / 128); v > 0; v = Math.floor(v / 128)) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}
function time(d: Date): Buffer {
  const iso = d.toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
  // RFC 5280 4.1.2.5: UTCTime up to 2049, GeneralizedTime from 2050.
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${iso}Z`));
}
const name = (commonName: string) => seq(set(seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(commonName, 'utf8')))));
const SHA256_RSA = seq(oid('1.2.840.113549.1.1.11'), NULL);

const pem = (label: string, der: Buffer) =>
  `-----BEGIN ${label}-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END ${label}-----\n`;

/** A self-signed certificate (PEM) for an RSA key pair. */
export function selfSignedCertificate(publicKey: KeyObject, privateKey: KeyObject, commonName: string, years = 10, serialBytes?: Buffer): string {
  const now = new Date();
  const notBefore = new Date(now.getTime() - 5 * 60_000);
  const notAfter = new Date(now);
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + years);
  const serial = Buffer.from(serialBytes ?? randomBytes(16));
  serial[0] &= 0x7f; // positive (a leading zero byte is dropped by integer(), as DER requires)
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const tbs = seq(
    tlv(0xa0, integer(Buffer.from([2]))), // version 3
    integer(serial),
    SHA256_RSA,
    name(commonName),
    seq(time(notBefore), time(notAfter)),
    name(commonName),
    spki,
  );
  const signature = sign('sha256', tbs, privateKey);
  return pem('CERTIFICATE', seq(tbs, SHA256_RSA, tlv(0x03, Buffer.concat([Buffer.from([0]), signature]))));
}

// ---------- reading certificates ----------

export interface CertificateFacts {
  /** SHA-256 fingerprint, colon-separated upper-case hex, as most identity providers show it. */
  fingerprint: string;
  subject: string;
  notBefore: string;
  notAfter: string;
  expired: boolean;
  /** For example "RSA 2048" or "EC P-256". */
  key: string;
}

/**
 * Splits text into certificates: PEM blocks, or the bare base64 a metadata document's
 * `<X509Certificate>` holds. Returns normalized PEM strings, or a plain-language problem.
 */
export function readCertificates(input: string | string[]): { certs: string[]; problem: string | null } {
  const text = Array.isArray(input) ? input.join('\n') : String(input ?? '');
  const blocks = [...text.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)].map((m) => m[1]);
  const bare = text.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim();
  if (bare) {
    if (/-----BEGIN/.test(bare)) return { certs: [], problem: 'Only certificates can be given here (BEGIN CERTIFICATE), never a private key.' };
    // Bare base64 values, separated by blank lines or commas.
    for (const part of bare.split(/\n\s*\n|,/)) if (part.trim()) blocks.push(part);
  }
  const certs: string[] = [];
  for (const raw of blocks) {
    const b64 = raw.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length > 16_000) return { certs: [], problem: 'A certificate is not readable: paste it as given (PEM, or the base64 from the metadata).' };
    const der = Buffer.from(b64, 'base64');
    let facts: CertificateFacts;
    try {
      facts = describeCertificate(pem('CERTIFICATE', der));
    } catch {
      return { certs: [], problem: 'A certificate is not readable: paste it as given (PEM, or the base64 from the metadata).' };
    }
    const keyProblem = weakKey(facts.key);
    if (keyProblem) return { certs: [], problem: keyProblem };
    const normalized = pem('CERTIFICATE', der);
    if (!certs.includes(normalized)) certs.push(normalized);
  }
  return { certs, problem: null };
}

function weakKey(key: string): string | null {
  const rsa = /^RSA (\d+)$/.exec(key);
  if (rsa) return Number(rsa[1]) >= 2048 ? null : `A certificate has an RSA key of ${rsa[1]} bits; at least 2048 are required.`;
  return `A certificate has a ${key} key; SAML signatures are accepted only with RSA keys (RSA-SHA256 or stronger).`;
}

export function describeCertificate(certPem: string): CertificateFacts {
  const cert = new X509Certificate(certPem);
  const k = cert.publicKey;
  const details = k.asymmetricKeyDetails ?? {};
  const key = k.asymmetricKeyType === 'rsa' ? `RSA ${details.modulusLength ?? '?'}`
    : k.asymmetricKeyType === 'ec' ? `EC ${details.namedCurve ?? '?'}` : String(k.asymmetricKeyType ?? 'unknown').toUpperCase();
  const notAfter = new Date(cert.validTo);
  return {
    fingerprint: createHash('sha256').update(cert.raw).digest('hex').toUpperCase().replace(/(..)(?!$)/g, '$1:'),
    subject: cert.subject.replace(/\n/g, ', ').slice(0, 300),
    notBefore: new Date(cert.validFrom).toISOString(),
    notAfter: notAfter.toISOString(),
    expired: notAfter.getTime() < Date.now(),
    key,
  };
}

/** The base64 body of a PEM certificate, as `<X509Certificate>` wants it. */
export const certificateBody = (certPem: string) => certPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
