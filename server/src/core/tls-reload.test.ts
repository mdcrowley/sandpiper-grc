import { X509Certificate } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:tls';
import { afterAll, describe, expect, it } from 'vitest';
import { tlsReloadSeconds, watchTlsFiles, type TlsReloadResult } from './http.ts';
import { makeSelfSigned } from './tls-selfsigned.ts';

const scratch = mkdtempSync(join(tmpdir(), 'grc-tls-reload-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** The fingerprint of the certificate a new connection is given. */
function served(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port, rejectUnauthorized: false, servername: 'localhost' }, () => {
      const cert = socket.getPeerX509Certificate();
      socket.end();
      resolve(cert!.fingerprint256);
    });
    socket.on('error', reject);
  });
}

describe('reloading the TLS certificate (E16-33)', () => {
  it('reads the reload interval', () => {
    expect(tlsReloadSeconds({})).toBe(60);
    expect(tlsReloadSeconds({ GRC_TLS_RELOAD_SECONDS: '0' })).toBe(0);
    expect(() => tlsReloadSeconds({ GRC_TLS_RELOAD_SECONDS: 'soon' })).toThrow(/GRC_TLS_RELOAD_SECONDS/);
  });

  it('serves a renewed certificate to new connections, and keeps the old one when the new pair is broken', async () => {
    const certPath = join(scratch, 'cert.pem');
    const keyPath = join(scratch, 'key.pem');
    const first = makeSelfSigned(['localhost'], 10);
    writeFileSync(certPath, first.cert);
    writeFileSync(keyPath, first.key);
    const server = createServer({ cert: first.cert, key: first.key }, (_req, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const results: TlsReloadResult[] = [];
    const reloader = watchTlsFiles(server, { certPath, keyPath, cert: Buffer.from(first.cert), key: Buffer.from(first.key) }, { intervalMs: 0, onResult: (r) => results.push(r) });
    try {
      const fp1 = new X509Certificate(first.cert).fingerprint256;
      expect(await served(port)).toBe(fp1);
      expect(reloader.check()).toBeNull(); // nothing changed

      // Renewed: the new pair is used for new connections.
      const second = makeSelfSigned(['localhost'], 20);
      writeFileSync(certPath, second.cert);
      writeFileSync(keyPath, second.key);
      expect(reloader.check()).toMatchObject({ ok: true, message: expect.stringMatching(/reloaded: .*CN=localhost, valid until/) });
      const fp2 = new X509Certificate(second.cert).fingerprint256;
      expect(await served(port)).toBe(fp2);

      // Half-written renewal (new certificate, old key): refused, the second stays in use.
      const third = makeSelfSigned(['localhost'], 30);
      writeFileSync(certPath, third.cert);
      expect(reloader.check()).toMatchObject({ ok: false, message: expect.stringMatching(/NOT loaded/) });
      expect(await served(port)).toBe(fp2);
      // ...until the key arrives too.
      writeFileSync(keyPath, third.key);
      expect(reloader.check()?.ok).toBe(true);
      expect(await served(port)).toBe(new X509Certificate(third.cert).fingerprint256);

      // Not PEM at all.
      writeFileSync(certPath, 'garbage');
      expect(reloader.check()?.ok).toBe(false);
      expect(await served(port)).toBe(new X509Certificate(third.cert).fingerprint256);

      // A missing file is reported once, not at every look.
      rmSync(certPath);
      expect(reloader.check()?.message).toMatch(/Cannot read/);
      expect(reloader.check()).toBeNull();
      expect(results.filter((r) => !r.ok)).toHaveLength(3);
    } finally {
      reloader.stop();
      await new Promise((r) => server.close(r));
    }
  });
});
