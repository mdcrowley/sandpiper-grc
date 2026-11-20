// The pieces of SAML 2.0 sign-in (E02-10) that need no application: certificates, the hardened XML
// reader and metadata. The whole sign-in is tested in server/src/modules/admin/saml.test.ts.
import { generateKeyPairSync, X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LIMITS, parseIdpMetadata, parseXml } from './samlxml.ts';
import { certificateBody, describeCertificate, readCertificates, selfSignedCertificate } from './x509.ts';

const rsa = (bits: number) => generateKeyPairSync('rsa', { modulusLength: bits });

describe('certificates', () => {
  it('makes a self-signed certificate that verifies, with the key it was made for', () => {
    const { publicKey, privateKey } = rsa(2048);
    const pem = selfSignedCertificate(publicKey, privateKey, 'Example service (test)', 10);
    const cert = new X509Certificate(pem);
    expect(cert.verify(publicKey)).toBe(true);
    expect(cert.subject).toContain('CN=Example service (test)');
    expect(cert.publicKey.export({ type: 'spki', format: 'der' }).equals(publicKey.export({ type: 'spki', format: 'der' }))).toBe(true);
    expect(new Date(cert.validTo).getUTCFullYear()).toBeGreaterThanOrEqual(new Date().getUTCFullYear() + 9);
    const facts = describeCertificate(pem);
    expect(facts.key).toBe('RSA 2048');
    expect(facts.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(facts.expired).toBe(false);
  });

  it('writes the serial number in shortest form, whatever its first bytes (about 1 in 128 random serials start with zero)', () => {
    const { publicKey, privateKey } = rsa(2048);
    const serials = [
      [0x00, 0x12], [0x00, 0x00, 0x80, 0x01], [0x00, 0x80], [0x80, 0x01], [0x7f, 0xff], [0x00, 0x00],
    ].map((b) => Buffer.from([...b, ...Array(16 - b.length).fill(0x5a)]));
    for (const serial of serials) {
      const cert = new X509Certificate(selfSignedCertificate(publicKey, privateKey, "Serial test", 1, serial)); // OpenSSL refuses padded INTEGERs
      expect(cert.verify(publicKey)).toBe(true);
      expect(cert.serialNumber).not.toMatch(/^00/);
    }
  });

  it('reads PEM blocks and bare base64, and refuses weak or foreign keys and private keys', () => {
    const a = rsa(2048);
    const b = rsa(2048);
    const pemA = selfSignedCertificate(a.publicKey, a.privateKey, 'A');
    const pemB = selfSignedCertificate(b.publicKey, b.privateKey, 'B');
    const both = readCertificates(`${pemA}\n${certificateBody(pemB)}`);
    expect(both.problem).toBeNull();
    expect(both.certs).toHaveLength(2);
    expect(readCertificates([pemA, pemA]).certs).toHaveLength(1);
    const weak = rsa(1024);
    expect(readCertificates(selfSignedCertificate(weak.publicKey, weak.privateKey, 'Weak')).problem).toMatch(/at least 2048/);
    expect(readCertificates(a.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()).problem).toMatch(/never a private key/);
    expect(readCertificates('not base64 at all!').problem).toMatch(/not readable/);
  });
});

describe('the hardened XML reader', () => {
  it('refuses DTDs, processing instructions, and documents over the limits', () => {
    expect(() => parseXml('<!DOCTYPE a SYSTEM "http://example.test/a.dtd"><a/>')).toThrow(/document type declaration/);
    expect(() => parseXml('<?xml version="1.0"?><?xml-stylesheet href="x"?><a/>')).toThrow(/processing instruction/);
    expect(() => parseXml('<a><b></a>')).toThrow(/not well formed/);
    expect(() => parseXml(`<a>${'<b/>'.repeat(LIMITS.elements + 1)}</a>`)).toThrow(/too many elements/);
    expect(() => parseXml(`${'<a>'.repeat(LIMITS.depth + 1)}${'</a>'.repeat(LIMITS.depth + 1)}`)).toThrow(/nested too deeply/);
    expect(() => parseXml(`<a>${'x'.repeat(LIMITS.messageBytes)}</a>`)).toThrow(/larger than/);
    expect(parseXml('<?xml version="1.0" encoding="UTF-8"?><a x="1"><!-- fine --><![CDATA[ok]]></a>').documentElement.getAttribute('x')).toBe('1');
  });

  it('reads metadata with one identity provider only', () => {
    const entity = (id: string) => `<md:EntityDescriptor entityID="${id}"><md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">`
      + '<md:KeyDescriptor><ds:KeyInfo><ds:X509Data><ds:X509Certificate>AAAA</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>'
      + `<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://${id}/sso"/></md:IDPSSODescriptor></md:EntityDescriptor>`;
    const wrap = (inner: string) => `<md:EntitiesDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${inner}</md:EntitiesDescriptor>`;
    expect(parseIdpMetadata(wrap(entity('one.example.test'))).ssoUrl).toBe('https://one.example.test/sso');
    expect(() => parseIdpMetadata(wrap(entity('one.example.test') + entity('two.example.test')))).toThrow(/2 identity providers/);
    expect(() => parseIdpMetadata('<a/>')).toThrow(/not SAML 2.0 metadata/);
  });
});
