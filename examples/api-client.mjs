// A small API client with no dependencies (Node.js 18 or later), showing the conventions in
// docs/api.md: the /api/v1 base path, a token, paging through Link headers, retries that respect
// Retry-After, Idempotency-Key on creates and If-Match on updates.
//
//   $env:GRC_URL = 'http://127.0.0.1:8080'      # your installation
//   $env:GRC_TOKEN = 'grc_pat_...'               # a personal access token (Account security > API tokens)
//   node examples/api-client.mjs whoami
//   node examples/api-client.mjs open-tickets             # needs tickets.view
//   node examples/api-client.mjs raise "Depot north switch unreachable"   # needs tickets.create
//   node examples/api-client.mjs risk-summary             # needs risks.view and security.view
//
// Copy the GrcClient class into your own integration; everything else here is the demonstration.
import { randomUUID } from 'node:crypto';

export class GrcError extends Error {
  constructor(status, body, requestId) {
    super(`${status} ${body?.error?.code ?? 'error'}: ${body?.error?.message ?? 'no message'} (request ${requestId})`);
    this.status = status;
    this.code = body?.error?.code;
    this.fields = body?.error?.fields;
    this.requestId = requestId;
  }
}

export class GrcClient {
  /** @param {{ baseUrl: string, token: string, retries?: number }} opts */
  constructor({ baseUrl, token, retries = 4 }) {
    if (!token) throw new Error('A personal access token is needed (GRC_TOKEN).');
    this.origin = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.retries = retries;
    /** The rate-limit headers of the last answer: { limit, remaining, reset }. */
    this.rateLimit = null;
  }

  /** One request. `path` is under /api/v1 ('/tickets') or a full path from a Link header. */
  async request(method, path, { body, headers = {}, query } = {}) {
    const url = new URL(path.startsWith('/api/') ? path : `/api/v1${path}`, this.origin);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const requestId = `client-${randomUUID()}`;
    for (let attempt = 0; ; attempt += 1) {
      let res;
      try {
        res = await fetch(url, {
          method,
          headers: {
            authorization: `Bearer ${this.token}`, accept: 'application/json', 'x-request-id': requestId,
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers,
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        if (attempt >= this.retries) throw err;
        await sleep(backoff(attempt)); // network failure: safe to repeat a GET, or a POST with an Idempotency-Key
        continue;
      }
      const limit = res.headers.get('ratelimit-limit');
      if (limit) this.rateLimit = { limit: Number(limit), remaining: Number(res.headers.get('ratelimit-remaining')), reset: Number(res.headers.get('ratelimit-reset')) };
      if (res.headers.get('deprecation')) console.warn(`Deprecated: ${method} ${url.pathname} (sunset ${res.headers.get('sunset') ?? 'not set'})`);
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.retries) {
        const after = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : backoff(attempt));
        continue;
      }
      const text = await res.text();
      const data = text && (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) : text;
      if (!res.ok) throw new GrcError(res.status, data, res.headers.get('x-request-id') ?? requestId);
      return { data, headers: res.headers, status: res.status };
    }
  }

  get(path, query) { return this.request('GET', path, { query }).then((r) => r.data); }

  /** Every row of a list, following the Link headers page by page. */
  async *rows(path, query = {}) {
    let next = path;
    let q = { pageSize: 500, ...query };
    while (next) {
      const { data, headers } = await this.request('GET', next, { query: q });
      yield* data.rows;
      next = /<([^>]+)>;\s*rel="next"/.exec(headers.get('link') ?? '')?.[1] ?? null;
      q = undefined; // the link carries the query
    }
  }

  /** Creates a record; the same `key` on a retry returns the first answer instead of a second record. */
  create(path, record, key = randomUUID()) {
    return this.request('POST', path, { body: record, headers: { 'idempotency-key': key } }).then((r) => r.data);
  }

  /** Changes a record only if it is still at the version `etag` (from an earlier read); 409 otherwise. */
  update(path, changes, etag) {
    return this.request('PATCH', path, { body: changes, headers: etag ? { 'if-match': etag } : {} });
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const backoff = (attempt) => Math.min(30_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);

// ---- demonstration ----
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const grc = new GrcClient({ baseUrl: process.env.GRC_URL ?? 'http://127.0.0.1:8080', token: process.env.GRC_TOKEN });
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'whoami') {
      const state = await grc.get('/auth/state');
      console.log(`${state.user.displayName}: ${state.permissions.join(', ')}`);
    } else if (command === 'open-tickets') {
      let n = 0;
      for await (const t of grc.rows('/tickets', { 'f.status': 'new,assigned,in_progress', sort: 'opened_at', dir: 'asc' })) {
        n += 1;
        console.log(`${t.ref}\t${t._display?.status ?? t.status}\t${t.title}`);
      }
      console.log(`${n} open ticket(s). Rate limit: ${JSON.stringify(grc.rateLimit)}`);
    } else if (command === 'raise') {
      const title = args.join(' ') || 'Raised from the example client';
      // A key made from what identifies the event, so running this twice raises one ticket.
      const key = `example-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 200)}`;
      const made = await grc.create('/tickets', { type: 'incident', title, urgency: 'medium', impact: 'individual' }, key);
      console.log(`Raised ${made.ref}: ${made.title}`);
    } else if (command === 'risk-summary') {
      const s = await grc.get('/risks/summary');
      for (const l of s.levels) console.log(`${l.label}\t${l.count}`);
      console.log(`${s.total} open risk(s); ${s.reviews_due} review(s) due`);
    } else {
      console.log('Commands: whoami | open-tickets | raise <title> | risk-summary');
    }
  } catch (err) {
    console.error(err instanceof GrcError ? err.message : err);
    process.exitCode = 1;
  }
}
