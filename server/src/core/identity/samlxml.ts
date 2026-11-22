// Hardened reading of SAML 2.0 XML (E02-10), before and after the signature checks that
// @node-saml/node-saml does.
//
// Before: every SAML message and metadata document goes through `parseXml`, which refuses document
// type declarations (so no external entities, no entity expansion), anything over a size and
// element limit, and malformed XML. `inspectResponse` then refuses what this application never
// accepts, whatever the signature says: more than one assertion anywhere in the message (signature
// wrapping), repeated IDs, a signature anywhere but directly on the Response or the Assertion,
// signature, digest, canonicalization and encryption algorithms outside a short allow-list
// (RSA-SHA256 or stronger, no comments, AES-GCM with RSA-OAEP).
//
// After: `readAssertion` reads the assertion the library verified (the signed bytes it returns,
// not the message as received) for the checks the library leaves to its caller: the bearer
// confirmation's Recipient and InResponseTo, the assertion ID for replay protection, and the
// authentication context.
import { DOMParser, type Document, type Element, type Node } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { IdentityError } from './types.ts';

export const NS = {
  protocol: 'urn:oasis:names:tc:SAML:2.0:protocol',
  assertion: 'urn:oasis:names:tc:SAML:2.0:assertion',
  metadata: 'urn:oasis:names:tc:SAML:2.0:metadata',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  xenc: 'http://www.w3.org/2001/04/xmlenc#',
} as const;

export const BINDING = {
  redirect: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
  post: 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
} as const;

export const NAMEID = {
  persistent: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
  email: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  unspecified: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
  transient: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
} as const;

/** Algorithms accepted on signatures. SHA-1 and HMAC are not. */
export const SIGNATURE_ALGORITHMS = new Set([
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  'http://www.w3.org/2007/05/xmldsig-more#sha256-rsa-MGF1',
  'http://www.w3.org/2001/04/xmldsig-more#rsa-sha512',
]);
export const DIGEST_ALGORITHMS = new Set(['http://www.w3.org/2001/04/xmlenc#sha256', 'http://www.w3.org/2001/04/xmlenc#sha512']);
/** Canonicalization and transforms: without comments only (comments in signed text hide what is signed). */
export const TRANSFORMS = new Set([
  'http://www.w3.org/2001/10/xml-exc-c14n#',
  'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
]);
/** Encrypted assertions: AES-GCM content, RSA-OAEP key transport (no CBC or RSA 1.5 padding oracles). */
export const ENCRYPTION_ALGORITHMS = new Set([
  'http://www.w3.org/2009/xmlenc11#aes128-gcm',
  'http://www.w3.org/2009/xmlenc11#aes256-gcm',
  'http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p',
]);
const OAEP_DIGESTS = new Set([
  'http://www.w3.org/2000/09/xmldsig#sha1', 'http://www.w3.org/2001/04/xmlenc#sha256', 'http://www.w3.org/2001/04/xmlenc#sha512',
  'http://www.w3.org/2000/09/xmldsig#sha256', 'http://www.w3.org/2000/09/xmldsig#sha512',
]);

/** Limits for one SAML message (a response after base64 decoding). */
export const LIMITS = { messageBytes: 256 * 1024, metadataBytes: 1024 * 1024, elements: 5000, depth: 40 };

const ELEMENT = 1;

/**
 * Parses XML that came from outside. Refuses document type declarations (and so every kind of
 * entity), markup declarations, processing instructions other than the XML declaration, NUL
 * characters, malformed documents, and documents over the byte, element or depth limits.
 */
/** A parsed document that has a root element (parseXml refuses one without). */
export type XmlDocument = Document & { readonly documentElement: Element };

