// Single sign-on with SAML 2.0 (E02-10), against a stand-in identity provider whose key is made when
// the test starts. The happy paths, then every way a response must be refused.
import { X509Certificate } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, SESSION_COOKIE } from '../../core/auth.ts';
import { startFakeSamlIdp, type FakeSamlIdp, type RespondOptions } from '../../core/identity/saml-fake-idp.ts';
import { testApp } from '../../test/helpers.ts';

let t: Awaited<ReturnType<typeof testApp>>;
let idp: FakeSamlIdp;
let providerId = '';
const KEY = 'example-saml';
const BASE = 'http://localhost:80';
const ACS = `${BASE}/api/auth/sso/${KEY}/acs`;
const PASSWORD = 'quiet river stone lantern';

beforeAll(async () => {
  t = await testApp();
  idp = await startFakeSamlIdp();
});
afterAll(async () => { await t.close(); await idp.close(); });
beforeEach(async () => {
  await t.db.query('delete from rate_limit_hits');
  idp.user = { nameId: 'saml-person-1', attributes: { email: ['saml.person@example.test'], displayName: ['Sam L. Person'], groups: [] } };
});

const audited = async (action: string, like = '%') =>
  (await t.db.query('select summary from audit_events where action = $1 and coalesce(summary, \'\') like $2 order by id', [action, like])).map((r: any) => r.summary as string);
const lastFailure = async () => (await t.db.one<{ summary: string }>(`select summary from audit_events where action = 'signin.failure' order by id desc limit 1`))?.summary ?? '';

async function inject(method: 'GET' | 'POST', url: string, cookies: Record<string, string> = {}, payload?: unknown) {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  return t.app.inject({ method, url, headers: { 'x-grc-csrf': '1', ...(cookie ? { cookie } : {}) }, ...(payload !== undefined ? { payload: payload as object } : {}) });
}
const cookieOf = (res: { cookies: { name: string; value: string }[] }, name: string) => res.cookies.find((c) => c.name === name && c.value)?.value;

/** Posts a response to the assertion consumer service the way a browser does: a form, no CSRF header, no cookie. */
const postAcs = (fields: Record<string, string>, key = KEY) => t.app.inject({
  method: 'POST', url: `/api/auth/sso/${key}/acs`,
  headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(fields).toString(),
});

/** Starts a sign-in here and returns where the browser is sent, and its state cookie. */
async function startSignIn(key = KEY) {
  const start = await inject('POST', `/api/auth/sso/${key}/start`, {}, {});
  expect(start.statusCode).toBe(200);
  return { redirect: start.json().redirectUrl as string, state: cookieOf(start, 'grc_sso')! };
}

/** A whole sign-in: start, the provider's answer (with `opts`), the post to the ACS, the callback. */
async function samlSignIn(opts: RespondOptions = {}, key = KEY) {
  const { redirect, state } = await startSignIn(key);
  const r = await idp.respond(redirect, opts);
  const acs = await postAcs({ SAMLResponse: r.SAMLResponse, RelayState: r.RelayState }, key);
  if (acs.statusCode !== 303 || !String(acs.headers.location).includes('/callback')) {
    return { acs, location: acs.headers.location as string, session: undefined, r, redirect, state };
  }
  const cb = await inject('GET', acs.headers.location as string, { grc_sso: state });
  return { acs, cb, location: cb.headers.location as string, session: cookieOf(cb, SESSION_COOKIE), r, redirect, state };
}

