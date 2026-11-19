// An S3-compatible object store, spoken to directly over HTTP(S) with AWS Signature Version 4
// (computed here with node:crypto; no SDK). Works with any store that implements the S3 API:
// path-style (https://endpoint/bucket/key) or virtual-hosted (https://bucket.endpoint/key) URLs.
//
// It is an outbound connection: nothing here runs unless an administrator chooses the object
// store on the File settings page (see config.ts).
//
// Uploads are sent in parts of PART_BYTES, so at most one part is held in memory: a file smaller
// than that is one PutObject, a larger one a multipart upload. Downloads stream.
import { createHash, createHmac } from 'node:crypto';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import type { FileStorage } from './storage.ts';
import { checkStorageKey } from './storage.ts';

export const PART_BYTES = 8 * 1024 * 1024;
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface S3Config {
  /** Base address of the service, for example https://s3.example.net or http://127.0.0.1:9000. */
  endpoint: string;
  region: string;
  bucket: string;
  /** true: https://endpoint/bucket/key; false: https://bucket.endpoint/key. */
  pathStyle: boolean;
  /** Put in front of every object name, for example "grc/". */
  prefix: string;
  /** Server-side encryption asked of the store: none, AES256 (store-managed keys) or aws:kms. */
  sse: 'none' | 'AES256' | 'aws:kms';
  kmsKeyId?: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  timeoutMs?: number;
  /** Tests only: resolves host names (so virtual-hosted names reach a local test server). */
  lookup?: LookupFunction;
}

export class S3Error extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------- Signature Version 4

/** RFC 3986 encoding as Signature Version 4 wants it. */
export function uriEncode(value: string, keepSlash = false): string {
  const out = encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? out.replace(/%2F/g, '/') : out;
}

const sha256hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data, 'utf8').digest();

export interface SignInput {
  method: string;
  /** The path exactly as sent, already encoded (for example "/bucket/aa/bb/key"). */
  path: string;
  query: Record<string, string>;
  /** Every header to sign, including host and x-amz-date. Names in any case. */
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  service?: string;
}

/** The value of the Authorization header for a request. */
export function signV4(input: SignInput): { authorization: string; canonicalRequest: string; stringToSign: string } {
  const service = input.service ?? 's3';
  const headers = Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')] as const);
  headers.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const signedHeaders = headers.map(([k]) => k).join(';');
  const amzDate = headers.find(([k]) => k === 'x-amz-date')?.[1];
  if (!amzDate) throw new Error('x-amz-date must be signed');
  const date = amzDate.slice(0, 8);
  const query = Object.entries(input.query)
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [
    input.method, input.path, query,
    headers.map(([k, v]) => `${k}:${v}\n`).join(''), signedHeaders, input.payloadHash,
  ].join('\n');
  const scope = `${date}/${input.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${input.secretAccessKey}`, date);
  const kSigning = hmac(hmac(hmac(kDate, input.region), service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    canonicalRequest,
    stringToSign,
  };
}

export const amzDateOf = (now: Date) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// ---------------------------------------------------------------- client

const unxml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? unxml(m[1]) : undefined;
};

async function readAll(res: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of res) parts.push(Buffer.from(c));
  return Buffer.concat(parts);
}

export interface S3Client {
  readonly config: S3Config;
  /** Where objects go, for messages: "bucket/prefix at endpoint". */
  describe(): string;
  putObject(name: string, source: Readable): Promise<void>;
  getObject(name: string): Promise<Readable>;
  headObject(name: string): Promise<{ size: number } | null>;
  deleteObject(name: string): Promise<void>;
  /** Every object whose name starts with `prefix` (relative to the configured prefix). */
  listObjects(prefix: string): Promise<{ name: string; size: number }[]>;
  /** Writes, reads back and deletes a small object: proves the settings work. */
  test(): Promise<void>;
}

