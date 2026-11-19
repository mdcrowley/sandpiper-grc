import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, errorMessage, listQuery, qs, setUnauthorizedHandler } from './api';

interface Call { url: string; init: RequestInit }

/** Replaces fetch with one that records each call and answers with the given response. */
function stubFetch(respond: (url: string) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(url);
  });
  return calls;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

describe('query strings', () => {
  it('skips empty values and gives nothing when nothing is left', () => {
    expect(qs({ a: 1, b: '', c: null, d: undefined, e: false, f: 'x y' })).toBe('?a=1&e=false&f=x+y');
    expect(qs({})).toBe('');
    expect(qs({ a: '' })).toBe('');
  });

  it('builds the list contract: f.<field> filters, several values joined by commas', () => {
    expect(listQuery({ q: 'pump', sort: 'due_at', dir: 'desc', page: 2, pageSize: 50, filters: { status: ['new', 'open'], 'due_at.gt': '2026-11-01', 'assignee_id.null': true, site: undefined } }))
      .toBe('?q=pump&sort=due_at&dir=desc&page=2&pageSize=50&f.status=new%2Copen&f.due_at.gt=2026-11-01&f.assignee_id.null=true');
    expect(listQuery({ format: 'csv' }, { columns: 'title,status' })).toBe('?format=csv&columns=title%2Cstatus');
    expect(listQuery({})).toBe('');
  });
});

describe('requests', () => {
  it('sends the CSRF header on changes but not on reads', async () => {
    const calls = stubFetch(() => json(200, { ok: true }));
    await api.get('/api/tickets');
    await api.post('/api/tickets', { title: 'A' });
    expect((calls[0].init.headers as Record<string, string>)['X-GRC-CSRF']).toBeUndefined();
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[1].init.method).toBe('POST');
    expect((calls[1].init.headers as Record<string, string>)['X-GRC-CSRF']).toBe('1');
    expect((calls[1].init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(calls[1].init.body).toBe('{"title":"A"}');
    expect(calls[1].init.credentials).toBe('same-origin');
  });

  it('reads JSON, an empty body and 204 No Content', async () => {
    stubFetch((url) => (url === '/a' ? json(200, { n: 1 }) : url === '/b' ? new Response('', { status: 200 }) : new Response(null, { status: 204 })));
    expect(await api.get('/a')).toEqual({ n: 1 });
    expect(await api.get('/b')).toBeUndefined();
    expect(await api.del('/c')).toBeUndefined();
  });

  it('turns an error response into an ApiError with the server message and field errors', async () => {
    stubFetch(() => json(422, { error: { code: 'validation', message: 'Check the form.', fields: { title: 'Required' } } }));
    const err = await api.post('/api/tickets', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'validation', message: 'Check the form.', fields: { title: 'Required' } });
    expect(errorMessage(err)).toBe('Check the form.');
  });

  it('gives a plain message when the error body is not JSON', async () => {
    stubFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    const err = await api.get('/x').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: 'http_502', message: 'The request failed (502).' });
  });

  it('says the server could not be reached when the network fails', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    const err = await api.get('/x').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, code: 'network' });
    expect(errorMessage(new Error('boom'))).toMatch(/Something went wrong/);
  });

  it('re-checks the session on a 401, except for sign-in calls', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    stubFetch(() => json(401, { error: { code: 'unauthorized', message: 'Sign in.' } }));
    await api.get('/api/tickets').catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
    await api.post('/api/auth/login', {}).catch(() => undefined);
    await api.post('/api/setup', {}).catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