export function parseXml(text: string, maxBytes: number = LIMITS.messageBytes): XmlDocument {
  if (typeof text !== 'string' || !text.trim()) throw new IdentityError('empty XML', 'The XML is empty.');
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new IdentityError('XML too large', `The XML is larger than ${Math.round(maxBytes / 1024)} KB.`);
  if (text.includes('\u0000') || text.includes('\uFFFD')) throw new IdentityError('XML not UTF-8', 'The XML is not readable UTF-8 text.');
  // No DTD: no external entities (XXE), no entity expansion ("billion laughs"). SAML never needs one.
  if (/<!DOCTYPE|<!ENTITY|<!ELEMENT|<!ATTLIST/i.test(text)) throw new IdentityError('XML document type declaration refused', 'XML with a document type declaration (DTD) is not accepted.');
  if (/<!(?!--|\[CDATA\[)/.test(text)) throw new IdentityError('XML markup declaration refused', 'The XML holds a markup declaration, which is not accepted.');
  if (/<\?(?!xml\s)[^?]*\?>/i.test(text.replace(/^\uFEFF?\s*<\?xml\s[^?]*\?>/, ''))) {
    throw new IdentityError('XML processing instruction refused', 'The XML holds a processing instruction, which is not accepted.');
  }
  // Every warning and error refuses the document, not only fatal ones (the parser recovers from some
  // malformed input); a fatal error stops the parser with a ParseError.
  const problems: string[] = [];
  let doc: Document;
  try {
    doc = new DOMParser({ locator: true, onError: (_level, message) => { problems.push(message); } }).parseFromString(text, 'text/xml');
  } catch {
    throw new IdentityError('malformed XML', 'The XML is not well formed.');
  }
  if (problems.length || !doc || !doc.documentElement) throw new IdentityError('malformed XML', 'The XML is not well formed.');
  // Element count and depth, iteratively (no recursion on attacker-shaped input).
  let count = 0;
  const stack: { node: Node; depth: number }[] = [{ node: doc.documentElement, depth: 1 }];
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (node.nodeType !== ELEMENT) continue;
    if (++count > LIMITS.elements) throw new IdentityError('XML has too many elements', 'The XML has too many elements.');
    if (depth > LIMITS.depth) throw new IdentityError('XML nested too deeply', 'The XML is nested too deeply.');
    for (let c = node.firstChild; c; c = c.nextSibling) if (c.nodeType === ELEMENT) stack.push({ node: c, depth: depth + 1 });
  }
  return doc as XmlDocument;
}

/** Every element below (and including) `root`, in document order. */
function elements(root: Node): Element[] {
  const out: Element[] = [];
  const walk: Node[] = [root];
  while (walk.length) {
    const n = walk.pop()!;
    if (n.nodeType === ELEMENT) out.push(n as Element);
    const kids: Node[] = [];
    for (let c = n.firstChild; c; c = c.nextSibling) kids.push(c);
    walk.push(...kids.reverse());
  }
  return out;
}
const children = (el: Element, ns: string, local: string): Element[] => {
  const out: Element[] = [];
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === ELEMENT && (c as Element).localName === local && (c as Element).namespaceURI === ns) out.push(c as Element);
  }
  return out;
};
const child = (el: Element | null | undefined, ns: string, local: string): Element | null => (el ? children(el, ns, local)[0] ?? null : null);
const text = (el: Element | null | undefined) => (el?.textContent ?? '').trim();
const attr = (el: Element | null | undefined, name: string): string | null => (el && el.hasAttribute(name) ? el.getAttribute(name) : null);

