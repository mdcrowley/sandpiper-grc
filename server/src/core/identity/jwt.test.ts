import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cleanCommonConfig, domainAllowed } from './config.ts';
import { addressProblem } from './http.ts';
import { candidateKeys, checkIdTokenClaims, parseJwt, verifySignature, type Jwk } from './jwt.ts';
import { identityFromClaims, oidcDriver } from './oidc.ts';
import { IdentityError, type OidcConfig } from './types.ts';

const b64u = (v: unknown) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rsaJwk = { ...(rsa.publicKey.export({ format: 'jwk' }) as Jwk), kid: 'r1' };

function token(header: Record<string, unknown>, payload: Record<string, unknown>, key = rsa.privateKey) {
  const input = `${b64u(header)}.${b64u(payload)}`;
  return `${input}.${sign('sha256', Buffer.from(input), key).toString('base64url')}`;
}

const now = 1_800_000_000;
const good = { iss: 'https://idp.example.test', aud: 'client-1', sub: 's1', nonce: 'n1', iat: now, exp: now + 300 };
const rules = { issuer: 'https://idp.example.test', audience: 'client-1', nonce: 'n1', nowSeconds: now };
const reason = (fn: () => void) => {
  try { fn(); return 'passed'; } catch (err) { return err instanceof IdentityError ? err.reason : String(err); }
};

describe('ID token checks', () => {
  it('verifies an RS256 signature and refuses a changed payload or another key', () => {
    const t = token({ alg: 'RS256', kid: 'r1' }, good);
    expect(verifySignature(parseJwt(t), 'RS256', rsaJwk)).toBe(true);
    const [h, , s] = t.split('.');
    expect(verifySignature(parseJwt(`${h}.${b64u({ ...good, sub: 'admin' })}.${s}`), 'RS256', rsaJwk)).toBe(false);
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(verifySignature(parseJwt(token({ alg: 'RS256' }, good, other.privateKey)), 'RS256', rsaJwk)).toBe(false);
    // An RSA signature never passes as ES256, and a key marked for encryption is never a candidate.
    expect(verifySignature(parseJwt(t), 'ES256', rsaJwk)).toBe(false);
    expect(candidateKeys([{ ...rsaJwk, use: 'enc' }], 'r1', 'RS256')).toEqual([]);
    expect(candidateKeys([rsaJwk], 'r1', 'RS256')).toHaveLength(1);
    expect(candidateKeys([rsaJwk], 'r2', 'RS256')).toEqual([]);
  });

  it('refuses malformed tokens', () => {
    expect(reason(() => parseJwt('a.b'))).toMatch(/malformed/);
    expect(reason(() => parseJwt('###.e30.e30'))).toMatch(/malformed/);
    expect(reason(() => parseJwt(`${b64u('not json')}.e30.`))).toMatch(/malformed/);
  });

  it('checks issuer, audience, expiry, issue time and nonce', () => {
    expect(reason(() => checkIdTokenClaims(good, rules))).toBe('passed');
    expect(reason(() => checkIdTokenClaims({ ...good, iss: 'https://evil.example.test' }, rules))).toBe('wrong issuer');
    expect(reason(() => checkIdTokenClaims({ ...good, aud: 'other' }, rules))).toBe('wrong audience');
    expect(reason(() => checkIdTokenClaims({ ...good, aud: ['client-1', 'other'] }, rules))).toBe('wrong authorized party');
    expect(reason(() => checkIdTokenClaims({ ...good, aud: ['client-1', 'other'], azp: 'client-1' }, rules))).toBe('passed');
    expect(reason(() => checkIdTokenClaims({ ...good, exp: now - 200 }, rules))).toBe('token expired');
    expect(reason(() => checkIdTokenClaims({ ...good, iat: now + 600 }, rules))).toBe('issued in the future');
    expect(reason(() => checkIdTokenClaims({ ...good, iat: now - 3600, exp: now + 60 }, rules))).toBe('token too old');
    expect(reason(() => checkIdTokenClaims({ ...good, nonce: 'other' }, rules))).toBe('wrong nonce');
    expect(reason(() => checkIdTokenClaims({ ...good, nonce: undefined }, rules))).toBe('wrong nonce');
    expect(reason(() => checkIdTokenClaims({ ...good, sub: '' }, rules))).toBe('no subject');
  });
});

describe('provider settings', () => {
  it('requires https issuers (plain http only to this machine)', () => {
    expect(addressProblem('https://idp.example.test')).toBeNull();
    expect(addressProblem('http://127.0.0.1:9000')).toBeNull();
    expect(addressProblem('http://idp.example.test')).toMatch(/https/);
    expect(addressProblem('https://user:pw@idp.example.test')).toMatch(/user name/);
  });

  it('keeps mapping and just-in-time accounts off by default', () => {
    const { config, fields } = oidcDriver.cleanConfig({ issuer: 'https://idp.example.test/tenant/v2.0', clientId: 'abc' }, null);
    expect(fields).toEqual({});
    expect(config).toMatchObject({ mappingEnabled: false, jitEnabled: false, trustEmail: false, scopes: 'openid email profile', tokenAuth: 'client_secret_basic' });
    expect(oidcDriver.cleanConfig({ issuer: 'https://x.test', clientId: 'a', extraParams: { state: 'x' } }, null).fields.extraParams).toBeTruthy();
    expect(cleanCommonConfig({ jitEnabled: true, jitDomains: ['Example.ORG', '@staff.example.org'] }, null).config.jitDomains).toEqual(['example.org', 'staff.example.org']);
    expect(domainAllowed('a@staff.example.org', ['example.org'])).toBe(false);
    expect(domainAllowed('a@Example.org', ['example.org'])).toBe(true);
  });

  it('trusts an email only when the provider verifies it or the administrator says so', () => {
    const cfg = oidcDriver.cleanConfig({ issuer: 'https://x.test', clientId: 'a', groupsClaim: 'roles' }, null).config as OidcConfig;
    expect(identityFromClaims({ sub: 's', email: 'A@B.test', email_verified: true, roles: ['r1', 5] }, cfg))
      .toEqual({ subject: 's', email: 'a@b.test', emailVerified: true, displayName: null, groups: ['r1'], amr: [], acr: null, sid: null });
    expect(identityFromClaims({ sub: 's', email: 'a@b.test' }, cfg).emailVerified).toBe(false);
    const upn = { ...cfg, emailClaim: 'preferred_username' };
    expect(identityFromClaims({ sub: 's', preferred_username: 'a@b.test', email_verified: true }, upn).emailVerified).toBe(false);
    expect(identityFromClaims({ sub: 's', preferred_username: 'a@b.test' }, { ...upn, trustEmail: true }).emailVerified).toBe(true);
  });
});
