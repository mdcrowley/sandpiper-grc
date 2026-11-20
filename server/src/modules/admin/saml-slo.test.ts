// SAML 2.0: sign-outs started at the identity provider (E02-27), and signed metadata with its
// scheduled refresh (E02-28), against the stand-in identity provider whose keys are made when the
// test starts.
import { createVerify } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../../core/auth.ts';
import { startFakeSamlIdp, type FakeSamlIdp } from '../../core/identity/saml-fake-idp.ts';
import { mergeRefreshedCertificates } from '../../core/identity/saml.ts';
import { describeCertificate } from '../../core/identity/x509.ts';
import { testApp } from '../../test/helpers.ts';

let t: Awaited<ReturnType<typeof testApp>>;
let idp: FakeSamlIdp;
let providerId = '';
const KEY = 'example-slo';
const BASE = 'http://localhost:80';
const SLO = `${BASE}/api/auth/sso/${KEY}/slo`;

beforeAll(async () => {
  t = await testApp();
  idp = await startFakeSamlIdp();
  idp.user = { nameId: 'slo-person-1', attributes: { email: ['slo.person@example.test'], displayName: ['Sloane Person'], groups: [] } };
});
afterAll(async () => { await t.close(); await idp.close(); });
beforeEach(async () => { await t.db.query('delete from rate_limit_hits'); });

const cookieOf = (res: { cookies: { name: string; value: string }[] }, name: string) => res.cookies.find((c) => c.name === name && c.value)?.value;
const audited = async (action: string) => (await t.db.query<{ summary: string }>('select summary from audit_events where action = $1 order by id', [action])).map((r) => r.summary);
const lastFailure = async () => (await t.db.one<{ summary: string }>(`select summary from audit_events where action = 'identity.failure' order by id desc limit 1`))?.summary ?? '';
const signedIn = async (session: string) =>
  (await t.app.inject({ method: 'GET', url: '/api/auth/state', headers: { cookie: `${SESSION_COOKIE}=${session}` } })).json().user !== null;

/** A whole SAML sign-in; returns the session cookie and the session index the identity provider gave. */
async function signIn() {
  const start = await t.app.inject({ method: 'POST', url: `/api/auth/sso/${KEY}/start`, headers: { 'x-grc-csrf': '1' }, payload: {} });
  const state = cookieOf(start, 'grc_sso')!;
  const r = await idp.respond(start.json().redirectUrl);
  const acs = await t.app.inject({
    method: 'POST', url: `/api/auth/sso/${KEY}/acs`, headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ SAMLResponse: r.SAMLResponse, RelayState: r.RelayState }).toString(),
  });
  const cb = await t.app.inject({ method: 'GET', url: acs.headers.location as string, headers: { cookie: `grc_sso=${state}` } });
  const session = cookieOf(cb, SESSION_COOKIE);
  expect(session).toBeTruthy();
  return { session: session!, sessionIndex: /SessionIndex="([^"]+)"/.exec(r.xml)![1] };
}

const sloGet = (query: string) => t.app.inject({ method: 'GET', url: `/api/auth/sso/${KEY}/slo?${query}` });
const sloPost = (form: Record<string, string>) => t.app.inject({
  method: 'POST', url: `/api/auth/sso/${KEY}/slo`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams(form).toString(),
});

/** Reads the LogoutResponse this application sent back, and checks its signature with this application's certificate. */
async function readResponse(location: string) {
  const url = new URL(location);
  expect(`${url.origin}${url.pathname}`).toBe(idp.sloUrl);
  const raw = url.search.slice(1);
  const xml = inflateRawSync(Buffer.from(url.searchParams.get('SAMLResponse')!, 'base64')).toString('utf8');
  const signedPart = raw.slice(0, raw.indexOf('&Signature='));
  const spCert = (await t.db.one<{ config: any }>('select config from identity_providers where id = $1', [providerId]))!.config.spCert;
  const ok = createVerify('sha256').update(signedPart).verify(spCert, url.searchParams.get('Signature')!, 'base64');
  return { xml, signatureOk: ok, relayState: url.searchParams.get('RelayState') };
}