/** Checks every signature in a message or assertion: placement and algorithms. */
function checkSignatures(doc: XmlDocument, allowedParents: Element[]): void {
  for (const sig of elements(doc.documentElement).filter((e) => e.localName === 'Signature')) {
    if (sig.namespaceURI !== NS.ds) throw new IdentityError('signature in an unknown namespace');
    if (!allowedParents.includes(sig.parentNode as Element)) throw new IdentityError('signature in an unexpected place');
    const signedInfo = child(sig, NS.ds, 'SignedInfo');
    const method = attr(child(signedInfo, NS.ds, 'SignatureMethod'), 'Algorithm');
    if (!method || !SIGNATURE_ALGORITHMS.has(method)) throw new IdentityError(`signature algorithm not accepted (${String(method).slice(0, 80)})`);
    const c14n = attr(child(signedInfo, NS.ds, 'CanonicalizationMethod'), 'Algorithm');
    if (!c14n || !TRANSFORMS.has(c14n) || c14n.endsWith('enveloped-signature')) throw new IdentityError(`canonicalization not accepted (${String(c14n).slice(0, 80)})`);
    const refs = signedInfo ? children(signedInfo, NS.ds, 'Reference') : [];
    if (refs.length !== 1) throw new IdentityError('a signature must have exactly one reference');
    for (const ref of refs) {
      const digest = attr(child(ref, NS.ds, 'DigestMethod'), 'Algorithm');
      if (!digest || !DIGEST_ALGORITHMS.has(digest)) throw new IdentityError(`digest algorithm not accepted (${String(digest).slice(0, 80)})`);
      const transforms = children(child(ref, NS.ds, 'Transforms') ?? sig, NS.ds, 'Transform');
      if (transforms.length > 2) throw new IdentityError('too many signature transforms');
      for (const t of transforms) {
        const alg = attr(t, 'Algorithm');
        if (!alg || !TRANSFORMS.has(alg)) throw new IdentityError(`signature transform not accepted (${String(alg).slice(0, 80)})`);
      }
      // The reference must name its own parent: a signature covers the element it sits in, and nothing else.
      const uri = attr(ref, 'URI') ?? '';
      const parentId = attr(sig.parentNode as Element, 'ID');
      if (!parentId || uri !== `#${parentId}`) throw new IdentityError('signature does not cover the element it is in');
    }
  }
}

/** Refuses repeated ID values anywhere (an ID must name one element, or a signature could point at either). */
function checkUniqueIds(doc: XmlDocument): void {
  const seen = new Set<string>();
  for (const el of elements(doc.documentElement)) {
    for (const name of ['ID', 'Id', 'id', 'AssertionID']) {
      const v = attr(el, name);
      if (v === null) continue;
      if (seen.has(v)) throw new IdentityError('repeated ID in the message');
      seen.add(v);
    }
  }
}

export interface ResponseFacts {
  inResponseTo: string | null;
  destination: string | null;
  issuer: string | null;
  /** The Response carries its own signature (it is then checked by the library). */
  responseSigned: boolean;
  encrypted: boolean;
  /** The EncryptedAssertion element, serialized with the namespaces it uses, for decryption. */
  encryptedXml: string | null;
  /** Status code (last part, for example Success, Responder, AuthnFailed). */
  status: string;
  subStatus: string | null;
}

/** Decodes the HTTP-POST binding's SAMLResponse (base64) into text, within the size limit. */
export function decodeSamlResponse(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new IdentityError('no SAMLResponse');
  const compact = value.replace(/\s+/g, '');
  if (compact.length > Math.ceil(LIMITS.messageBytes / 3) * 4 + 4) throw new IdentityError('SAMLResponse too large');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) throw new IdentityError('SAMLResponse is not base64');
  const buf = Buffer.from(compact, 'base64');
  const xml = buf.toString('utf8');
  if (!Buffer.from(xml, 'utf8').equals(buf)) throw new IdentityError('SAMLResponse is not UTF-8');
  return xml;
}

