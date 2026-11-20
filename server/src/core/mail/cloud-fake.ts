// Stand-ins for Microsoft's and Google's mail services, for tests (E14-25). One HTTP server on a
// free port on 127.0.0.1 plays the Microsoft sign-in service (/ms-login), Microsoft Graph
// (/graph), Google's token service (/google-token) and the Gmail API (/gmail). It checks the
// signed requests the way the real services do (the client secret, or the certificate's
// signature; the service account's signature), keeps mailboxes in memory, and can be told to
// answer the next call with an error. No network. Invented names only.
import { createPublicKey, createSign, createVerify, generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeMessage { id: string; raw: string; read: boolean; folder: 'inbox' | 'deleted' }
export interface CannedAnswer { status: number; body?: unknown; headers?: Record<string, string> }

export interface FakeCloud {
  base: string;
  endpoints: { microsoftLogin: string; graph: string; googleToken: string; gmail: string };
  microsoft: {
    tenantId: string; clientId: string; clientSecret: string;
    /** A certificate's public key the app registration accepts (for certificate sign-in). */
    certificateKey: KeyObject | null;
    /** Mailboxes that exist, and the ones the app may use. */
    mailboxes: Set<string>; allowed: Set<string>;
    tokensIssued: number;
    sent: { mailbox: string; mime: string }[];
    inbox: Map<string, FakeMessage[]>;
  };
  google: {
    clientEmail: string; key: KeyObject; publicKey: KeyObject;
    /** Scopes domain-wide delegation grants. */
    scopes: Set<string>;
    mailboxes: Set<string>;
    tokensIssued: number; subjects: string[];
    sent: { mailbox: string; mime: string }[];
    inbox: Map<string, FakeMessage[]>;
  };
  /** Answers the next calls whose path contains `match` with these, in order. */
  failNext(match: string, ...answers: CannedAnswer[]): void;
  calls: { method: string; path: string }[];
  close(): Promise<void>;
}

const b64urlJson = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

function verifyJwt(jwt: string, key: KeyObject): { header: any; claims: any } | null {
  const [h, c, s] = jwt.split('.');
  if (!h || !c || !s) return null;
  const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(key, Buffer.from(s, 'base64url'));
  return ok ? { header: b64urlJson(h), claims: b64urlJson(c) } : null;
}

async function bodyOf(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function startFakeCloud(): Promise<FakeCloud> {
  const { privateKey: gKey, publicKey: gPub } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const canned: { match: string; answer: CannedAnswer }[] = [];
  const calls: { method: string; path: string }[] = [];
  const msTokens = new Set<string>();
  const gTokens = new Map<string, { sub: string; scope: string }>();

  const fake: FakeCloud = {
    base: '', endpoints: { microsoftLogin: '', graph: '', googleToken: '', gmail: '' },
    microsoft: {
      tenantId: '11111111-2222-3333-4444-555555555555', clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', clientSecret: 'fake~graph.secret_value',
      certificateKey: null, mailboxes: new Set(['desk@example.org', 'grc@example.org']), allowed: new Set(['desk@example.org', 'grc@example.org']),
      tokensIssued: 0, sent: [], inbox: new Map(),
    },
    google: {
      clientEmail: 'grc-mailer@example-project.iam.gserviceaccount.test', key: gKey, publicKey: gPub,
      scopes: new Set(['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.modify']),
      mailboxes: new Set(['desk@example.org', 'grc@example.org']), tokensIssued: 0, subjects: [], sent: [], inbox: new Map(),
    },
    failNext(match, ...answers) { for (const answer of answers) canned.push({ match, answer }); },
    calls,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };

  const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  async function microsoftToken(req: IncomingMessage, res: ServerResponse, tenant: string) {
    const form = new URLSearchParams((await bodyOf(req)).toString('utf8'));
    const ms = fake.microsoft;
    const fail = (code: string, text: string) => json(res, 400, { error: 'invalid_request', error_description: `AADSTS${code}: ${text}\r\nTrace ID: x` });
    if (tenant !== ms.tenantId) return fail('90002', `Tenant '${tenant}' not found.`);
    if (form.get('client_id') !== ms.clientId) return fail('700016', 'Application not found in the directory.');
    if (form.get('grant_type') !== 'client_credentials') return fail('70003', 'Unsupported grant type.');
    if (form.get('client_assertion')) {
      const v = ms.certificateKey && verifyJwt(form.get('client_assertion')!, ms.certificateKey);
      if (!v || v.claims.iss !== ms.clientId || !String(v.claims.aud).endsWith(`/${tenant}/oauth2/v2.0/token`) || !v.header.x5t) {
        return fail('700027', 'Client assertion contains an invalid signature.');
      }
    } else if (form.get('client_secret') !== ms.clientSecret) {
      return fail('7000215', 'Invalid client secret provided.');
    }
    const token = `ms-${randomUUID()}`;
    msTokens.add(token);
    ms.tokensIssued += 1;
    json(res, 200, { token_type: 'Bearer', expires_in: 3599, access_token: token });
  }

  async function graph(req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams) {
    const ms = fake.microsoft;
    const auth = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!msTokens.has(auth)) return json(res, 401, { error: { code: 'InvalidAuthenticationToken', message: 'Access token is empty or invalid.' } });
    const m = /^\/v1\.0\/users\/([^/]+)(\/.*)$/.exec(path);
    if (!m) return json(res, 404, { error: { code: 'ResourceNotFound', message: 'Unknown path.' } });
    const mailbox = decodeURIComponent(m[1]).toLowerCase();
    const rest = m[2];
    if (!ms.mailboxes.has(mailbox)) return json(res, 404, { error: { code: 'ErrorInvalidUser', message: `The requested user '${mailbox}' is invalid.` } });
    if (!ms.allowed.has(mailbox)) return json(res, 403, { error: { code: 'ErrorAccessDenied', message: 'Access is denied. Check credentials and try again.' } });
    const box = ms.inbox.get(mailbox) ?? [];
    ms.inbox.set(mailbox, box);
    if (req.method === 'POST' && rest === '/sendMail') {
      if (!/^text\/plain/.test(String(req.headers['content-type']))) return json(res, 400, { error: { code: 'ErrorMimeContentInvalid', message: 'Expected MIME.' } });
      const mime = Buffer.from((await bodyOf(req)).toString('utf8'), 'base64').toString('utf8');
      ms.sent.push({ mailbox, mime });
      res.writeHead(202);
      return res.end();
    }
    if (req.method === 'GET' && rest === '/mailFolders/inbox/messages') {
      const unread = query.get('$filter') === 'isRead eq false';
      const top = Number(query.get('$top') ?? 10);
      return json(res, 200, { value: box.filter((x) => x.folder === 'inbox' && (!unread || !x.read)).slice(0, top).map((x) => ({ id: x.id })) });
    }
    const one = /^\/messages\/([^/]+)(\/.*)?$/.exec(rest);
    const msg = one ? box.find((x) => x.id === decodeURIComponent(one[1])) : undefined;
    if (!one || !msg) return json(res, 404, { error: { code: 'ErrorItemNotFound', message: 'Not found.' } });
    if (req.method === 'GET' && one[2] === '/$value') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(msg.raw); }
    if (req.method === 'POST' && one[2] === '/move') {
      const b = JSON.parse((await bodyOf(req)).toString('utf8'));
      if (b.destinationId !== 'deleteditems') return json(res, 400, { error: { code: 'ErrorInvalidIdMalformed', message: 'Bad folder.' } });
      msg.folder = 'deleted';
      return json(res, 201, { id: msg.id });
    }
    if (req.method === 'PATCH' && !one[2]) {
      const b = JSON.parse((await bodyOf(req)).toString('utf8'));
      if (typeof b.isRead === 'boolean') msg.read = b.isRead;
      return json(res, 200, { id: msg.id });
    }
    return json(res, 405, { error: { code: 'MethodNotAllowed', message: 'No.' } });
  }

  async function googleToken(req: IncomingMessage, res: ServerResponse) {
    const form = new URLSearchParams((await bodyOf(req)).toString('utf8'));
    const g = fake.google;
    if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') return json(res, 400, { error: 'unsupported_grant_type' });
    const v = verifyJwt(form.get('assertion') ?? '', g.publicKey);
    if (!v || v.claims.iss !== g.clientEmail) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' });
    if (!g.scopes.has(v.claims.scope)) return json(res, 401, { error: 'unauthorized_client', error_description: 'Client is unauthorized to retrieve access tokens using this method, or client not authorized for any of the scopes requested.' });
    if (!g.mailboxes.has(String(v.claims.sub).toLowerCase())) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid email or User ID' });
    const token = `g-${randomUUID()}`;
    gTokens.set(token, { sub: String(v.claims.sub).toLowerCase(), scope: v.claims.scope });
    g.tokensIssued += 1;
    g.subjects.push(String(v.claims.sub));
    json(res, 200, { access_token: token, expires_in: 3599, token_type: 'Bearer' });
  }

  async function gmail(req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams) {
    const g = fake.google;
    const t = gTokens.get(String(req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (!t) return json(res, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } });
    const send = /^\/upload\/gmail\/v1\/users\/([^/]+)\/messages\/send$/.exec(path);
    const other = /^\/gmail\/v1\/users\/([^/]+)\/messages(?:\/([^/]+))?(\/trash|\/modify)?$/.exec(path);
    const mailbox = decodeURIComponent((send ?? other)?.[1] ?? '').toLowerCase();
    if (!send && !other) return json(res, 404, { error: { code: 404, message: 'Not found', status: 'NOT_FOUND' } });
    if (mailbox !== t.sub) return json(res, 403, { error: { code: 403, message: 'Delegation denied', errors: [{ reason: 'forbidden' }], status: 'PERMISSION_DENIED' } });
    if (send) {
      if (t.scope !== 'https://www.googleapis.com/auth/gmail.send' || query.get('uploadType') !== 'media') {
        return json(res, 403, { error: { code: 403, message: 'Insufficient Permission', errors: [{ reason: 'insufficientPermissions' }] } });
      }
      g.sent.push({ mailbox, mime: (await bodyOf(req)).toString('utf8') });
      return json(res, 200, { id: `g${g.sent.length}`, threadId: 't1', labelIds: ['SENT'] });
    }
    if (t.scope !== 'https://www.googleapis.com/auth/gmail.modify') return json(res, 403, { error: { code: 403, message: 'Insufficient Permission', errors: [{ reason: 'insufficientPermissions' }] } });
    const box = g.inbox.get(mailbox) ?? [];
    g.inbox.set(mailbox, box);
    const [, , id, action] = other!;
    if (!id && req.method === 'GET') {
      const q = query.get('q') ?? '';
      const rows = box.filter((x) => x.folder === 'inbox' && (!q.includes('is:unread') || !x.read)).slice(0, Number(query.get('maxResults') ?? 100));
      return json(res, 200, rows.length ? { messages: rows.map((x) => ({ id: x.id, threadId: x.id })), resultSizeEstimate: rows.length } : { resultSizeEstimate: 0 });
    }
    const msg = box.find((x) => x.id === id);
    if (!msg) return json(res, 404, { error: { code: 404, message: 'Requested entity was not found.', errors: [{ reason: 'notFound' }] } });
    if (req.method === 'GET' && !action) {
      if (query.get('format') !== 'raw') return json(res, 400, { error: { code: 400, message: 'Expected raw.' } });
      return json(res, 200, { id: msg.id, raw: Buffer.from(msg.raw).toString('base64url'), sizeEstimate: msg.raw.length });
    }
    if (req.method === 'POST' && action === '/trash') { msg.folder = 'deleted'; return json(res, 200, { id: msg.id, labelIds: ['TRASH'] }); }
    if (req.method === 'POST' && action === '/modify') {
      const b = JSON.parse((await bodyOf(req)).toString('utf8'));
      if ((b.removeLabelIds ?? []).includes('UNREAD')) msg.read = true;
      return json(res, 200, { id: msg.id });
    }
    return json(res, 405, { error: { code: 405, message: 'No.' } });
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    calls.push({ method: req.method ?? 'GET', path: url.pathname });
    const i = canned.findIndex((c) => url.pathname.includes(c.match));
    if (i >= 0) {
      const [{ answer }] = canned.splice(i, 1);
      void bodyOf(req).then(() => json(res, answer.status, answer.body, answer.headers));
      return;
    }
    const p = url.pathname;
    const route = p.startsWith('/ms-login/') ? microsoftToken(req, res, decodeURIComponent(p.split('/')[2] ?? ''))
      : p.startsWith('/graph/') ? graph(req, res, p.slice('/graph'.length), url.searchParams)
        : p === '/google-token' ? googleToken(req, res)
          : p.startsWith('/gmail/') ? gmail(req, res, p.slice('/gmail'.length), url.searchParams)
            : Promise.resolve(json(res, 404, { error: 'not found' }));
    route.catch((err) => json(res, 500, { error: String(err) }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.base = base;
  fake.endpoints = { microsoftLogin: `${base}/ms-login`, graph: `${base}/graph`, googleToken: `${base}/google-token`, gmail: `${base}/gmail` };
  return fake;
}

/** The service account's JSON key file for the fake Google service. */
export function serviceAccountKeyJson(fake: FakeCloud): string {
  return JSON.stringify({
    type: 'service_account', project_id: 'example-project', private_key_id: 'kid-0001',
    private_key: fake.google.key.export({ type: 'pkcs8', format: 'pem' }), client_email: fake.google.clientEmail,
    client_id: '100000000000000000001', token_uri: 'https://attacker.example.invalid/token',
  });
}

// ---------- a self-signed certificate, built here so no key is kept in the repository ----------

const der = (tag: number, content: Buffer): Buffer => {
  const len = content.length;
  const head = len < 0x80 ? Buffer.from([len]) : (() => {
    const bytes: number[] = [];
    for (let n = len; n > 0; n >>= 8) bytes.unshift(n & 0xff);
    return Buffer.from([0x80 | bytes.length, ...bytes]);
  })();
  return Buffer.concat([Buffer.from([tag]), head, content]);
};
const seq = (...parts: Buffer[]) => der(0x30, Buffer.concat(parts));
const oid = (dotted: string) => {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const bytes = [a * 40 + b];
  for (const n of rest) {
    const chunk: number[] = [];
    let v = n;
    do { chunk.unshift(v & 0x7f); v >>= 7; } while (v > 0);
    for (let i = 0; i < chunk.length - 1; i++) chunk[i] |= 0x80;
    bytes.push(...chunk);
  }
  return der(0x06, Buffer.from(bytes));
};
const utcTime = (d: Date) => der(0x17, Buffer.from(`${d.toISOString().slice(2, 19).replace(/[-T:]/g, '')}Z`));
const nameOf = (cn: string) => seq(der(0x31, seq(oid('2.5.4.3'), der(0x0c, Buffer.from(cn)))));

/** A certificate and its private key as PEM text, as an administrator would paste them; `days` may be negative for an expired one. */
export function selfSignedCertificate(cn = 'Sandpiper mail test', days = 365): { pem: string; key: KeyObject; publicKey: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const alg = seq(oid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00]));
  const now = Date.now();
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([0x02]))),
    der(0x02, Buffer.from([0x01, 0x23, 0x45])),
    alg, nameOf(cn),
    seq(utcTime(new Date(now - 2 * 86_400_000 + Math.min(0, days) * 86_400_000)), utcTime(new Date(now + days * 86_400_000))),
    nameOf(cn),
    publicKey.export({ type: 'spki', format: 'der' }),
  );
  const signature = createSign('RSA-SHA256').update(tbs).sign(privateKey);
  const cert = seq(tbs, alg, der(0x03, Buffer.concat([Buffer.from([0x00]), signature])));
  const certPem = `-----BEGIN CERTIFICATE-----\n${cert.toString('base64').replace(/(.{64})/g, '$1\n').trim()}\n-----END CERTIFICATE-----\n`;
  return { pem: `${certPem}${privateKey.export({ type: 'pkcs8', format: 'pem' })}`, key: privateKey, publicKey: createPublicKey(privateKey) };
}