describe('sign-outs started at the identity provider (E02-27)', () => {
  it('sets up a provider that accepts them, and says so in its metadata', async () => {
    const res = await t.api.post('/api/admin/identity-providers', {
      key: KEY, name: 'Example SLO provider', type: 'saml', enabled: true,
      config: { idpEntityId: idp.entityId, ssoUrl: idp.ssoUrl, idpCerts: [idp.cert], trustEmail: true, jitEnabled: true, jitDomains: ['example.test'], idpLogout: true },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.fields['config.sloUrl']).toBeTruthy(); // the answer needs somewhere to go
    const ok = await t.api.post('/api/admin/identity-providers', {
      key: KEY, name: 'Example SLO provider', type: 'saml', enabled: true,
      config: { idpEntityId: idp.entityId, ssoUrl: idp.ssoUrl, sloUrl: idp.sloUrl, idpCerts: [idp.cert], trustEmail: true, jitEnabled: true, jitDomains: ['example.test'], idpLogout: true },
    });
    expect(ok.status).toBe(201);
    providerId = ok.body.id;
    const meta = await t.app.inject({ method: 'GET', url: `/api/auth/sso/${KEY}/metadata` });
    expect(meta.body).toContain(`<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${SLO}"/>`);
    expect(meta.body).toContain(`<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${SLO}"/>`);
  });

  it('acts on a signed LogoutRequest (HTTP-Redirect): ends that session and answers with a signed LogoutResponse', async () => {
    const a = await signIn();
    const b = await signIn();
    const req = idp.logoutRequest({ binding: 'redirect', destination: SLO, nameId: idp.user.nameId, sessionIndex: a.sessionIndex, relayState: 'back-to-portal' });
    const res = await sloGet(req.query);
    expect(res.statusCode).toBe(302);
    // A refusal also redirects (home); name its reason so an intermittent failure says why.
    expect(res.headers.location, await lastFailure()).toMatch(/^https?:/);
    const answer = await readResponse(res.headers.location as string);
    expect(answer.signatureOk).toBe(true);
    expect(answer.relayState).toBe('back-to-portal');
    expect(answer.xml).toContain(`InResponseTo="${req.id}"`);
    expect(answer.xml).toContain('urn:oasis:names:tc:SAML:2.0:status:Success');
    expect(await signedIn(a.session)).toBe(false);
    expect(await signedIn(b.session)).toBe(true); // another session index: left alone
    expect((await audited('identity.saml_logout')).pop()).toMatch(/signed 1 session\(s\) out .*HTTP-Redirect/);

    // The same request again does nothing more.
    const again = await sloGet(req.query);
    expect(again.headers.location).toBe('/?sso=failed');
    expect(await lastFailure()).toMatch(/replayed/);

    // Without a session index, every session made through the provider for that person ends.
    const all = idp.logoutRequest({ binding: 'redirect', destination: SLO, nameId: idp.user.nameId });
    expect((await sloGet(all.query)).statusCode).toBe(302);
    expect(await signedIn(b.session)).toBe(false);
  });

  it('acts on a signed LogoutRequest (HTTP-POST)', async () => {
    const a = await signIn();
    const req = idp.logoutRequest({ binding: 'post', destination: SLO, nameId: idp.user.nameId, sessionIndex: a.sessionIndex });
    const res = await sloPost(req.form);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location, await lastFailure()).toMatch(/^https?:/);
    expect((await readResponse(res.headers.location as string)).signatureOk).toBe(true);
    expect(await signedIn(a.session)).toBe(false);
    expect((await audited('identity.saml_logout')).pop()).toMatch(/HTTP-POST/);
  });

  it('refuses unsigned, foreign-signed, SHA-1, misdirected, stale and wrong-issuer requests', async () => {
    const a = await signIn();
    const cases: [string, Parameters<FakeSamlIdp['logoutRequest']>[0], RegExp][] = [
      ['unsigned redirect', { binding: 'redirect', destination: SLO, nameId: idp.user.nameId, sign: false }, /not signed/],
      ['unsigned post', { binding: 'post', destination: SLO, nameId: idp.user.nameId, sign: false }, /not signed/],
      ['foreign key', { binding: 'redirect', destination: SLO, nameId: idp.user.nameId, foreignKey: true }, /refused/],
      ['foreign key post', { binding: 'post', destination: SLO, nameId: idp.user.nameId, foreignKey: true }, /refused/],
      ['sha1', { binding: 'redirect', destination: SLO, nameId: idp.user.nameId, sigAlg: 'sha1' }, /algorithm not accepted/],
      ['sha1 post', { binding: 'post', destination: SLO, nameId: idp.user.nameId, sigAlg: 'sha1' }, /algorithm not accepted/],
      ['destination', { binding: 'redirect', destination: 'https://elsewhere.example.test/slo', nameId: idp.user.nameId }, /wrong Destination/],
      ['no destination', { binding: 'post', destination: null, nameId: idp.user.nameId }, /without Destination/],
      ['old', { binding: 'redirect', destination: SLO, nameId: idp.user.nameId, shiftMs: -20 * 60_000 }, /too old/],
      ['future', { binding: 'post', destination: SLO, nameId: idp.user.nameId, shiftMs: 20 * 60_000 }, /future/],
      ['issuer', { binding: 'redirect', destination: SLO, nameId: idp.user.nameId, issuer: 'https://other.example.test/idp' }, /wrong issuer/],
    ];
    for (const [name, opts, why] of cases) {
      const req = idp.logoutRequest(opts);
      const res = opts.binding === 'post' ? await sloPost(req.form) : await sloGet(req.query);
      expect(res.headers.location, name).toBe('/?sso=failed');
      expect(await lastFailure(), name).toMatch(why);
    }
    // A signed request whose XML was changed after signing.
    const req = idp.logoutRequest({ binding: 'post', destination: SLO, nameId: idp.user.nameId });
    const changed = req.xml.replace(idp.user.nameId, 'someone-else');
    const res = await sloPost({ SAMLRequest: Buffer.from(changed).toString('base64') });
    expect(res.headers.location).toBe('/?sso=failed');
    expect(await signedIn(a.session)).toBe(true);
  });

  it('does nothing when the provider has it switched off (as before)', async () => {
    await t.api.patch(`/api/admin/identity-providers/${providerId}`, { config: { idpLogout: false } });
    const a = await signIn();
    const req = idp.logoutRequest({ binding: 'redirect', destination: SLO, nameId: idp.user.nameId });
    const res = await sloGet(req.query);
    expect(res.headers.location).toBe('/');
    expect(await signedIn(a.session)).toBe(true);
    // The answer to a sign-out started here still just comes home.
    expect((await sloGet('SAMLResponse=x')).headers.location).toBe('/');
    await t.api.patch(`/api/admin/identity-providers/${providerId}`, { config: { idpLogout: true } });
  });
});