/** The checks made on a SAML response before any signature is looked at. */
export function inspectResponse(xml: string): ResponseFacts {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  if (root.localName !== 'Response' || root.namespaceURI !== NS.protocol) throw new IdentityError('not a SAML response');
  if (attr(root, 'Version') !== '2.0') throw new IdentityError('not SAML 2.0');
  checkUniqueIds(doc);
  const all = elements(root);
  const assertions = all.filter((e) => e.localName === 'Assertion');
  const encrypted = all.filter((e) => e.localName === 'EncryptedAssertion');
  // Signature wrapping defense: one assertion in the whole message, as a direct child of the Response.
  if (assertions.length + encrypted.length > 1) throw new IdentityError('more than one assertion in the message');
  const one = assertions[0] ?? encrypted[0];
  if (one && (one.parentNode !== root || one.namespaceURI !== NS.assertion)) throw new IdentityError('assertion in an unexpected place');
  checkSignatures(doc, assertions[0] ? [root, assertions[0]] : [root]);
  if (encrypted[0]) {
    for (const m of elements(encrypted[0]).filter((e) => e.localName === 'EncryptionMethod')) {
      const alg = attr(m, 'Algorithm');
      if (!alg || !ENCRYPTION_ALGORITHMS.has(alg)) throw new IdentityError(`encryption algorithm not accepted (${String(alg).slice(0, 80)})`);
      for (const d of children(m, NS.ds, 'DigestMethod')) {
        if (!OAEP_DIGESTS.has(attr(d, 'Algorithm') ?? '')) throw new IdentityError('key transport digest not accepted');
      }
    }
  }
  const statusCode = child(child(root, NS.protocol, 'Status'), NS.protocol, 'StatusCode');
  const value = attr(statusCode, 'Value') ?? '';
  const sub = attr(child(statusCode, NS.protocol, 'StatusCode'), 'Value');
  return {
    inResponseTo: attr(root, 'InResponseTo'),
    destination: attr(root, 'Destination'),
    issuer: text(child(root, NS.assertion, 'Issuer')) || null,
    responseSigned: children(root, NS.ds, 'Signature').length > 0,
    encrypted: Boolean(encrypted[0]),
    encryptedXml: encrypted[0] ? encrypted[0].toString() : null,
    status: value.split(':').pop() ?? '',
    subStatus: sub ? sub.split(':').pop() ?? null : null,
  };
}

/** The same checks on an assertion that arrived encrypted, once decrypted. */
export function inspectDecryptedAssertion(xml: string): void {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  if (root.localName !== 'Assertion' || root.namespaceURI !== NS.assertion) throw new IdentityError('encrypted content is not an assertion');
  checkUniqueIds(doc);
  if (elements(root).filter((e) => e.localName === 'Assertion').length !== 1) throw new IdentityError('more than one assertion in the message');
  checkSignatures(doc, [root]);
}

export interface AssertionFacts {
  id: string;
  issuer: string;
  nameId: string;
  nameIdFormat: string | null;
  nameQualifier: string | null;
  spNameQualifier: string | null;
  sessionIndex: string | null;
  /** The latest moment the assertion can be used (for how long its ID is remembered). */
  notOnOrAfter: Date | null;
  authnContextClassRef: string | null;
  /** Attribute name to values (text values only). */
  attributes: Record<string, string[]>;
}

/**
 * Reads the verified assertion and makes the checks the library leaves to its caller: a bearer
 * confirmation for this request (InResponseTo) at this address (Recipient), still in time.
 */
