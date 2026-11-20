// A stand-in SAML 2.0 identity provider for tests and local trials. NEVER used by the application itself.
//
// Its signing key and certificate are generated when it starts (no key is ever committed). It reads
// an AuthnRequest from the HTTP-Redirect binding and answers with a Response for the HTTP-POST
// binding: by default an assertion signed with RSA-SHA256, for the request, audience and address
// the request names. `respond()` takes options that break exactly one thing at a time, for the
// negative tests (unsigned, signed by another key, SHA-1, wrong audience, recipient, destination,
// InResponseTo or issuer, expired, transient NameID, encrypted, and `mutate` for hand-made attacks
// such as signature wrapping or a DTD).
//
// It also serves, on 127.0.0.1 (port 0 = any free port): `/metadata` (its metadata), `/sso` (a page
// with a Continue button that posts the response to the assertion consumer service, for a browser
// run) and `/slo` (a "signed out" page).
import { generateKeyPairSync, randomBytes, X509Certificate, type KeyObject } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { inflateRawSync } from 'node:zlib';
import { SignedXml } from 'xml-crypto';
import xmlenc from 'xml-encryption';
import { selfSignedCertificate } from './x509.ts';

const P = 'urn:oasis:names:tc:SAML:2.0:protocol';
const A = 'urn:oasis:names:tc:SAML:2.0:assertion';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export interface FakeSamlUser {
  nameId: string;
  nameIdFormat?: string;
  attributes: Record<string, string[]>;
}

export interface AuthnRequestFacts { id: string; acsUrl: string; issuer: string; relayState: string; forceAuthn: boolean; signed: boolean; authnContext: string[] }

export interface RespondOptions {
  signAssertion?: boolean;
  signResponse?: boolean;
  /** Sign with a key the application does not trust. */
  foreignKey?: boolean;
  /** Signature algorithm; SHA-1 must be refused. */
  sigAlg?: 'sha256' | 'sha1';
  /** Encrypt the assertion for this certificate (the application's, from its metadata). */
  encryptFor?: string;
  encryptionAlgorithm?: 'http://www.w3.org/2009/xmlenc11#aes256-gcm' | 'http://www.w3.org/2001/04/xmlenc#aes256-cbc';
  audience?: string;
  recipient?: string;
  destination?: string | null;
  inResponseTo?: string | null;
  subjectInResponseTo?: string | null;
  issuer?: string;
  /** Shift every time in the assertion by this many milliseconds (negative = in the past). */
  shiftMs?: number;
  /** How long the assertion lasts (default 5 minutes). */
  lifetimeMs?: number;
  assertionId?: string;
  status?: string;
  authnContextClassRef?: string;
  user?: Partial<FakeSamlUser>;
  /** Change the final XML (after signing): for signature wrapping, DTDs and other hand-made attacks. */
  mutate?: (xml: string) => string;
}

export interface FakeSamlIdp {
  entityId: string;
  port: number;
  ssoUrl: string;
  sloUrl: string;
  metadataUrl: string;
  /** Its signing certificate (PEM). */
  cert: string;
  /** A second certificate, of a key it does not sign with (for certificate rollover tests). */
  otherCert: string;
  user: FakeSamlUser;
  /** Options applied to the responses the /sso page makes (for a browser run). */
  pageOptions: RespondOptions;
  hits: Record<string, number>;
  metadataXml(): string;
  /** Reads the AuthnRequest out of the redirect address the application sent the browser to. */
  readRequest(redirectUrl: string): AuthnRequestFacts;
  /** Makes the response to that request: the form fields to post, and where. */
  respond(redirectUrl: string, opts?: RespondOptions): Promise<{ SAMLResponse: string; RelayState: string; acsUrl: string; xml: string }>;
  close(): Promise<void>;
}

function keyAndCert(name: string): { key: KeyObject; cert: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { key: privateKey, cert: selfSignedCertificate(publicKey, privateKey, name, 2) };
}

