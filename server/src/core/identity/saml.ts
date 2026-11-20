// SAML 2.0 sign-in (E02-10): Web Browser SSO, initiated here. The AuthnRequest goes out with the
// HTTP-Redirect binding; the identity provider posts its Response back (HTTP-POST binding) to this
// provider's assertion consumer service.
//
// Signature checking is @node-saml/node-saml's (on xml-crypto and @xmldom/xmldom): only the
// configured certificates are trusted, never a key carried in the message; the signed bytes, not
// the message as received, are what is read; one assertion; InResponseTo, audience, issuer and
// time windows checked. Around it, this file and samlxml.ts add what this application insists on:
// no DTDs, size limits, an algorithm allow-list (RSA-SHA256 or stronger), exact Destination and
// Recipient, a bearer confirmation for this very request, and (in sso.ts) assertion IDs that work once.
import { generateKeyPair, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { SAML, ValidateInResponseTo, type CacheProvider, type Profile } from '@node-saml/node-saml';
import xmlenc from 'xml-encryption';
import { cleanCommonConfig } from './config.ts';
import { addressProblem } from './http.ts';
import {
  BINDING, decodeSamlResponse, inspectDecryptedAssertion, inspectResponse, NAMEID, NS, readAssertion, type AssertionFacts,
} from './samlxml.ts';
import { certificateBody, describeCertificate, readCertificates, selfSignedCertificate } from './x509.ts';
import { IdentityError, type ExternalIdentity, type ProviderDriver, type ProviderRecord, type SamlConfig, type TestResult } from './types.ts';

/** Clock difference tolerated between this server and the identity provider. */
export const SKEW_MS = 60_000;
/** An assertion is not accepted later than this after it was issued, whatever it says. */
const MAX_ASSERTION_AGE_MS = 10 * 60_000;
/** How long a request ID stays answerable (the same as a sign-in in flight). */
const REQUEST_MS = 10 * 60_000;

export const NAME_ID_FORMATS: Record<SamlConfig['nameIdFormat'], string> = {
  persistent: NAMEID.persistent, email: NAMEID.email, unspecified: NAMEID.unspecified,
};

/** Attribute names tried, in order, when the administrator names none. */
const EMAIL_ATTRIBUTES = [
  'email', 'mail', 'emailAddress', 'urn:oid:0.9.2342.19200300.100.1.3',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', 'http://schemas.xmlsoap.org/claims/EmailAddress',
];
const NAME_ATTRIBUTES = [
  'displayName', 'name', 'urn:oid:2.16.840.1.113730.3.1.241', 'http://schemas.microsoft.com/identity/claims/displayname',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name', 'cn', 'urn:oid:2.5.4.3',
];
const GIVEN = ['givenName', 'urn:oid:2.5.4.42', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'];
const SURNAME = ['sn', 'surname', 'urn:oid:2.5.4.4', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname'];

/** This application's SAML addresses for one provider, made from its callback address. */
export function samlAddresses(callbackUrl: string, config: Pick<SamlConfig, 'spEntityId'>) {
  const base = callbackUrl.replace(/\/callback$/, '');
  return {
    acsUrl: `${base}/acs`, metadataUrl: `${base}/metadata`, sloUrl: `${base}/slo`,
    entityId: config.spEntityId || `${base}/metadata`,
  };
}

/** A request-ID store that knows the one request this sign-in made (kept with the sign-in in flight). */
function oneRequestCache(expected: { id: string; at: string } | null, saved?: (id: string, at: string) => void): CacheProvider {
  const hit = async (key: string | null) => (expected && key === expected.id ? expected.at : null);
  return {
    async saveAsync(key, value) { saved?.(key, value); return { value, createdAt: Date.now() }; },
    getAsync: hit,
    removeAsync: hit,
    consumeAsync: hit,
  };
}

function client(config: SamlConfig, addresses: ReturnType<typeof samlAddresses>, key: string | null, opts: {
  cache: CacheProvider; forceAuthn?: boolean;
}): SAML {
  const wantMfa = config.providerMfa && config.mfaAcr.length > 0;
  return new SAML({
    entryPoint: config.ssoUrl,
    issuer: addresses.entityId,
    audience: addresses.entityId,
    callbackUrl: addresses.acsUrl,
    idpCert: config.idpCerts,
    idpIssuer: config.idpEntityId,
    identifierFormat: NAME_ID_FORMATS[config.nameIdFormat] ?? NAMEID.persistent,
    allowCreate: true,
    // E02-22: when the provider's multi-factor sign-in counts here, ask for the levels that show it.
    disableRequestedAuthnContext: !wantMfa,
    authnContext: wantMfa ? config.mfaAcr : undefined,
    racComparison: 'exact',
    forceAuthn: opts.forceAuthn === true,
    wantAssertionsSigned: config.wantAssertionsSigned === true,
    wantAuthnResponseSigned: false, // a signed assertion is enough; one of the two must be signed
    acceptedClockSkewMs: SKEW_MS,
    maxAssertionAgeMs: MAX_ASSERTION_AGE_MS,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: REQUEST_MS,
    rejectReplayedAssertions: false, // done in sso.ts, in the database, across every server
    cacheProvider: opts.cache,
    generateUniqueId: () => `_${randomBytes(20).toString('hex')}`,
    ...(key && config.signRequests ? { privateKey: key, signatureAlgorithm: 'sha256' as const, digestAlgorithm: 'sha256' } : {}),
    ...(key ? { decryptionPvk: key } : {}),
    logoutUrl: config.sloUrl || config.ssoUrl,
    logoutCallbackUrl: addresses.sloUrl,
    signMetadata: false,
  });
}

const first = (attrs: Record<string, string[]>, names: string[]): string | null => {
  for (const n of names) {
    const v = attrs[n]?.find((x) => x.trim());
    if (v) return v.trim();
  }
  return null;
};

/** Turns a verified assertion into the identity the rest of the application uses. */
export function identityFromAssertion(a: AssertionFacts, config: SamlConfig): ExternalIdentity {
  const attrs = a.attributes;
  let raw = first(attrs, config.emailAttribute ? [config.emailAttribute] : EMAIL_ATTRIBUTES);
  if (!raw && a.nameIdFormat === NAMEID.email) raw = a.nameId;
  const email = raw && /^[^@\s]+@[^@\s]+$/.test(raw) && raw.length <= 254 ? raw.toLowerCase() : null;
  const given = [first(attrs, GIVEN), first(attrs, SURNAME)].filter(Boolean).join(' ');
  const groups = config.groupsAttribute ? (attrs[config.groupsAttribute] ?? []).filter((g) => g.length <= 256).slice(0, 500) : [];
  return {
    subject: a.nameId,
    email,
    // SAML has no "email verified" statement: the address counts as verified only when the administrator trusts this provider's addresses.
    emailVerified: Boolean(email) && config.trustEmail === true,
    displayName: (first(attrs, config.nameAttribute ? [config.nameAttribute] : NAME_ATTRIBUTES) ?? given) || null,
    groups,
    amr: [],
    acr: a.authnContextClassRef,
    sid: a.sessionIndex,
    assertion: { id: a.id, until: a.notOnOrAfter ?? new Date(Date.now() + MAX_ASSERTION_AGE_MS) },
    samlSession: {
      nameId: a.nameId, format: a.nameIdFormat, nameQualifier: a.nameQualifier, spNameQualifier: a.spNameQualifier, sessionIndex: a.sessionIndex,
    },
  };
}

/** What a failure in the library means, in a few words for the audit log. */
function reasonOf(err: unknown): string {
  if (err instanceof IdentityError) return err.reason;
  const m = String((err as Error)?.message ?? err ?? 'unexpected error').replace(/\s+/g, ' ');
  return `SAML response refused: ${m.slice(0, 140)}`;
}

async function decrypt(xml: string, key: string): Promise<string> {
  return promisify(xmlenc.decrypt).bind(xmlenc)(xml, { key, disallowDecryptionWithInsecureAlgorithm: true, warnInsecureAlgorithm: false }) as Promise<string>;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** This application's service-provider metadata for one provider. */
export function serviceProviderMetadata(provider: ProviderRecord, callbackUrl: string): string {
  const config = provider.config as SamlConfig;
  const addr = samlAddresses(callbackUrl, config);
  const cert = config.spCert ? certificateBody(config.spCert) : '';
  const keyInfo = `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${cert}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>`;
  const keys = cert ? [
    `    <md:KeyDescriptor use="signing">${keyInfo}</md:KeyDescriptor>`,
    ...(config.encryptAssertions ? [
      `    <md:KeyDescriptor use="encryption">${keyInfo}`
      + '<md:EncryptionMethod Algorithm="http://www.w3.org/2009/xmlenc11#aes256-gcm"/>'
      + '<md:EncryptionMethod Algorithm="http://www.w3.org/2009/xmlenc11#aes128-gcm"/>'
      + '<md:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p"/></md:KeyDescriptor>',
    ] : []),
  ] : [];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<md:EntityDescriptor xmlns:md="${NS.metadata}" xmlns:ds="${NS.ds}" entityID="${esc(addr.entityId)}">`,
    `  <md:SPSSODescriptor protocolSupportEnumeration="${NS.protocol}" AuthnRequestsSigned="${config.signRequests ? 'true' : 'false'}" WantAssertionsSigned="${config.wantAssertionsSigned ? 'true' : 'false'}">`,
    ...keys,
    ...(config.endSession ? [`    <md:SingleLogoutService Binding="${BINDING.redirect}" Location="${esc(addr.sloUrl)}"/>`] : []),
    `    <md:NameIDFormat>${NAME_ID_FORMATS[config.nameIdFormat] ?? NAMEID.persistent}</md:NameIDFormat>`,
    `    <md:AssertionConsumerService Binding="${BINDING.post}" Location="${esc(addr.acsUrl)}" index="0" isDefault="true"/>`,
    '  </md:SPSSODescriptor>',
    '</md:EntityDescriptor>',
    '',
  ].join('\n');
}

/** SP-initiated single logout: the identity provider's sign-out address with a signed LogoutRequest, or null. */
export async function samlLogoutUrl(provider: ProviderRecord, key: string | null, opts: { session: string | null; callbackUrl: string }): Promise<string | null> {
  const config = provider.config as SamlConfig;
  if (config.endSession !== true || !config.sloUrl || !key || !opts.session) return null;
  let s: { nameId?: unknown; format?: unknown; nameQualifier?: unknown; spNameQualifier?: unknown; sessionIndex?: unknown };
  try { s = JSON.parse(opts.session); } catch { return null; }
  if (typeof s.nameId !== 'string' || !s.nameId) return null;
  const addr = samlAddresses(opts.callbackUrl, config);
  const saml = client({ ...config, signRequests: true }, addr, key, { cache: oneRequestCache(null) });
  const user: Profile = {
    issuer: config.idpEntityId, nameID: s.nameId, nameIDFormat: typeof s.format === 'string' ? s.format : NAMEID.unspecified,
    ...(typeof s.nameQualifier === 'string' ? { nameQualifier: s.nameQualifier } : {}),
    ...(typeof s.spNameQualifier === 'string' ? { spNameQualifier: s.spNameQualifier } : {}),
    ...(typeof s.sessionIndex === 'string' ? { sessionIndex: s.sessionIndex } : {}),
  };
  try {
    return await saml.getLogoutUrlAsync(user, '', {});
  } catch {
    return null; // signing out here still works
  }
}

/** A new key pair for this application's side of one SAML provider: the private key (stored encrypted) and its certificate. */
export async function newServiceProviderKey(commonName: string): Promise<{ privateKey: string; certificate: string }> {
  const { publicKey, privateKey } = await promisify(generateKeyPair)('rsa', { modulusLength: 3072 });
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    certificate: selfSignedCertificate(publicKey, privateKey, commonName.slice(0, 64) || 'Sandpiper GRC service provider'),
  };
}

export const samlDriver: ProviderDriver = {
  type: 'saml',
  label: 'SAML 2.0',
  style: 'redirect',

  cleanConfig(input, existing) {
    const { config: common, fields } = cleanCommonConfig(input, existing);
    const text = (k: string, fallback = '') => String(input[k] ?? existing?.[k] ?? fallback).trim();
    const onOff = (k: string, fallback = false) => {
      const v = input[k] !== undefined ? input[k] : existing?.[k] ?? fallback;
      if (typeof v !== 'boolean') fields[k] = 'Choose on or off.';
      return v === true;
    };
    const idpEntityId = text('idpEntityId');
    if (!idpEntityId || idpEntityId.length > 500 || /\s/.test(idpEntityId)) fields.idpEntityId = 'Enter the identity provider\'s entity ID (its issuer), as its metadata states it.';
    const url = (k: string, required: boolean, label: string) => {
      const v = text(k);
      if (!v) { if (required) fields[k] = `Enter the ${label}.`; return ''; }
      const problem = v.length > 1000 ? 'is too long' : addressProblem(v);
      if (problem) fields[k] = `The ${label} ${problem}.`;
      return v;
    };
    const ssoUrl = url('ssoUrl', true, 'sign-in address (HTTP-Redirect binding)');
    const sloUrl = url('sloUrl', false, 'sign-out address');
    const rawCerts = input.idpCerts !== undefined ? input.idpCerts : existing?.idpCerts ?? [];
    const { certs: idpCerts, problem } = readCertificates(Array.isArray(rawCerts) ? rawCerts.map(String) : String(rawCerts ?? ''));
    if (problem) fields.idpCerts = problem;
    else if (!idpCerts.length) fields.idpCerts = 'Add the identity provider\'s signing certificate. Add the next one too during a certificate change.';
    else if (idpCerts.length > 5) fields.idpCerts = 'Give at most 5 certificates.';
    const spEntityId = text('spEntityId');
    if (spEntityId && (spEntityId.length > 500 || /\s/.test(spEntityId))) fields.spEntityId = 'Use a URI without spaces, or leave empty to use the metadata address.';
    const nameIdFormat = text('nameIdFormat', 'persistent');
    if (!(nameIdFormat in NAME_ID_FORMATS)) fields.nameIdFormat = 'Choose a name identifier format.';
    const attribute = (k: string) => {
      const v = text(k);
      if (v && !/^[\x21-\x7E]{1,300}$/.test(v)) fields[k] = 'Use an attribute name without spaces.';
      return v;
    };
    const config: SamlConfig = {
      ...common,
      idpEntityId, ssoUrl, sloUrl, idpCerts,
      spEntityId,
      // This application's certificate is made when the provider is added and never comes from input.
      spCert: typeof existing?.spCert === 'string' ? existing.spCert : '',
      nameIdFormat: nameIdFormat as SamlConfig['nameIdFormat'],
      emailAttribute: attribute('emailAttribute'),
      nameAttribute: attribute('nameAttribute'),
      groupsAttribute: attribute('groupsAttribute'),
      signRequests: onOff('signRequests'),
      wantAssertionsSigned: onOff('wantAssertionsSigned'),
      encryptAssertions: onOff('encryptAssertions'),
      endSession: onOff('endSession'),
    };
    if (common.mappingEnabled && !config.groupsAttribute) fields.groupsAttribute = 'Name the attribute that holds groups or roles, or switch role mapping off.';
    // A SAML assertion shows how the person signed in only through its AuthnContextClassRef.
    if (common.providerMfa && !common.mfaAcr.length) fields.mfaAcr = 'Name at least one AuthnContextClassRef value that shows a multi-factor sign-in.';
    if (config.endSession && !sloUrl) fields.sloUrl = 'Enter the identity provider\'s sign-out address, or switch signing out there off.';
    return { config: { ...config, mfaAmr: [] }, fields };
  },

  async test(provider, secret) {
    const config = provider.config as SamlConfig;
    const notes: string[] = [];
    const certs = (config.idpCerts ?? []).map((c) => { try { return describeCertificate(c); } catch { return null; } });
    const live = certs.filter((c) => c && !c.expired);
    if (!certs.length) notes.push('No signing certificate is stored.');
    else if (!live.length) notes.push('Every signing certificate has expired.');
    if (!secret) notes.push('This application\'s key for this provider cannot be read (the secret key changed?). Remove and add the provider again.');
    if (config.endSession && !config.sloUrl) notes.push('Signing out at the provider is on, but no sign-out address is set.');
    const soonest = live.map((c) => c!.notAfter).sort()[0];
    return {
      ok: notes.length === 0,
      message: notes.length ? `The settings need attention: ${notes.join(' ')}`
        : `The settings are complete. ${live.length} signing certificate(s) in date${soonest ? `; the first expires on ${soonest.slice(0, 10)}` : ''}. Nothing was fetched: a SAML provider is tested by signing in.`,
      details: {
        entityId: config.idpEntityId, ssoUrl: config.ssoUrl, sloUrl: config.sloUrl || null,
        certificates: certs.map((c) => (c ? `${c.subject} (${c.key}, expires ${c.notAfter.slice(0, 10)}${c.expired ? ', EXPIRED' : ''})` : 'unreadable')),
      },
    } satisfies TestResult;
  },

  async start(provider, { redirectUri, state, reauth, secret }) {
    const config = provider.config as SamlConfig;
    const addr = samlAddresses(redirectUri, config);
    let request: { id: string; at: string } | null = null;
    const saml = client(config, addr, secret ?? null, {
      cache: oneRequestCache(null, (id, at) => { request = { id, at }; }),
      forceAuthn: reauth,
    });
    if (config.signRequests && !secret) throw new IdentityError('service-provider key unreadable');
    // RelayState carries the sign-in's state, so the response can be matched to it when it is posted back.
    const url = await saml.getAuthorizeUrlAsync(state, {});
    const made = request as { id: string; at: string } | null;
    if (!made) throw new IdentityError('no request ID');
    return { url, remember: { requestId: made.id, requestedAt: made.at } };
  },

  async complete(provider, secret, { params, redirectUri, remember }) {
    const config = provider.config as SamlConfig;
    const addr = samlAddresses(redirectUri, config);
    const requestId = String(remember.requestId ?? '');
    if (!requestId) throw new IdentityError('no request on record');
    const xml = decodeSamlResponse(params.SAMLResponse);
    const facts = inspectResponse(xml);
    if (facts.status !== 'Success') throw new IdentityError(`provider refused: ${facts.status.slice(0, 40)}${facts.subStatus ? ` (${facts.subStatus.slice(0, 40)})` : ''}`);
    // Destination: exact, and required on a signed response (SAML bindings 3.5.5.2).
    if (facts.destination !== null && facts.destination !== addr.acsUrl) throw new IdentityError('wrong Destination');
    if (facts.responseSigned && facts.destination === null) throw new IdentityError('signed response without Destination');
    if (facts.inResponseTo !== requestId) throw new IdentityError(facts.inResponseTo === null ? 'response names no request (unsolicited)' : 'wrong InResponseTo');
    if (facts.issuer !== null && facts.issuer !== config.idpEntityId) throw new IdentityError('wrong issuer');
    if (config.encryptAssertions && !facts.encrypted) throw new IdentityError('assertion not encrypted');
    if (facts.encrypted) {
      if (!secret) throw new IdentityError('service-provider key unreadable');
      let plain: string;
      try { plain = await decrypt(facts.encryptedXml!, secret); } catch { throw new IdentityError('encrypted assertion could not be decrypted'); }
      inspectDecryptedAssertion(plain);
    }
    const saml = client(config, addr, secret, { cache: oneRequestCache({ id: requestId, at: String(remember.requestedAt ?? '') }) });
    let profile: Profile | null;
    try {
      ({ profile } = await saml.validatePostResponseAsync({ SAMLResponse: params.SAMLResponse }));
    } catch (err) {
      throw new IdentityError(reasonOf(err));
    }
    if (!profile?.getAssertionXml) throw new IdentityError('no assertion');
    const assertion = readAssertion(profile.getAssertionXml(), { acsUrl: addr.acsUrl, requestId, skewMs: SKEW_MS });
    if (assertion.issuer !== config.idpEntityId) throw new IdentityError('wrong issuer');
    // The library and this reader must agree on who it is (text split by comments reads differently).
    if (!assertion.nameId || assertion.nameId !== profile.nameID) throw new IdentityError('NameID unreadable');
    if (assertion.nameId.length > 255) throw new IdentityError('NameID too long');
    if (assertion.nameIdFormat === NAMEID.transient) throw new IdentityError('transient NameID cannot identify a person; ask for a persistent one');
    return identityFromAssertion(assertion, config);
  },
};

/** The certificates' facts for the screens: who, which key, until when. */
export function certificateFacts(pems: unknown): ReturnType<typeof describeCertificate>[] {
  if (!Array.isArray(pems)) return [];
  const out = [];
  for (const p of pems) {
    try { out.push(describeCertificate(String(p))); } catch { /* not shown */ }
  }
  return out;
}
