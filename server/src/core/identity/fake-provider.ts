// A stand-in OpenID Connect provider for tests and local trials. NEVER used by the application itself.
//
// An in-process HTTP server on 127.0.0.1 (port 0 = any free port) that serves a discovery document,
// a key set, an authorisation endpoint that approves at once (or shows a one-button page), and a token
// endpoint that checks the client, the redirect address and PKCE, then signs an ID token with a key
// generated at start. Test controls: `user`, `overrides`, `badSignature`, `alg`, `rotateKeys()`.
import { createHash, generateKeyPairSync, randomBytes, sign as cryptoSign, constants, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeUser { sub: string; email?: string; email_verified?: boolean; name?: string; groups?: string[] }

interface KeyPair { kid: string; rsa: { priv: KeyObject; pub: KeyObject }; ec: { priv: KeyObject; pub: KeyObject } }

function makeKeys(): KeyPair {
  const kid = randomBytes(6).toString('hex');
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { kid, rsa: { priv: rsa.privateKey, pub: rsa.publicKey }, ec: { priv: ec.privateKey, pub: ec.publicKey } };
}

export interface FakeProvider {
  issuer: string;
  port: number;
  clientId: string;
  clientSecret: string;
  /** Who "signs in" at the provider next. */
  user: FakeUser;
  /** Claims to put in (or, with undefined, take out of) the next ID tokens. */
  overrides: Record<string, unknown>;
  /** Sign with a key that is not in the key set. */
  badSignature: boolean;
  alg: 'RS256' | 'ES256' | 'PS256';
  /** Show a page with a "Continue" button instead of approving at once (for a browser run). */
  interactive: boolean;
  /** New signing keys; the key set then lists only the new ones. */
  rotateKeys(): void;
  /** Counts of requests by path, to prove when nothing was fetched. */
  hits: Record<string, number>;
  close(): Promise<void>;
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export async function startFakeProvider(opts: { clientId?: string; clientSecret?: string; port?: number } = {}): Promise<FakeProvider> {
  let keys = makeKeys();
  const codes = new Map<string, { nonce: string; challenge: string; redirectUri: string; clientId: string; user: FakeUser }>();
  const hits: Record<string, number> = {};

  const fake = {
    issuer: '', port: 0,
    clientId: opts.clientId ?? 'grc-test-client',
    clientSecret: opts.clientSecret ?? 'test-client-secret-value',
    user: { sub: 'user-0001', email: 'person@example.test', email_verified: true, name: 'Test Person', groups: [] } as FakeUser,
    overrides: {} as Record<string, unknown>,
    badSignature: false,
    alg: 'RS256' as FakeProvider['alg'],
    interactive: false,
    rotateKeys() { keys = makeKeys(); },
    hits,
    close: async () => {},
  };

  function jwk(): Record<string, unknown>[] {
    const rsa = { ...(keys.rsa.pub.export({ format: 'jwk' }) as object), kid: `${keys.kid}-rsa`, use: 'sig' };
    const ec = { ...(keys.ec.pub.export({ format: 'jwk' }) as object), kid: `${keys.kid}-ec`, use: 'sig', alg: 'ES256' };
    return [rsa, ec];
  }

  function signToken(claims: Record<string, unknown>): string {
    const alg = fake.alg;
    const signer = fake.badSignature ? makeKeys() : keys;
    const header = { alg, kid: `${keys.kid}-${alg === 'ES256' ? 'ec' : 'rsa'}`, typ: 'JWT' };
    const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
    let sig: Buffer;
    if (alg === 'ES256') sig = cryptoSign('sha256', Buffer.from(input), { key: signer.ec.priv, dsaEncoding: 'ieee-p1363' });
    else if (alg === 'PS256') sig = cryptoSign('sha256', Buffer.from(input), { key: signer.rsa.priv, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 });
    else sig = cryptoSign('sha256', Buffer.from(input), signer.rsa.priv);
    return `${input}.${b64u(sig)}`;
  }

  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) => new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
  });

  function approve(res: ServerResponse, q: URLSearchParams) {
    const code = randomBytes(16).toString('base64url');
    codes.set(code, {
      nonce: q.get('nonce') ?? '', challenge: q.get('code_challenge') ?? '', redirectUri: q.get('redirect_uri') ?? '',
      clientId: q.get('client_id') ?? '', user: { ...fake.user },
    });
    const back = new URL(q.get('redirect_uri')!);
    back.searchParams.set('code', code);
    back.searchParams.set('state', q.get('state') ?? '');
    back.searchParams.set('iss', fake.issuer);
    res.writeHead(302, { location: back.toString() });
    res.end();
  }

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', fake.issuer || 'http://127.0.0.1');
    hits[url.pathname] = (hits[url.pathname] ?? 0) + 1;
    if (url.pathname === '/.well-known/openid-configuration') {
      return send(res, 200, {
        issuer: fake.issuer,
        authorization_endpoint: `${fake.issuer}/authorize`,
        token_endpoint: `${fake.issuer}/token`,
        jwks_uri: `${fake.issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256', 'ES256', 'PS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      });
    }
    if (url.pathname === '/jwks') return send(res, 200, { keys: jwk() });
    if (url.pathname === '/authorize' || url.pathname === '/authorize/approve') {
      const q = url.searchParams;
      if (q.get('client_id') !== fake.clientId || !q.get('redirect_uri') || q.get('response_type') !== 'code') {
        return send(res, 400, { error: 'invalid_request' });
      }
      if (fake.interactive && url.pathname === '/authorize') {
        const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Example identity provider</title>
<style>body{font-family:system-ui,sans-serif;background:#eef2f6;display:grid;place-items:center;min-height:100vh;margin:0}
main{background:#fff;padding:32px;border-radius:12px;box-shadow:0 2px 12px #0002;max-width:360px}h1{font-size:20px}
a{display:inline-block;background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none}</style></head>
<body><main><h1>Example identity provider</h1><p>A stand-in provider for trials. Continue as <strong>${esc(fake.user.email ?? fake.user.sub)}</strong>?</p>
<a id="continue" href="/authorize/approve?${esc(q.toString())}">Continue</a></main></body></html>`);
      }
      return approve(res, q);
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      let clientId = form.get('client_id');
      let secret = form.get('client_secret');
      const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? '');
      if (basic) {
        const [id, pw] = Buffer.from(basic[1], 'base64').toString().split(':').map(decodeURIComponent);
        clientId = id; secret = pw;
      }
      if (clientId !== fake.clientId || secret !== fake.clientSecret) return send(res, 401, { error: 'invalid_client' });
      const entry = codes.get(form.get('code') ?? '');
      codes.delete(form.get('code') ?? '');
      if (!entry || entry.clientId !== clientId || entry.redirectUri !== form.get('redirect_uri')) return send(res, 400, { error: 'invalid_grant' });
      const challenge = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
      if (challenge !== entry.challenge) return send(res, 400, { error: 'invalid_grant', error_description: 'PKCE check failed' });
      const now = Math.floor(Date.now() / 1000);
      const claims: Record<string, unknown> = {
        iss: fake.issuer, aud: fake.clientId, iat: now, exp: now + 300, nonce: entry.nonce, ...entry.user,
      };
      for (const [k, v] of Object.entries(fake.overrides)) {
        if (v === undefined) delete claims[k];
        else claims[k] = v;
      }
      return send(res, 200, { access_token: randomBytes(16).toString('hex'), token_type: 'Bearer', expires_in: 300, id_token: signToken(claims) });
    }
    return send(res, 404, { error: 'not_found' });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  fake.port = (server.address() as AddressInfo).port;
  fake.issuer = `http://127.0.0.1:${fake.port}`;
  fake.close = () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); });
  return fake;
}