async function makeUser(username: string, email: string) {
  const row = await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status, password_hash) values ($1,$2,$3,'active',$4) returning id`,
    [username, email, `Person ${username}`, await hashPassword(PASSWORD)],
  );
  return row!.id;
}

const saml = (extra: Record<string, unknown> = {}) => ({
  idpEntityId: idp.entityId, ssoUrl: idp.ssoUrl, idpCerts: [idp.cert], trustEmail: true, ...extra,
});

describe('SAML providers: settings and metadata (E02-10)', () => {
  it('adds a SAML provider with its own key and certificate, kept encrypted', async () => {
    const res = await t.api.post('/api/admin/identity-providers', { key: KEY, name: 'Example SAML directory', type: 'saml', enabled: true, config: saml() });
    expect(res.status).toBe(201);
    providerId = res.body.id;
    expect(res.body.typeLabel).toBe('SAML 2.0');
    expect(res.body.hasSecret).toBe(true);
    expect(res.body.sp.acsUrl).toBe(ACS);
    expect(res.body.sp.entityId).toBe(`${BASE}/api/auth/sso/${KEY}/metadata`);
    expect(res.body.sp.keyReadable).toBe(true);
    expect(res.body.sp.certificate.key).toBe('RSA 3072');
    expect(res.body.idpCertificates).toHaveLength(1);
    // The private key is stored sealed with the application key; the certificate made from it verifies.
    const row = await t.db.one<{ secret: string; config: any }>('select secret, config from identity_providers where id = $1', [providerId]);
    expect(row!.secret.startsWith('enc:v1:')).toBe(true);
    expect(row!.secret).not.toContain('PRIVATE KEY');
    const cert = new X509Certificate(row!.config.spCert);
    expect(cert.verify(cert.publicKey)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('PRIVATE KEY');
    // A secret cannot be set from outside for a SAML provider.
    await t.api.patch(`/api/admin/identity-providers/${providerId}`, { secret: '-----BEGIN PRIVATE KEY-----x' });
    expect((await t.db.one<{ secret: string }>('select secret from identity_providers where id = $1', [providerId]))!.secret).toBe(row!.secret);
    expect((await t.anon.get('/api/auth/providers')).body.providers).toEqual([{ key: KEY, name: 'Example SAML directory', isDefault: false }]);
  });

  it('checks the settings', async () => {
    const res = await t.api.post('/api/admin/identity-providers', {
      key: 'bad-saml', name: 'Bad', type: 'saml',
      config: { idpEntityId: '', ssoUrl: 'http://idp.example.test/sso', idpCerts: ['not a certificate'], mappingEnabled: true, mappings: [{ value: 'g', role: 'agent' }] },
    });
    expect(res.status).toBe(400);
    const f = res.body.error.fields;
    expect(f['config.idpEntityId']).toBeTruthy();
    expect(f['config.ssoUrl']).toMatch(/https/);
    expect(f['config.idpCerts']).toMatch(/not readable/);
    expect(f['config.groupsAttribute']).toBeTruthy();
    const key = await t.api.post('/api/admin/identity-providers', { key: 'bad-saml', name: 'Bad', type: 'saml', config: saml({ idpCerts: ['-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----'] }) });
    expect(key.body.error.fields['config.idpCerts']).toMatch(/never a private key/);
  });

  it('publishes service-provider metadata with the addresses and the certificate', async () => {
    const res = await t.app.inject({ method: 'GET', url: `/api/auth/sso/${KEY}/metadata` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/samlmetadata+xml');
    expect(res.body).toContain(`entityID="${BASE}/api/auth/sso/${KEY}/metadata"`);
    expect(res.body).toContain(`Location="${ACS}"`);
    expect(res.body).toContain('urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST');
    expect(res.body).toContain('<md:KeyDescriptor use="signing">');
    expect(res.body).not.toContain('use="encryption"');
    expect(res.body).not.toContain('PRIVATE');
    expect((await t.app.inject({ method: 'GET', url: '/api/auth/sso/nobody/metadata' })).statusCode).toBe(404);
  });

  it('reads identity-provider metadata pasted in, and fetches it only when outbound connections allow it', async () => {
    const pasted = await t.api.post('/api/admin/identity-providers/saml-metadata', { xml: idp.metadataXml() });
    expect(pasted.status).toBe(200);
    expect(pasted.body.entityId).toBe(idp.entityId);
    expect(pasted.body.ssoUrl).toBe(idp.ssoUrl); // the HTTP-Redirect one, not the POST one
    expect(pasted.body.sloUrl).toBe(idp.sloUrl);
    expect(pasted.body.certificates).toHaveLength(1);
    expect(pasted.body.certificateFacts[0].key).toBe('RSA 2048');

    const xxe = await t.api.post('/api/admin/identity-providers/saml-metadata', {
      xml: `<?xml version="1.0"?><!DOCTYPE md [<!ENTITY x SYSTEM "file:///etc/passwd">]>${idp.metadataXml().replace(/^<\?xml[^>]*>/, '')}`,
    });
    expect(xxe.status).toBe(400);
    expect(xxe.body.error.fields.xml).toMatch(/document type declaration/);

    const before = idp.hits['/metadata'] ?? 0;
    const off = await t.api.post('/api/admin/identity-providers/saml-metadata', { url: idp.metadataUrl });
    expect(off.status).toBe(409);
    expect(off.body.error.code).toBe('outbound_off');
    const confirm = () => t.db.query(`update sessions set confirmed_at = now() where user_id = (select id from users where username = 'admin')`);
    await confirm();
    expect((await t.api.patch('/api/admin/settings', { 'integrations.outbound_enabled': true, 'integrations.allowed_hosts': [] })).status).toBe(200);
    const notAllowed = await t.api.post('/api/admin/identity-providers/saml-metadata', { url: idp.metadataUrl });
    expect(notAllowed.body.error.fields.url).toMatch(/allowed hosts/);
    expect(idp.hits['/metadata'] ?? 0).toBe(before);
    await confirm();
    expect((await t.api.patch('/api/admin/settings', { 'integrations.allowed_hosts': [`127.0.0.1:${idp.port}`] })).status).toBe(200);
    const fetched = await t.api.post('/api/admin/identity-providers/saml-metadata', { url: idp.metadataUrl });
    expect(fetched.status).toBe(200);
    expect(fetched.body.entityId).toBe(idp.entityId);
    expect(idp.hits['/metadata']).toBe(before + 1);
    expect((await audited('identity_provider.metadata_fetch', '%fetched from 127.0.0.1%')).length).toBe(1);
    await confirm();
    await t.api.patch('/api/admin/settings', { 'integrations.outbound_enabled': false, 'integrations.allowed_hosts': [] });
  });
});

describe('SAML sign-in (E02-10)', () => {
  it('sends a redirect-binding AuthnRequest for this provider, with the state as RelayState', async () => {
    const { redirect, state } = await startSignIn();
    const req = idp.readRequest(redirect);
    expect(redirect.startsWith(`${idp.ssoUrl}?SAMLRequest=`)).toBe(true);
    expect(req.acsUrl).toBe(ACS);
    expect(req.issuer).toBe(`${BASE}/api/auth/sso/${KEY}/metadata`);
    expect(req.relayState).toBe(state);
    expect(req.id).toMatch(/^_[0-9a-f]{40}$/);
    expect(req.signed).toBe(false);
  });

  it('refuses an unknown person by default, then signs in with an allowed link and by the linked NameID', async () => {
    idp.user = { nameId: 'stranger-9', attributes: { email: ['stranger@elsewhere.test'] } };
    expect((await samlSignIn()).location).toBe('/?sso=no_account');

    const userId = await makeUser('robin', 'robin@example.test');
    expect((await t.api.post(`/api/admin/users/${userId}/link-permit`, { providerId })).status).toBe(200);
    idp.user = { nameId: 'robin-nameid', attributes: { email: ['Robin@Example.test'], displayName: ['Robin'] } };
    const first = await samlSignIn();
    expect(first.location).toBe('/');
    expect(first.session).toBeTruthy();
    const me = await inject('GET', '/api/auth/state', { [SESSION_COOKIE]: first.session! });
    expect(me.json().user.username).toBe('robin');
    expect((await audited('signin.success', '%via Example SAML directory (SAML 2.0)%')).length).toBe(1);
    const linked = await t.db.one<{ subject: string }>('select subject from user_identities where user_id = $1', [userId]);
    expect(linked!.subject).toBe('robin-nameid');

    // Next time the NameID alone is enough, whatever the email says.
    idp.user = { nameId: 'robin-nameid', attributes: { email: ['changed@elsewhere.test'] } };
    const again = await samlSignIn();
    expect(again.location).toBe('/');
    expect(again.session).toBeTruthy();
  });

  it('accepts a signed response around an unsigned assertion, and a certificate rollover', async () => {
    idp.user = { nameId: 'robin-nameid', attributes: {} };
    expect((await samlSignIn({ signAssertion: false, signResponse: true })).location).toBe('/');
    expect((await samlSignIn({ signAssertion: true, signResponse: true })).location).toBe('/');
    await t.api.patch(`/api/admin/identity-providers/${providerId}`, { config: { idpCerts: [idp.otherCert, idp.cert] } });
    expect((await samlSignIn()).location).toBe('/');
    // The assertion itself must be signed when the provider is set so.
    await t.api.patch(`/api/admin/identity-providers/${providerId}`, { config: { idpCerts: [idp.cert], wantAssertionsSigned: true } });
    expect((await samlSignIn({ signAssertion: false, signResponse: true })).location).toBe('/?sso=failed');
    await t.api.patch(`/api/admin/identity-providers/${providerId}`, { config: { wantAssertionsSigned: false } });
  });

  // Each of these must fail, and say why in the audit log.
  const refusals: [string, RespondOptions, RegExp][] = [
    ['an unsigned response and assertion', { signAssertion: false }, /signature/i],
    ['a signature by a key that is not trusted', { foreignKey: true }, /signature/i],
    ['a SHA-1 signature', { sigAlg: 'sha1' }, /signature algorithm not accepted/],
    ['the wrong audience', { audience: 'https://somewhere-else.example.test/sp' }, /audience/i],
    ['an expired assertion', { shiftMs: -20 * 60_000 }, /expired|subject confirmation|bearer confirmation/i],
    ['an assertion not valid yet', { shiftMs: 10 * 60_000 }, /not yet valid|subject confirmation|bearer confirmation/i],
    ['the wrong InResponseTo', { inResponseTo: '_someone-elses-request' }, /InResponseTo/],
    ['no InResponseTo (unsolicited)', { inResponseTo: null }, /unsolicited|InResponseTo/],
    ['the wrong Recipient', { recipient: `${BASE}/api/auth/sso/other/acs` }, /bearer confirmation/],
    ['the wrong Destination', { destination: `${BASE}/api/auth/sso/other/acs` }, /Destination/],
    ['the wrong issuer', { issuer: 'https://impostor.example.test/idp' }, /issuer/i],
    ['a transient NameID', { user: { nameId: 'tmp-1', nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient' } }, /transient/],
    ['an error status', { status: 'urn:oasis:names:tc:SAML:2.0:status:Responder' }, /provider refused: Responder/],
    ['a document type declaration (XXE)', {
      mutate: (xml) => `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/hostname">]>${xml.replace('Test Person', '&x;')}`,
    }, /document type declaration/],
    ['entity expansion', {
      mutate: (xml) => `<!DOCTYPE r [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>${xml}`,
    }, /document type declaration/],
    ['a changed NameID after signing', { mutate: (xml) => xml.replace('>robin-nameid<', '>admin<') }, /signature/i],
    ['a wrapped signature: a second, unsigned assertion beside the signed one', {
      mutate: (xml) => xml.replace('<samlp:Status>', `<saml:Assertion ID="_evil" Version="2.0" IssueInstant="${new Date().toISOString()}"><saml:Issuer>x</saml:Issuer><saml:Subject><saml:NameID>admin</saml:NameID></saml:Subject></saml:Assertion><samlp:Status>`),
    }, /more than one assertion/],
    ['a wrapped signature: the signed assertion hidden in Extensions, a forged one in its place', {
      mutate: (xml) => {
        const signed = /<saml:Assertion[\s\S]*<\/saml:Assertion>/.exec(xml)![0];
        const forged = signed.replace('>robin-nameid<', '>admin<').replace(/<(\w+:)?Signature[\s>][\s\S]*<\/(\w+:)?Signature>/, '').replace(/ID="[^"]+"/, 'ID="_forged"');
        return xml.replace(signed, forged).replace('<samlp:Status>', `<samlp:Extensions>${signed}</samlp:Extensions><samlp:Status>`);
      },
    }, /more than one assertion/],
    ['a signature that points at another element', {
      mutate: (xml) => {
        const out = xml.replace(/(<(?:\w+:)?Reference URI=")#[^"]+"/, '$1#_elsewhere"');
        expect(out).not.toBe(xml);
        return out;
      },
    }, /signature does not cover/],
  ];
  for (const [what, opts, why] of refusals) {
    it(`refuses ${what}`, async () => {
      idp.user = { nameId: 'robin-nameid', attributes: { email: ['robin@example.test'] } };
      const r = await samlSignIn(opts);
      expect(r.session).toBeUndefined();
      expect(r.location).toBe('/?sso=failed');
      expect(await lastFailure()).toMatch(why);
    });
  }

  it('reads a NameID split by a comment as the whole signed value, never a part of it', async () => {
    idp.user = { nameId: 'robin-nameid', attributes: {} };
    const r = await samlSignIn({ mutate: (xml) => xml.replace('>robin-nameid<', '>robin-name<!---->id<') });
    expect(r.r.xml).toContain('robin-name<!---->id');
    expect(r.location).toBe('/');
    const me = await inject('GET', '/api/auth/state', { [SESSION_COOKIE]: r.session! });
    expect(me.json().user.username).toBe('robin');
  });

  it('accepts each assertion once, and each sign-in once', async () => {
    idp.user = { nameId: 'robin-nameid', attributes: {} };
    const assertionId = '_fixed-assertion-id-0001';
    expect((await samlSignIn({ assertionId })).location).toBe('/');
    // The same assertion ID again, in a new sign-in that is otherwise in order.
    const second = await samlSignIn({ assertionId });
    expect(second.location).toBe('/?sso=failed');
    expect(await lastFailure()).toMatch(/assertion replayed/);
    // The same response posted again after it was used: the sign-in it answers is over.
    const used = await samlSignIn();
    expect(used.location).toBe('/');
    const replay = await postAcs({ SAMLResponse: used.r.SAMLResponse, RelayState: used.r.RelayState });
    expect(replay.headers.location).toBe('/?sso=failed');
    expect(await lastFailure()).toMatch(/unknown, used, expired or already answered/);
    // A response from another sign-in, carried into a new one: the request IDs differ.
    const { redirect, state } = await startSignIn();
    const old = await postAcs({ SAMLResponse: used.r.SAMLResponse, RelayState: idp.readRequest(redirect).relayState });
    const cb = await inject('GET', old.headers.location as string, { grc_sso: state });
    expect(cb.headers.location).toBe('/?sso=failed');
    expect(await lastFailure()).toMatch(/InResponseTo/);
  });

  it('binds the response to the browser that started the sign-in', async () => {
    const { redirect } = await startSignIn();
    const r = await idp.respond(redirect);
    const acs = await postAcs({ SAMLResponse: r.SAMLResponse, RelayState: r.RelayState });
    expect(acs.statusCode).toBe(303);
    const other = await inject('GET', acs.headers.location as string, { grc_sso: 'another-browser-state' });
    expect(other.headers.location).toBe('/?sso=failed');
    expect(cookieOf(other, SESSION_COOKIE)).toBeUndefined();
    expect(await lastFailure()).toMatch(/state does not match this browser/);
    // An unsolicited response (no RelayState) is refused at once.
    const unsolicited = await postAcs({ SAMLResponse: r.SAMLResponse });
    expect(unsolicited.headers.location).toBe('/?sso=failed');
    expect(await lastFailure()).toMatch(/unsolicited/);
    // A response is never read from the address.
    const viaQuery = await inject('GET', `/api/auth/sso/${KEY}/callback?state=x&SAMLResponse=${encodeURIComponent(r.SAMLResponse)}`, { grc_sso: 'x' });
    expect(viaQuery.headers.location).toBe('/?sso=failed');
  });

  it('refuses an oversized response and limits failed attempts like password sign-in', async () => {
    const big = Buffer.from(`<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">${'x'.repeat(300 * 1024)}</samlp:Response>`).toString('base64');
    const { redirect, state } = await startSignIn();
    const acs = await postAcs({ SAMLResponse: big, RelayState: idp.readRequest(redirect).relayState });
    const cb = await inject('GET', acs.headers.location as string, { grc_sso: state });
    expect(cb.headers.location).toBe('/?sso=failed');
    expect(await lastFailure()).toMatch(/too large/);
    for (let i = 0; i < 20; i++) await postAcs({ SAMLResponse: 'eA==' });
    expect((await inject('POST', `/api/auth/sso/${KEY}/start`, {}, {})).statusCode).toBe(429);
  });

  it('maps groups to roles and trusts the provider\'s multi-factor sign-in only when shown', async () => {
    const MFA = 'https://refeds.org/profile/mfa';
    await t.api.patch(`/api/admin/identity-providers/${providerId}`, {
      config: { mappingEnabled: true, groupsAttribute: 'groups', mappings: [{ value: 'grc-auditors', role: 'agent' }], providerMfa: true, mfaAcr: [MFA] },
    });
    const { redirect } = await startSignIn();
    expect(idp.readRequest(redirect).authnContext).toEqual([MFA]); // asked for at sign-in
    idp.user = { nameId: 'robin-nameid', attributes: { groups: ['grc-auditors', 'other'] } };
    const withMfa = await samlSignIn({ authnContextClassRef: MFA });
    expect(withMfa.location).toBe('/');
    const roles = await t.db.query<{ key: string }>(
      `select r.key from user_roles ur join roles r on r.id = ur.role_id join users u on u.id = ur.user_id where u.username = 'robin'`);
    expect(roles.map((r) => r.key)).toContain('agent');
    const s1 = await t.db.one<{ mfa: boolean }>('select mfa from identity_sessions order by created_at desc limit 1');
    expect(s1!.mfa).toBe(true);
    await samlSignIn({ authnContextClassRef: 'urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport' });
    const s2 = await t.db.query<{ mfa: boolean }>('select mfa from identity_sessions order by created_at desc limit 1');
    expect(s2[0].mfa).toBe(false);
    await t.api.patch(`/api/admin/identity-providers/${providerId}`, { config: { mappingEnabled: false, providerMfa: false } });
  });

  it('decrypts encrypted assertions (AES-GCM) when asked for them, and refuses others', async () => {
    await t.api.patch(`/api/admin/identity-providers/${providerId}`, { config: { encryptAssertions: true } });
    const meta = (await t.app.inject({ method: 'GET', url: `/api/auth/sso/${KEY}/metadata` })).body;
    expect(meta).toContain('use="encryption"');
    expect(meta).toContain('aes256-gcm');
    expect(meta).not.toContain('cbc');
    const spCert = (await t.db.one<{ config: any }>('select config from identity_providers where id = $1', [providerId]))!.config.spCert;
    idp.user = { nameId: 'robin-nameid', attributes: {} };
    expect((await samlSignIn({ encryptFor: spCert })).location).toBe('/');
    expect((await samlSignIn()).location).toBe('/?sso=failed');
    expect(await lastFailure()).toMatch(/not encrypted/);
    expect((await samlSignIn({ encryptFor: spCert, encryptionAlgorithm: 'http://www.w3.org/2001/04/xmlenc#aes256-cbc' })).location).toBe('/?sso=failed');
    expect(await lastFailure()).toMatch(/encryption algorithm not accepted/);
    // An unsigned assertion inside the encryption is still refused.
    expect((await samlSignIn({ encryptFor: spCert, signAssertion: false })).location).toBe('/?sso=failed');
    await t.api.patch(`/api/admin/identity-providers/${providerId}`, { config: { encryptAssertions: false } });
  });

  it('signs requests when asked, and signs out at the provider with a signed LogoutRequest', async () => {
    await t.api.patch(`/api/admin/identity-providers/${providerId}`, { config: { signRequests: true, endSession: true, sloUrl: idp.sloUrl } });
    const { redirect } = await startSignIn();
    const u = new URL(redirect);
    expect(u.searchParams.get('SigAlg')).toBe('http://www.w3.org/2001/04/xmldsig-more#rsa-sha256');
    expect(u.searchParams.get('Signature')).toBeTruthy();
    idp.user = { nameId: 'robin-nameid', attributes: {} };
    const s = await samlSignIn();
    expect(s.location).toBe('/');
    const out = (await inject('POST', '/api/auth/logout', { [SESSION_COOKIE]: s.session! })).json();
    const logout = new URL(out.redirectUrl);
    expect(`${logout.origin}${logout.pathname}`).toBe(idp.sloUrl);
    expect(logout.searchParams.get('SAMLRequest')).toBeTruthy();
    expect(logout.searchParams.get('Signature')).toBeTruthy();
    // The provider sends the browser back to the application.
    const back = await t.app.inject({ method: 'GET', url: `/api/auth/sso/${KEY}/slo?SAMLResponse=x` });
    expect(back.headers.location).toBe('/');
    expect((await t.app.inject({ method: 'GET', url: `/api/auth/sso/${KEY}/metadata` })).body).toContain(`/api/auth/sso/${KEY}/slo`);
    await t.api.patch(`/api/admin/identity-providers/${providerId}`, { config: { signRequests: false, endSession: false } });
  });

  it('never lets the break-glass account in through SAML', async () => {
    const bg = await makeUser('glass', 'glass@example.test');
    await t.db.query(`insert into user_roles (user_id, role_id) select $1, id from roles where key = 'administrator'`, [bg]);
    expect((await t.api.post(`/api/admin/users/${bg}/break-glass`, { breakGlass: true })).status).toBe(200);
    idp.user = { nameId: 'glass-nameid', attributes: { email: ['glass@example.test'] } };
    const r = await samlSignIn();
    expect(r.session).toBeUndefined();
    expect(await lastFailure()).toMatch(/break-glass/);
    await t.api.post(`/api/admin/users/${bg}/break-glass`, { breakGlass: false });
  });
});