export function s3Client(config: S3Config): S3Client {
  const base = new URL(config.endpoint);
  if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new Error('The endpoint must start with https:// or http://');
  const secure = base.protocol === 'https:';
  const defaultPort = secure ? '443' : '80';
  const hostOnly = base.hostname;
  const port = base.port && base.port !== defaultPort ? base.port : '';
  const hostHeader = (config.pathStyle ? hostOnly : `${config.bucket}.${hostOnly}`) + (port ? `:${port}` : '');
  const basePath = base.pathname.replace(/\/+$/, '');
  const prefix = config.prefix ?? '';
  const timeoutMs = config.timeoutMs ?? 60_000;

  const pathFor = (name: string | null) => {
    const key = name === null ? '' : uriEncode(`${prefix}${name}`, true);
    return config.pathStyle ? `${basePath}/${uriEncode(config.bucket)}${name === null ? '' : `/${key}`}` : `${basePath}/${key}`;
  };

  function send(method: string, name: string | null, opts: { query?: Record<string, string>; headers?: Record<string, string>; body?: Buffer } = {}): Promise<IncomingMessage> {
    const body = opts.body;
    const payloadHash = body ? sha256hex(body) : EMPTY_SHA256;
    const headers: Record<string, string> = {
      host: hostHeader,
      'x-amz-date': amzDateOf(new Date()),
      'x-amz-content-sha256': payloadHash,
      ...(config.sessionToken ? { 'x-amz-security-token': config.sessionToken } : {}),
      ...(opts.headers ?? {}),
    };
    const path = pathFor(name);
    const query = opts.query ?? {};
    const { authorization } = signV4({
      method, path, query, headers, payloadHash, region: config.region,
      accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey,
    });
    const qs = Object.entries(query).map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join('&');
    const lib = secure ? https : http;
    return new Promise((resolve, reject) => {
      const req = lib.request({
        method,
        host: config.pathStyle ? hostOnly : `${config.bucket}.${hostOnly}`,
        port: base.port || defaultPort,
        path: qs ? `${path}?${qs}` : path,
        headers: { ...headers, authorization, ...(body ? { 'content-length': String(body.length) } : method === 'PUT' || method === 'POST' ? { 'content-length': '0' } : {}) },
        ...(config.lookup ? { lookup: config.lookup } : {}),
        // Virtual-hosted names on a custom endpoint: certificate checks still apply to the name used.
      }, resolve);
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`The object store did not answer within ${Math.round(timeoutMs / 1000)} seconds.`)));
      req.on('error', reject);
      req.end(body);
    });
  }

  async function fail(res: IncomingMessage, what: string): Promise<never> {
    const text = (await readAll(res)).toString('utf8');
    const code = tag(text, 'Code') ?? `HTTP ${res.statusCode}`;
    const message = tag(text, 'Message') ?? res.statusMessage ?? '';
    throw new S3Error(res.statusCode ?? 0, code, `The object store refused to ${what}: ${code}${message ? ` (${message})` : ''}`);
  }

  const sseHeaders = (): Record<string, string> => {
    if (config.sse === 'AES256') return { 'x-amz-server-side-encryption': 'AES256' };
    if (config.sse === 'aws:kms') {
      return { 'x-amz-server-side-encryption': 'aws:kms', ...(config.kmsKeyId ? { 'x-amz-server-side-encryption-aws-kms-key-id': config.kmsKeyId } : {}) };
    }
    return {};
  };

  async function ok(res: IncomingMessage, what: string, allowed = [200]): Promise<Buffer> {
    if (!allowed.includes(res.statusCode ?? 0)) await fail(res, what);
    return readAll(res);
  }

  const client: S3Client = {
    config,
    describe: () => `${config.bucket}${prefix ? `/${prefix}` : ''} at ${base.origin}`,

    async putObject(name, source) {
      let parts: Buffer[] = [];
      let held = 0;
      let uploadId: string | null = null;
      const etags: string[] = [];
      const flushPart = async (data: Buffer) => {
        if (!uploadId) {
          const created = await ok(await send('POST', name, { query: { uploads: '' }, headers: sseHeaders() }), 'start an upload');
          uploadId = tag(created.toString('utf8'), 'UploadId') ?? null;
          if (!uploadId) throw new S3Error(500, 'NoUploadId', 'The object store did not start the upload.');
        }
        const res = await send('PUT', name, { query: { partNumber: String(etags.length + 1), uploadId }, body: data });
        await ok(res, 'store part of a file');
        etags.push(String(res.headers.etag ?? ''));
      };
      try {
        for await (const chunk of source) {
          const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          parts.push(b);
          held += b.length;
          if (held >= PART_BYTES) {
            const all = Buffer.concat(parts);
            parts = [];
            held = 0;
            await flushPart(all);
          }
        }
        const rest = Buffer.concat(parts);
        if (!uploadId) {
          await ok(await send('PUT', name, { body: rest, headers: sseHeaders() }), 'store a file');
          return;
        }
        if (rest.length) await flushPart(rest);
        const xml = `<CompleteMultipartUpload>${etags.map((e, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${e.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
        const done = await ok(await send('POST', name, { query: { uploadId }, body: Buffer.from(xml), headers: { 'content-type': 'application/xml' } }), 'finish an upload');
        // A completion can fail after the 200 status has been sent: the body then holds an error.
        if (done.toString('utf8').includes('<Error>')) throw new S3Error(500, tag(done.toString('utf8'), 'Code') ?? 'Error', 'The object store could not finish the upload.');
      } catch (err) {
        if (uploadId) await send('DELETE', name, { query: { uploadId } }).then((r) => r.resume(), () => undefined);
        throw err;
      }
    },

    async getObject(name) {
      const res = await send('GET', name);
      if (res.statusCode !== 200) await fail(res, 'send a file');
      return res;
    },

    async headObject(name) {
      const res = await send('HEAD', name);
      res.resume();
      if (res.statusCode === 404) return null;
      if (res.statusCode !== 200) throw new S3Error(res.statusCode ?? 0, `HTTP ${res.statusCode}`, `The object store refused to describe a file: HTTP ${res.statusCode}`);
      return { size: Number(res.headers['content-length'] ?? 0) };
    },

    async deleteObject(name) {
      await ok(await send('DELETE', name), 'delete a file', [200, 204, 404]);
    },

    async listObjects(sub) {
      const out: { name: string; size: number }[] = [];
      let token: string | undefined;
      do {
        const query: Record<string, string> = { 'list-type': '2', prefix: `${prefix}${sub}` };
        if (token) query['continuation-token'] = token;
        const xml = (await ok(await send('GET', null, { query }), 'list files')).toString('utf8');
        for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const key = tag(m[1], 'Key') ?? '';
          out.push({ name: key.slice(prefix.length), size: Number(tag(m[1], 'Size') ?? 0) });
        }
        token = tag(xml, 'IsTruncated') === 'true' ? tag(xml, 'NextContinuationToken') : undefined;
      } while (token);
      return out;
    },

    async test() {
      const name = `.sandpiper-connection-test-${Date.now()}`;
      const data = Buffer.from('Sandpiper GRC connection test. Safe to delete.');
      await client.putObject(name, Readable.from([data]));
      const back = await readAll(await client.getObject(name));
      await client.deleteObject(name);
      if (!back.equals(data)) throw new S3Error(500, 'Mismatch', 'The object store returned different bytes from those stored.');
    },
  };
  return client;
}

/** Attached files in an object store, under the configured prefix. */
export function s3Storage(client: S3Client): FileStorage & { client: S3Client } {
  return {
    driver: 's3',
    client,
    async put(key, source) {
      checkStorageKey(key);
      await client.putObject(key, source);
    },
    async get(key) {
      checkStorageKey(key);
      return client.getObject(key);
    },
    async delete(key) {
      checkStorageKey(key);
      await client.deleteObject(key);
    },
    async stat(key) {
      checkStorageKey(key);
      return client.headObject(key);
    },
    async list() {
      const all = await client.listObjects('');
      return all.filter((o) => /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{32}$/.test(o.name)).map((o) => ({ key: o.name, size: o.size }));
    },
  };
}