export function readAssertion(verifiedXml: string, expect: { acsUrl: string; requestId: string; skewMs: number }): AssertionFacts {
  const doc = parseXml(verifiedXml);
  const a = doc.documentElement;
  if (a.localName !== 'Assertion' || a.namespaceURI !== NS.assertion) throw new IdentityError('verified content is not an assertion');
  if (attr(a, 'Version') !== '2.0') throw new IdentityError('assertion is not SAML 2.0');
  const id = attr(a, 'ID');
  if (!id || id.length > 256) throw new IdentityError('assertion has no usable ID');
  const subject = child(a, NS.assertion, 'Subject');
  const nameIdEl = child(subject, NS.assertion, 'NameID');
  if (!nameIdEl) throw new IdentityError(child(subject, NS.assertion, 'EncryptedID') ? 'encrypted NameID is not supported' : 'assertion has no NameID');
  const now = Date.now();
  const time = (v: string | null) => {
    if (v === null) return null;
    const t = Date.parse(v);
    if (!Number.isFinite(t) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(v)) throw new IdentityError('unreadable time in assertion');
    return t;
  };
  // A bearer confirmation naming this request and this address, in time (SAML profiles 4.1.4.2).
  let confirmed: number | null = null;
  for (const sc of children(subject!, NS.assertion, 'SubjectConfirmation')) {
    if (attr(sc, 'Method') !== 'urn:oasis:names:tc:SAML:2.0:cm:bearer') continue;
    const data = child(sc, NS.assertion, 'SubjectConfirmationData');
    if (!data) continue;
    if (attr(data, 'Recipient') !== expect.acsUrl || attr(data, 'InResponseTo') !== expect.requestId) continue;
    const nb = time(attr(data, 'NotBefore'));
    const noa = time(attr(data, 'NotOnOrAfter'));
    if (noa === null) continue; // required for bearer confirmations
    if (nb !== null && now + expect.skewMs < nb) continue;
    if (now - expect.skewMs >= noa) continue;
    confirmed = noa;
    break;
  }
  if (confirmed === null) throw new IdentityError('no bearer confirmation for this request, address and time');
  const conditions = child(a, NS.assertion, 'Conditions');
  const condEnd = time(attr(conditions, 'NotOnOrAfter'));
  const authn = child(a, NS.assertion, 'AuthnStatement');
  if (!authn) throw new IdentityError('assertion has no authentication statement');
  const classRef = text(child(child(authn, NS.assertion, 'AuthnContext'), NS.assertion, 'AuthnContextClassRef'));
  const attributes: Record<string, string[]> = {};
  for (const statement of children(a, NS.assertion, 'AttributeStatement')) {
    for (const at of children(statement, NS.assertion, 'Attribute')) {
      const name = attr(at, 'Name');
      if (!name || name.length > 300) continue;
      const values = children(at, NS.assertion, 'AttributeValue')
        .filter((v) => !elements(v).slice(1).length) // text values only
        .map((v) => text(v)).filter((v) => v.length > 0 && v.length <= 1000);
      attributes[name] = [...(attributes[name] ?? []), ...values].slice(0, 500);
    }
  }
  return {
    id,
    issuer: text(child(a, NS.assertion, 'Issuer')),
    nameId: text(nameIdEl),
    nameIdFormat: attr(nameIdEl, 'Format'),
    nameQualifier: attr(nameIdEl, 'NameQualifier'),
    spNameQualifier: attr(nameIdEl, 'SPNameQualifier'),
    sessionIndex: attr(authn, 'SessionIndex'),
    notOnOrAfter: new Date(Math.max(confirmed, condEnd ?? 0) + expect.skewMs),
    authnContextClassRef: classRef || null,
    attributes,
  };
}

// ---------- identity provider metadata ----------

export interface IdpMetadata {
  entityId: string;
  ssoUrl: string;
  sloUrl: string | null;
  /** Signing certificates (bare base64), in the order given. */
  certificates: string[];
  wantAuthnRequestsSigned: boolean;
  nameIdFormats: string[];
  /** E02-28: the earliest validUntil on the document or the entity (ISO), or null when it states none. */
  validUntil: string | null;
}

