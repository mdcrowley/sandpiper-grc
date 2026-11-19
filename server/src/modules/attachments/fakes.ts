// Stand-ins for a ClamAV daemon and an S3-compatible object store, for tests only (they listen
// on 127.0.0.1, on a port the system chooses). The module never imports this file.
//
// The fake store checks every request's Signature Version 4 itself, with its own code (it
// shares nothing with s3.ts), so a signing mistake in the driver fails the tests.
import { createHash, createHmac, randomUUID } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

/** Content containing this is reported infected by the fake scanner (an invented marker, not a real signature). */
export const FAKE_MALWARE_MARKER = 'SANDPIPER-TEST-MALWARE-MARKER';
/** Content containing this makes the fake scanner answer with an error. */
export const FAKE_SCAN_ERROR_MARKER = 'SANDPIPER-TEST-SCANNER-ERROR';

export interface FakeClamd {
  port: number;
  /** Bytes scanned per INSTREAM request, in order. */
  scanned: Buffer[];
  close(): Promise<void>;
}

export async function startFakeClamd(opts: { streamMaxBytes?: number } = {}): Promise<FakeClamd> {
  const scanned: Buffer[] = [];
  const max = opts.streamMaxBytes ?? 25 * 1024 * 1024;
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let buf = Buffer.alloc(0);
    let mode: 'command' | 'stream' = 'command';
    const body: Buffer[] = [];
    let size = 0;
    socket.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (mode === 'command') {
        const end = buf.indexOf(0);
        if (end < 0) return;
        const cmd = buf.subarray(0, end).toString('latin1');
        buf = buf.subarray(end + 1);
        if (cmd === 'zPING') { socket.end('PONG\0'); return; }
        if (cmd === 'zVERSION') { socket.end('ClamAV 1.4.1/27470/Tue Nov 17 08:00:00 2026\0'); return; }
        if (cmd !== 'zINSTREAM') { socket.end('UNKNOWN COMMAND\0'); return; }
        mode = 'stream';
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          const all = Buffer.concat(body);
          scanned.push(all);
          const text = all.toString('latin1');
          if (text.includes(FAKE_MALWARE_MARKER)) socket.end('stream: Sandpiper.Test.Marker FOUND\0');
          else if (text.includes(FAKE_SCAN_ERROR_MARKER)) socket.end("stream: Can't allocate memory ERROR\0");
          else socket.end('stream: OK\0');
          return;
        }
        if (buf.length < 4 + len) return;
        body.push(Buffer.from(buf.subarray(4, 4 + len)));
        size += len;
        buf = buf.subarray(4 + len);
        if (size > max) { socket.end('INSTREAM size limit exceeded. ERROR\0'); return; }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    scanned,
    close: () => new Promise((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }),
  };
}

// ---------------------------------------------------------------- object store