function signXml(xml: string, element: 'Assertion' | 'Response', key: KeyObject, cert: string, alg: 'sha256' | 'sha1'): string {
  const sig = new SignedXml({
    privateKey: key.export({ type: 'pkcs8', format: 'pem' }),
    publicCert: cert,
    signatureAlgorithm: alg === 'sha1' ? 'http://www.w3.org/2000/09/xmldsig#rsa-sha1' : 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  const path = element === 'Response' ? "/*[local-name(.)='Response']" : "//*[local-name(.)='Assertion']";
  sig.addReference({
    xpath: path,
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
    digestAlgorithm: alg === 'sha1' ? 'http://www.w3.org/2000/09/xmldsig#sha1' : 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  sig.computeSignature(xml, { location: { reference: `${path}/*[local-name(.)='Issuer']`, action: 'after' } });
  return sig.getSignedXml();
}

export async function startFakeSamlIdp(opts: { port?: number } = {}): Promise<FakeSamlIdp> {
  const signer = keyAndCert('Example identity provider (test)');
  const foreign = keyAndCert('Somebody else (test)');
  const hits: Record<string, number> = {};
  const server: Server = createServer();
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  const idp: FakeSamlIdp = {
    entityId: `${base}/idp`,
    port,
    ssoUrl: `${base}/sso`,
    sloUrl: `${base}/slo`,
    metadataUrl: `${base}/metadata`,
    cert: signer.cert,
    otherCert: foreign.cert,
    user: { nameId: 'person-0001', attributes: { email: ['person@example.test'], displayName: ['Test Person'], groups: [] } },
    pageOptions: {},
    hits,
    metadataXml() {
      const body = signer.cert.replace(/-----(BEGIN|END) CERTIFICATE-----|\s+/g, '');
      return `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="${esc(idp.entityId)}">
  <md:IDPSSODescriptor protocolSupportEnumeration="${P}" WantAuthnRequestsSigned="false">
    <md:KeyDescriptor use="signing"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${body}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
    <md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${esc(idp.sloUrl)}"/>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:persistent</md:NameIDFormat>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${esc(idp.ssoUrl)}/post"/>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${esc(idp.ssoUrl)}"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>
`;
    },
    readRequest(redirectUrl) {
      const u = new URL(redirectUrl);
      const raw = u.searchParams.get('SAMLRequest');
      if (!raw) throw new Error('no SAMLRequest');
      const xml = inflateRawSync(Buffer.from(raw, 'base64')).toString('utf8');
      const attr = (name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(xml)?.[1] ?? '';
      return {
        id: attr('ID'), acsUrl: attr('AssertionConsumerServiceURL').replace(/&amp;/g, '&'),
        issuer: /<(?:\w+:)?Issuer[^>]*>([^<]*)</.exec(xml)?.[1] ?? '',
        relayState: u.searchParams.get('RelayState') ?? '', forceAuthn: attr('ForceAuthn') === 'true',
        signed: u.searchParams.has('Signature'),
        authnContext: [...xml.matchAll(/<(?:\w+:)?AuthnContextClassRef[^>]*>([^<]*)</g)].map((m) => m[1]),
      };
    },
    async respond(redirectUrl, o = {}) {
      const req = idp.readRequest(redirectUrl);
      const now = Date.now() + (o.shiftMs ?? 0);
      const life = o.lifetimeMs ?? 5 * 60_000;
      const user = { ...idp.user, ...o.user, attributes: { ...idp.user.attributes, ...(o.user?.attributes ?? {}) } };
      const issuer = o.issuer ?? idp.entityId;
      const assertionId = o.assertionId ?? `_a${randomBytes(16).toString('hex')}`;
      const inResponseTo = o.inResponseTo === undefined ? req.id : o.inResponseTo;
      const subjectIrt = o.subjectInResponseTo === undefined ? inResponseTo : o.subjectInResponseTo;
      const destination = o.destination === undefined ? req.acsUrl : o.destination;
      const attributes = Object.entries(user.attributes).map(([name, values]) =>
        `<saml:Attribute Name="${esc(name)}">${values.map((v) => `<saml:AttributeValue>${esc(v)}</saml:AttributeValue>`).join('')}</saml:Attribute>`).join('');
      let assertion = `<saml:Assertion xmlns:saml="${A}" ID="${assertionId}" Version="2.0" IssueInstant="${iso(now)}">`
        + `<saml:Issuer>${esc(issuer)}</saml:Issuer>`
        + `<saml:Subject><saml:NameID Format="${esc(user.nameIdFormat ?? 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent')}">${esc(user.nameId)}</saml:NameID>`
        + `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData`
        + `${subjectIrt === null ? '' : ` InResponseTo="${esc(subjectIrt)}"`} NotOnOrAfter="${iso(now + life)}" Recipient="${esc(o.recipient ?? req.acsUrl)}"/>`
        + '</saml:SubjectConfirmation></saml:Subject>'
        + `<saml:Conditions NotBefore="${iso(now - 30_000)}" NotOnOrAfter="${iso(now + life)}">`
        + `<saml:AudienceRestriction><saml:Audience>${esc(o.audience ?? req.issuer)}</saml:Audience></saml:AudienceRestriction></saml:Conditions>`
        + `<saml:AuthnStatement AuthnInstant="${iso(now - 1000)}" SessionIndex="_s${randomBytes(8).toString('hex')}">`
        + `<saml:AuthnContext><saml:AuthnContextClassRef>${esc(o.authnContextClassRef ?? 'urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport')}</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>`
        + (attributes ? `<saml:AttributeStatement>${attributes}</saml:AttributeStatement>` : '')
        + '</saml:Assertion>';
      const key = o.foreignKey ? foreign : signer;
      if (o.signAssertion !== false) assertion = signXml(assertion, 'Assertion', key.key, key.cert, o.sigAlg ?? 'sha256');
      if (o.encryptFor) {
        const rsaPub = new X509Certificate(o.encryptFor).publicKey.export({ type: 'spki', format: 'pem' });
        const encrypted = await promisify(xmlenc.encrypt).bind(xmlenc)(assertion, {
          rsa_pub: rsaPub, pem: o.encryptFor,
          encryptionAlgorithm: o.encryptionAlgorithm ?? 'http://www.w3.org/2009/xmlenc11#aes256-gcm',
          keyEncryptionAlgorithm: 'http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p',
        }) as string;
        assertion = `<saml:EncryptedAssertion xmlns:saml="${A}">${encrypted}</saml:EncryptedAssertion>`;
      }
      const status = o.status ?? 'urn:oasis:names:tc:SAML:2.0:status:Success';
      let xml = `<samlp:Response xmlns:samlp="${P}" xmlns:saml="${A}" ID="_r${randomBytes(16).toString('hex')}" Version="2.0" IssueInstant="${iso(now)}"`
        + `${destination === null ? '' : ` Destination="${esc(destination)}"`}${inResponseTo === null ? '' : ` InResponseTo="${esc(inResponseTo)}"`}>`
        + `<saml:Issuer>${esc(issuer)}</saml:Issuer>`
        + `<samlp:Status><samlp:StatusCode Value="${esc(status)}"/></samlp:Status>`
        + (status.endsWith(':Success') ? assertion : '')
        + '</samlp:Response>';
      if (o.signResponse) xml = signXml(xml, 'Response', key.key, key.cert, o.sigAlg ?? 'sha256');
      if (o.mutate) xml = o.mutate(xml);
      return { SAMLResponse: Buffer.from(xml, 'utf8').toString('base64'), RelayState: req.relayState, acsUrl: req.acsUrl, xml };
    },
    close: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };

  server.on('request', (req, res) => {
    const url = new URL(req.url ?? '/', base);
    hits[url.pathname] = (hits[url.pathname] ?? 0) + 1;
    if (url.pathname === '/metadata') {
      res.writeHead(200, { 'content-type': 'application/samlmetadata+xml' });
      return res.end(idp.metadataXml());
    }
    if (url.pathname === '/slo') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('signed out');
    }
    if (url.pathname === '/sso') {
      idp.respond(url.toString(), idp.pageOptions).then((r) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Example identity provider</title>
<style>body{font-family:system-ui,sans-serif;background:#eef2f6;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#fff;padding:32px;border-radius:12px;box-shadow:0 2px 12px #0002;max-width:360px}h1{font-size:20px}
button{background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:8px;border:0;font-size:15px}</style></head>
<body><main><h1>Example identity provider (SAML)</h1><p>A stand-in provider for trials. Continue as <strong>${esc(idp.user.attributes.email?.[0] ?? idp.user.nameId)}</strong>?</p>
<form method="post" action="${esc(r.acsUrl)}"><input type="hidden" name="SAMLResponse" value="${esc(r.SAMLResponse)}">
<input type="hidden" name="RelayState" value="${esc(r.RelayState)}"><button id="continue" type="submit">Continue</button></form></main></body></html>`);
      }, (err) => { res.writeHead(400, { 'content-type': 'text/plain' }); res.end(String(err?.message ?? err)); });
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
  return idp;
}