/** Reads an identity provider's metadata (an EntityDescriptor, or an EntitiesDescriptor with one identity provider). */
export function parseIdpMetadata(xml: string): IdpMetadata {
  const doc = parseXml(xml, LIMITS.metadataBytes);
  const root = doc.documentElement;
  if (root.namespaceURI !== NS.metadata || !['EntityDescriptor', 'EntitiesDescriptor'].includes(root.localName ?? '')) {
    throw new IdentityError('not SAML metadata', 'This is not SAML 2.0 metadata (an EntityDescriptor).');
  }
  const entities = (root.localName === 'EntityDescriptor' ? [root] : elements(root).filter((e) => e.localName === 'EntityDescriptor' && e.namespaceURI === NS.metadata))
    .filter((e) => child(e, NS.metadata, 'IDPSSODescriptor'));
  if (entities.length !== 1) {
    throw new IdentityError('metadata names no single identity provider',
      entities.length ? `The metadata describes ${entities.length} identity providers. Paste the metadata of the one you want.` : 'The metadata describes no identity provider (no IDPSSODescriptor).');
  }
  const entity = entities[0];
  const idp = child(entity, NS.metadata, 'IDPSSODescriptor')!;
  const entityId = attr(entity, 'entityID') ?? '';
  if (!entityId) throw new IdentityError('metadata has no entity ID', 'The metadata has no entityID.');
  if (!(attr(idp, 'protocolSupportEnumeration') ?? '').split(/\s+/).includes(NS.protocol)) {
    throw new IdentityError('metadata is not SAML 2.0', 'The identity provider does not say it supports SAML 2.0.');
  }
  const endpoint = (local: string) => children(idp, NS.metadata, local).find((e) => attr(e, 'Binding') === BINDING.redirect);
  const sso = endpoint('SingleSignOnService');
  if (!sso || !attr(sso, 'Location')) throw new IdentityError('metadata has no redirect sign-in address', 'The identity provider offers no sign-in address for the HTTP-Redirect binding.');
  const certificates: string[] = [];
  for (const kd of children(idp, NS.metadata, 'KeyDescriptor')) {
    const use = attr(kd, 'use');
    if (use && use !== 'signing') continue;
    for (const c of elements(kd).filter((e) => e.localName === 'X509Certificate' && e.namespaceURI === NS.ds)) {
      const b64 = text(c).replace(/\s+/g, '');
      if (b64 && !certificates.includes(b64)) certificates.push(b64);
    }
  }
  if (!certificates.length) throw new IdentityError('metadata has no signing certificate', 'The metadata holds no signing certificate.');
  return {
    entityId,
    ssoUrl: attr(sso, 'Location')!,
    sloUrl: attr(endpoint('SingleLogoutService'), 'Location'),
    certificates,
    wantAuthnRequestsSigned: attr(idp, 'WantAuthnRequestsSigned') === 'true',
    nameIdFormats: children(idp, NS.metadata, 'NameIDFormat').map((e) => text(e)).filter(Boolean).slice(0, 10),
    validUntil: [attr(root, 'validUntil'), attr(entity, 'validUntil')].map((v) => (v ? Date.parse(v) : NaN)).filter(Number.isFinite)
      .sort((a, b) => a - b).map((t) => new Date(t).toISOString())[0] ?? null,
  };
}

// ---------- sign-outs started at the identity provider (E02-27) ----------

export interface LogoutRequestFacts {
  id: string;
  issuer: string;
  destination: string | null;
  issueInstant: number;
  notOnOrAfter: number | null;
  nameId: string;
  nameIdFormat: string | null;
  sessionIndexes: string[];
  /** The request carries an XML signature on its root (HTTP-POST binding). */
  signed: boolean;
}

/**
 * The checks made on a LogoutRequest before (and beside) the library's signature check: hardened
 * parsing, one signature at most and only on the root element with accepted algorithms, unique IDs,
 * SAML 2.0, a readable issue time, a NameID in the clear. `requireXmlSignature` for the HTTP-POST
 * binding (the HTTP-Redirect binding signs the query string instead).
 */
export function inspectLogoutRequest(xml: string, opts: { requireXmlSignature: boolean }): LogoutRequestFacts {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  if (root.localName !== 'LogoutRequest' || root.namespaceURI !== NS.protocol) throw new IdentityError('not a SAML LogoutRequest');
  if (attr(root, 'Version') !== '2.0') throw new IdentityError('LogoutRequest is not SAML 2.0');
  checkUniqueIds(doc);
  checkSignatures(doc, [root]);
  const signed = children(root, NS.ds, 'Signature').length === 1;
  if (opts.requireXmlSignature && !signed) throw new IdentityError('LogoutRequest is not signed');
  const id = attr(root, 'ID');
  if (!id || id.length > 256) throw new IdentityError('LogoutRequest has no usable ID');
  const time = (v: string | null) => {
    if (v === null) return null;
    const t = Date.parse(v);
    if (!Number.isFinite(t) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(v)) throw new IdentityError('unreadable time in LogoutRequest');
    return t;
  };
  const issueInstant = time(attr(root, 'IssueInstant'));
  if (issueInstant === null) throw new IdentityError('LogoutRequest has no IssueInstant');
  if (child(root, NS.assertion, 'EncryptedID') || child(root, NS.assertion, 'BaseID')) throw new IdentityError('LogoutRequest names the person in a way that is not supported (encrypted or base ID)');
  const nameIdEl = child(root, NS.assertion, 'NameID');
  const nameId = text(nameIdEl);
  if (!nameId || nameId.length > 255) throw new IdentityError('LogoutRequest has no usable NameID');
  const sessionIndexes = children(root, NS.protocol, 'SessionIndex').map((e) => text(e)).filter((s) => s && s.length <= 256);
  if (sessionIndexes.length > 50) throw new IdentityError('LogoutRequest has too many session indexes');
  return {
    id,
    issuer: text(child(root, NS.assertion, 'Issuer')),
    destination: attr(root, 'Destination'),
    issueInstant,
    notOnOrAfter: time(attr(root, 'NotOnOrAfter')),
    nameId,
    nameIdFormat: attr(nameIdEl, 'Format'),
    sessionIndexes,
    signed,
  };
}