export interface FakeS3 {
  endpoint: string;
  port: number;
  bucket: string;
  objects: Map<string, Buffer>;
  /** Every request as received: method, path, headers. */
  log: { method: string; url: string; headers: IncomingMessage['headers'] }[];
  /** Objects per page of a listing (to exercise continuation). */
  listPage: number;
  close(): Promise<void>;
}

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function startFakeS3(opts: { accessKeyId: string; secretAccessKey: string; region: string; bucket: string }): Promise<FakeS3> {
  const objects = new Map<string, Buffer>();
  const uploads = new Map<string, Map<number, Buffer>>();
  const log: FakeS3['log'] = [];

  const error = (res: ServerResponse, status: number, code: string, message: string) => {
    res.writeHead(status, { 'content-type': 'application/xml' });
    res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${xmlEsc(message)}</Message></Error>`);
  };

  function verify(req: IncomingMessage, body: Buffer): string | null {
    const auth = String(req.headers.authorization ?? '');
    const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/.exec(auth);
    if (!m) return 'malformed Authorization header';
    const [, akid, date, region, signed, signature] = m;
    if (akid !== opts.accessKeyId) return 'unknown access key';
    if (region !== opts.region) return 'wrong region';
    const amzDate = String(req.headers['x-amz-date'] ?? '');
    if (!amzDate.startsWith(date)) return 'date mismatch';
    const when = Date.parse(`${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`);
    if (!Number.isFinite(when) || Math.abs(Date.now() - when) > 15 * 60_000) return 'request time too skewed';
    const payload = String(req.headers['x-amz-content-sha256'] ?? '');
    if (payload !== createHash('sha256').update(body).digest('hex')) return 'payload hash does not match the body';
    const names = signed.split(';');
    if (!names.includes('host') || !names.includes('x-amz-date') || !names.includes('x-amz-content-sha256')) return 'required headers not signed';
    const [rawPath, rawQuery = ''] = (req.url ?? '/').split('?');
    const query = rawQuery ? rawQuery.split('&').map((p) => {
      const i = p.indexOf('=');
      const k = decodeURIComponent(i < 0 ? p : p.slice(0, i));
      const v = i < 0 ? '' : decodeURIComponent(p.slice(i + 1));
      return `${enc(k)}=${enc(v)}`;
    }).sort().join('&') : '';
    const headerLines = names.map((n) => `${n}:${String(req.headers[n] ?? '').trim().replace(/\s+/g, ' ')}\n`).join('');
    const canonical = `${req.method}\n${rawPath}\n${query}\n${headerLines}\n${signed}\n${payload}`;
    const scope = `${date}/${region}/s3/aws4_request`;
    const toSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${createHash('sha256').update(canonical).digest('hex')}`;
    let k: Buffer = createHmac('sha256', `AWS4${opts.secretAccessKey}`).update(date).digest();
    for (const part of [region, 's3', 'aws4_request']) k = createHmac('sha256', k).update(part).digest();
    const expected = createHmac('sha256', k).update(toSign).digest('hex');
    return expected === signature ? null : 'signature does not match';
  }

  const fake: FakeS3 = {
    endpoint: '', port: 0, bucket: opts.bucket, objects, log, listPage: 1000,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };

  const server = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      const body = Buffer.concat(parts);
      log.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers });
      const problem = verify(req, body);
      if (problem) return error(res, 403, 'SignatureDoesNotMatch', problem);

      const url = new URL(req.url ?? '/', 'http://fake');
      const host = String(req.headers.host ?? '');
      let segments = url.pathname.split('/').slice(1).map(decodeURIComponent);
      let bucket: string;
      if (host.startsWith(`${opts.bucket}.`)) bucket = opts.bucket; // virtual-hosted
      else { bucket = segments[0] ?? ''; segments = segments.slice(1); }
      if (bucket !== opts.bucket) return error(res, 404, 'NoSuchBucket', 'The specified bucket does not exist');
      const key = segments.join('/');
      const q = url.searchParams;

      if (!key && req.method === 'GET' && q.get('list-type') === '2') {
        const prefix = q.get('prefix') ?? '';
        const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
        const start = Number(q.get('continuation-token') ?? 0);
        const page = all.slice(start, start + fake.listPage);
        const more = start + fake.listPage < all.length;
        res.writeHead(200, { 'content-type': 'application/xml' });
        return res.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><Prefix>${xmlEsc(prefix)}</Prefix>`
          + page.map((k) => `<Contents><Key>${xmlEsc(k)}</Key><Size>${objects.get(k)!.length}</Size></Contents>`).join('')
          + `<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + fake.listPage}</NextContinuationToken>` : ''}</ListBucketResult>`);
      }
      if (!key) return error(res, 400, 'InvalidRequest', 'No key');

      if (req.method === 'POST' && q.has('uploads')) {
        const id = randomUUID();
        uploads.set(id, new Map());
        res.writeHead(200, { 'content-type': 'application/xml' });
        return res.end(`<InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${xmlEsc(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
      }
      if (req.method === 'PUT' && q.has('uploadId')) {
        const up = uploads.get(q.get('uploadId')!);
        if (!up) return error(res, 404, 'NoSuchUpload', 'No such upload');
        up.set(Number(q.get('partNumber')), body);
        res.writeHead(200, { etag: `"${createHash('md5').update(body).digest('hex')}"` });
        return res.end();
      }
      if (req.method === 'POST' && q.has('uploadId')) {
        const up = uploads.get(q.get('uploadId')!);
        if (!up) return error(res, 404, 'NoSuchUpload', 'No such upload');
        const numbers = [...body.toString('utf8').matchAll(/<PartNumber>(\d+)<\/PartNumber>/g)].map((x) => Number(x[1]));
        objects.set(key, Buffer.concat(numbers.map((n) => up.get(n)!)));
        uploads.delete(q.get('uploadId')!);
        res.writeHead(200, { 'content-type': 'application/xml' });
        return res.end(`<CompleteMultipartUploadResult><Key>${xmlEsc(key)}</Key></CompleteMultipartUploadResult>`);
      }
      if (req.method === 'DELETE' && q.has('uploadId')) {
        uploads.delete(q.get('uploadId')!);
        res.writeHead(204);
        return res.end();
      }
      if (req.method === 'PUT') {
        objects.set(key, body);
        res.writeHead(200, { etag: '"x"' });
        return res.end();
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        const data = objects.get(key);
        if (!data) return error(res, 404, 'NoSuchKey', 'The specified key does not exist.');
        res.writeHead(200, { 'content-length': data.length, 'content-type': 'application/octet-stream' });
        return res.end(req.method === 'GET' ? data : undefined);
      }
      if (req.method === 'DELETE') {
        objects.delete(key);
        res.writeHead(204);
        return res.end();
      }
      return error(res, 405, 'MethodNotAllowed', 'Not supported by the fake');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.port = (server.address() as AddressInfo).port;
  fake.endpoint = `http://127.0.0.1:${fake.port}`;
  return fake;
}
