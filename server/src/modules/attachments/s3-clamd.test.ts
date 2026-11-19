import { randomBytes } from 'node:crypto';
import type { LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clamdCommand, clamdScan, parseVersion } from './clamd.ts';
import { FAKE_MALWARE_MARKER, FAKE_SCAN_ERROR_MARKER, startFakeClamd, startFakeS3, type FakeClamd, type FakeS3 } from './fakes.ts';
import { s3Client, s3Storage, S3Error, signV4 } from './s3.ts';
import { newStorageKey } from './storage.ts';

const CRED = { accessKeyId: 'AKIDTESTONLY', secretAccessKey: 'invented-secret-for-tests-only', region: 'test-region-1', bucket: 'grc-files' };

async function readAll(r: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of r) parts.push(Buffer.from(c));
  return Buffer.concat(parts);
}

describe('Signature Version 4', () => {
  it('matches the worked example in the published S3 documentation', () => {
    // "GET Object" example from the Amazon S3 API reference (Signature Version 4, single chunk).
    const { authorization } = signV4({
      method: 'GET', path: '/test.txt', query: {},
      headers: {
        host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9',
        'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'x-amz-date': '20130524T000000Z',
      },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      region: 'us-east-1', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });
    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
      + 'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, '
      + 'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });
});

describe('object store driver', () => {
  let fake: FakeS3;
  beforeAll(async () => { fake = await startFakeS3(CRED); });
  afterAll(async () => { await fake.close(); });
  const config = () => ({ ...CRED, endpoint: fake.endpoint, pathStyle: true, prefix: 'grc/', sse: 'none' as const });

  it('stores, reads, describes, lists and deletes files with signed requests', async () => {
    const store = s3Storage(s3Client(config()));
    const key = newStorageKey();
    await store.put(key, Readable.from([Buffer.from('hello '), Buffer.from('depot')]));
    expect(fake.objects.get(`grc/${key}`)?.toString()).toBe('hello depot');
    expect((await readAll(await store.get(key))).toString()).toBe('hello depot');
    expect(await store.stat(key)).toEqual({ size: 11 });
    expect(await store.stat(newStorageKey())).toBeNull();
    fake.objects.set('grc/not-a-storage-key.txt', Buffer.from('x')); // other objects under the prefix are not files
    expect((await store.list()).map((o) => o.key)).toEqual([key]);
    await store.delete(key);
    expect(fake.objects.has(`grc/${key}`)).toBe(false);
    await store.delete(key); // already gone is fine
    await expect(store.get(key)).rejects.toThrow(/NoSuchKey/);
  });

  it('sends a large file in parts and never holds it whole', async () => {
    const store = s3Storage(s3Client(config()));
    const key = newStorageKey();
    const data = randomBytes(9 * 1024 * 1024 + 123);
    const before = fake.log.length;
    await store.put(key, Readable.from((function* () { for (let i = 0; i < data.length; i += 65536) yield data.subarray(i, i + 65536); })()));
    expect(fake.objects.get(`grc/${key}`)!.equals(data)).toBe(true);
    const calls = fake.log.slice(before).map((l) => `${l.method} ${l.url.includes('uploads') ? 'start' : l.url.includes('partNumber') ? 'part' : l.url.includes('uploadId') ? 'finish' : 'plain'}`);
    expect(calls).toEqual(['POST start', 'PUT part', 'PUT part', 'POST finish']);
  });

  it('asks for server-side encryption when configured, and pages through long listings', async () => {
    const client = s3Client({ ...config(), prefix: 'sse/', sse: 'aws:kms', kmsKeyId: 'invented-key-id' });
    const before = fake.log.length;
    for (const n of ['a', 'b', 'c']) await client.putObject(n, Readable.from([Buffer.from(n)]));
    const put = fake.log[before];
    expect(put.headers['x-amz-server-side-encryption']).toBe('aws:kms');
    expect(put.headers['x-amz-server-side-encryption-aws-kms-key-id']).toBe('invented-key-id');
    fake.listPage = 2;
    try {
      expect((await client.listObjects('')).map((o) => o.name)).toEqual(['a', 'b', 'c']);
    } finally {
      fake.listPage = 1000;
    }
  });

  it('is refused with the wrong secret', async () => {
    const client = s3Client({ ...config(), secretAccessKey: 'not-the-secret' });
    const err = await client.putObject('x', Readable.from([Buffer.from('x')])).catch((e) => e);
    expect(err).toBeInstanceOf(S3Error);
    expect(err.code).toBe('SignatureDoesNotMatch');
    await expect(client.test()).rejects.toThrow(/SignatureDoesNotMatch/);
  });

  it('addresses the bucket as a host name when path-style is off', async () => {
    const lookup = ((_host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
      (opts?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4))) as unknown as LookupFunction;
    const client = s3Client({ ...config(), endpoint: `http://store.example.invalid:${fake.port}`, pathStyle: false, prefix: '', lookup });
    const before = fake.log.length;
    await client.test();
    expect(fake.log[before].headers.host).toBe(`${CRED.bucket}.store.example.invalid:${fake.port}`);
    expect(fake.log[before].url.startsWith('/.sandpiper-connection-test-')).toBe(true);
  });
});

describe('ClamAV client', () => {
  let clamd: FakeClamd;
  beforeAll(async () => { clamd = await startFakeClamd({ streamMaxBytes: 300_000 }); });
  afterAll(async () => { await clamd.close(); });
  const cfg = () => ({ host: '127.0.0.1', port: clamd.port, timeoutMs: 5000, maxBytes: 10 * 1024 * 1024 });
  const scan = (text: string | Buffer) => clamdScan(cfg(), Readable.from([Buffer.isBuffer(text) ? text : Buffer.from(text)]));

  it('streams the file and reports clean, infected and errors', async () => {
    expect(await scan('an ordinary timetable')).toEqual({ verdict: 'clean' });
    expect(clamd.scanned.at(-1)!.toString()).toBe('an ordinary timetable');
    expect(await scan(`prefix ${FAKE_MALWARE_MARKER} suffix`)).toEqual({ verdict: 'infected', detail: 'Sandpiper.Test.Marker' });
    expect(await scan(FAKE_SCAN_ERROR_MARKER)).toMatchObject({ verdict: 'error', detail: expect.stringContaining("Can't allocate memory") });
    const big = Buffer.alloc(200_000, 0x41);
    expect(await scan(big)).toEqual({ verdict: 'clean' });
    expect(clamd.scanned.at(-1)!.length).toBe(200_000); // sent in several chunks, all arrived
  });

  it('reports the daemon\'s own size limit and our limit as errors', async () => {
    expect(await scan(Buffer.alloc(400_000, 0x42))).toMatchObject({ verdict: 'error', detail: expect.stringContaining('size limit exceeded') });
    expect(await clamdScan({ ...cfg(), maxBytes: 1000 }, Readable.from([Buffer.alloc(5000)]), 5000)).toMatchObject({ verdict: 'error', detail: expect.stringContaining('scanning limit') });
  });

  it('gives its version and signature date, and says plainly when it cannot be reached', async () => {
    const v = parseVersion(await clamdCommand(cfg(), 'VERSION'));
    expect(v).toMatchObject({ engine: 'ClamAV 1.4.1', signatures: '27470' });
    expect(v.signatureDate).toMatch(/^2026-11-17T/);
    const closed = await startFakeClamd();
    const port = closed.port;
    await closed.close();
    expect(await clamdScan({ ...cfg(), port }, Readable.from([Buffer.from('x')]))).toMatchObject({ verdict: 'error', detail: expect.stringMatching(/^unavailable: cannot reach/) });
  });
});