// ---------- signed metadata (E02-28) ----------

/**
 * Checks the signature on a metadata document against the one certificate an administrator pinned
 * for it, and returns what that signature covers (the signed bytes, canonicalized): only those are
 * read afterwards, never the document as received. The signature must be the only one, directly on
 * the root element, covering the root (a reference to its ID, or the whole document), with the
 * same algorithms accepted as for sign-in.
 */
export function verifyMetadataSignature(xml: string, certPem: string): string {
  const doc = parseXml(xml, LIMITS.metadataBytes);
  const root = doc.documentElement;
  const signatures = elements(root).filter((e) => e.localName === 'Signature' && e.namespaceURI === NS.ds);
  if (!signatures.length) throw new IdentityError('metadata is not signed', 'The metadata is not signed, but a metadata signing certificate is set.');
  if (signatures.length > 1 || signatures[0].parentNode !== root) throw new IdentityError('metadata signature in an unexpected place', 'The metadata must carry exactly one signature, on its root element.');
  const sig = signatures[0];
  const signedInfo = child(sig, NS.ds, 'SignedInfo');
  const method = attr(child(signedInfo, NS.ds, 'SignatureMethod'), 'Algorithm');
  if (!method || !SIGNATURE_ALGORITHMS.has(method)) throw new IdentityError('metadata signature algorithm not accepted', 'The metadata is signed with an algorithm that is not accepted (RSA-SHA256 or stronger is needed).');
  const refs = signedInfo ? children(signedInfo, NS.ds, 'Reference') : [];
  if (refs.length !== 1) throw new IdentityError('metadata signature must have one reference', 'The metadata signature must cover the whole document.');
  const digest = attr(child(refs[0], NS.ds, 'DigestMethod'), 'Algorithm');
  if (!digest || !DIGEST_ALGORITHMS.has(digest)) throw new IdentityError('metadata digest algorithm not accepted', 'The metadata signature uses a digest that is not accepted (SHA-256 or stronger is needed).');
  for (const t of children(child(refs[0], NS.ds, 'Transforms') ?? sig, NS.ds, 'Transform')) {
    if (!TRANSFORMS.has(attr(t, 'Algorithm') ?? '')) throw new IdentityError('metadata signature transform not accepted', 'The metadata signature uses a transform that is not accepted.');
  }
  const uri = attr(refs[0], 'URI') ?? '';
  const rootId = attr(root, 'ID');
  if (uri !== '' && !(rootId && uri === `#${rootId}`)) throw new IdentityError('metadata signature does not cover the root', 'The metadata signature must cover the whole document.');
  checkUniqueIds(doc);
  let verified: SignedXml;
  try {
    verified = new SignedXml({ publicCert: certPem, getCertFromKeyInfo: () => null });
    verified.loadSignature(sig);
    if (!verified.checkSignature(xml)) throw new Error('bad');
  } catch {
    throw new IdentityError('metadata signature not valid', 'The metadata signature is not valid for the metadata signing certificate.');
  }
  const signed = verified.getSignedReferences();
  if (signed.length !== 1 || !signed[0]) throw new IdentityError('metadata signature covers nothing', 'The metadata signature must cover the whole document.');
  return signed[0];
}