describe('signed metadata and its refresh (E02-28)', () => {
  it('checks the metadata signature against the pinned certificate, and reads only what it covers', async () => {
    const read = (xml: string, metadataCert = idp.metadataCert) => t.api.post('/api/admin/identity-providers/saml-metadata', { xml, metadataCert });
    const good = await read(idp.signedMetadataXml());
    expect(good.status).toBe(200);
    expect(good.body).toMatchObject({ signed: true, entityId: idp.entityId, ssoUrl: idp.ssoUrl });
    expect((await read(idp.metadataXml())).body.error.fields.xml).toMatch(/not signed/);
    expect((await read(idp.signedMetadataXml({ foreignKey: true }))).body.error.fields.xml).toMatch(/not valid/);
    expect((await read(idp.signedMetadataXml({ mutate: (x) => x.replace(`Location="${idp.ssoUrl}"`, 'Location="https://evil.example.test/sso"') }))).body.error.fields.xml).toMatch(/not valid/);
    expect((await read(idp.signedMetadataXml({ validUntil: '2001-01-01T00:00:00Z' }))).body.error.fields.xml).toMatch(/out of date/);
    expect((await read(idp.signedMetadataXml(), '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----')).body.error.fields.metadataCert).toMatch(/private key/);
    // Without a pinned certificate it is read as before (the administrator vouches for it).
    expect((await t.api.post('/api/admin/identity-providers/saml-metadata', { xml: idp.metadataXml() })).body.signed).toBe(false);
  });

  it('needs a signing certificate for a scheduled refresh, and outbound connections to run it', async () => {
    const metadataUrl = `http://127.0.0.1:${idp.port}/metadata-signed`;
    const bad = await t.api.patch(`/api/admin/identity-providers/${providerId}`, { config: { metadataUrl, metadataRefresh: true } });
    expect(bad.body.error.fields['config.metadataCert']).toMatch(/signed metadata only/);
    const ok = await t.api.patch(`/api/admin/identity-providers/${providerId}`, { config: { metadataUrl, metadataCert: idp.metadataCert, metadataRefresh: true } });
    expect(ok.status).toBe(200);
    expect((await t.api.post(`/api/admin/identity-providers/${providerId}/refresh-metadata`)).body.error.code).toBe('outbound_off');
    // The daily job records why it did nothing.
    await t.app.jobs.enqueue('admin.saml_metadata_refresh', {});
    await t.app.jobs.runDue({ types: ['admin.saml_metadata_refresh'] });
    const row = await t.db.one<{ config: any }>('select config from identity_providers where id = $1', [providerId]);
    expect(row!.config.metadataStatus).toMatch(/outbound connections are switched off/);
  });

  it('picks up a new signing certificate and keeps the old one for a while (rollover), audited', async () => {
    await t.api.patch('/api/admin/settings', { 'integrations.outbound_enabled': true, 'integrations.allowed_hosts': [`127.0.0.1:${idp.port}`] });
    const fp = (pem: string) => describeCertificate(pem).fingerprint;
    const certs = async () => ((await t.db.one<{ config: any }>('select config from identity_providers where id = $1', [providerId]))!.config.idpCerts as string[]).map(fp);

    const same = await t.api.post(`/api/admin/identity-providers/${providerId}/refresh-metadata`);
    expect(same.body).toEqual({ ok: true, message: 'Refreshed: no change.' });

    idp.metadataCerts = [idp.otherCert]; // the identity provider moves to its next key
    await t.app.jobs.enqueue('admin.saml_metadata_refresh', {});
    await t.app.jobs.runDue({ types: ['admin.saml_metadata_refresh'] });
    expect(await certs()).toEqual([fp(idp.otherCert), fp(idp.cert)]);
    expect((await audited('identity_provider.metadata_refresh')).pop()).toMatch(/signature checked.*signing certificate added.*kept for up to 7 days/);

    // Eight days on, the old one goes.
    await t.db.query(`update identity_providers set config = jsonb_set(config, '{certsDropped}', $2::jsonb) where id = $1`,
      [providerId, JSON.stringify({ [fp(idp.cert)]: new Date(Date.now() - 8 * 86_400_000).toISOString() })]);
    const later = await t.api.post(`/api/admin/identity-providers/${providerId}/refresh-metadata`);
    expect(later.body.message).toMatch(/signing certificate removed/);
    expect(await certs()).toEqual([fp(idp.otherCert)]);

    // Metadata whose signature does not check out changes nothing.
    const before = await certs();
    idp.metadataCerts = [idp.cert];
    const realSigned = idp.signedMetadataXml.bind(idp);
    idp.signedMetadataXml = (o = {}) => realSigned({ ...o, foreignKey: true });
    const refused = await t.api.post(`/api/admin/identity-providers/${providerId}/refresh-metadata`);
    expect(refused.body.ok).toBe(false);
    expect(refused.body.message).toMatch(/not valid/);
    expect(await certs()).toEqual(before);
    idp.signedMetadataXml = realSigned;
    await t.api.patch('/api/admin/settings', { 'integrations.outbound_enabled': false, 'integrations.allowed_hosts': [] });
  });

  it('merges certificates: new ones in, missing ones kept for the rollover period, expired ones out', () => {
    const now = new Date();
    const r = mergeRefreshedCertificates([idp.cert], {}, [idp.otherCert], now);
    expect(r.idpCerts).toEqual([idp.otherCert, idp.cert]);
    expect(Object.keys(r.certsDropped)).toHaveLength(1);
    const back = mergeRefreshedCertificates(r.idpCerts, r.certsDropped, [idp.cert, idp.otherCert], now);
    expect(back.certsDropped).toEqual({});
    expect(back.removed).toEqual([]);
  });
});
