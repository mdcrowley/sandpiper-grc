import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors.ts';
import { loopbackBase, trustedBase } from './base.ts';

// W17-7: without `auth.public_url`, a Host header is believed only when it names this machine.
const req = (host: string | undefined, protocol = 'http') => ({ headers: { host }, protocol }) as unknown as FastifyRequest;
const settings = (value: string) => ({ get: async <T>(_key: string, _fallback: T) => value as unknown as T });

describe('application base address (W17-7)', () => {
  it('believes a Host header only when it names this machine', () => {
    expect(loopbackBase(req('localhost:8080'))).toBe('http://localhost:8080');
    expect(loopbackBase(req('127.0.0.1'))).toBe('http://127.0.0.1');
    expect(loopbackBase(req('127.1.2.3:9', 'https'))).toBe('https://127.1.2.3:9');
    expect(loopbackBase(req('[::1]:8080'))).toBe('http://[::1]:8080');
    for (const host of ['grc.example.org', 'evil.example:8080', '10.0.0.5', 'localhost.evil.example', 'localhost@evil.example', 'localhost/x', '', undefined]) {
      expect(loopbackBase(req(host))).toBeNull();
    }
  });

  it('uses the application address when set, and otherwise refuses on a reachable installation', async () => {
    expect(await trustedBase(settings('https://grc.example.org/'), req('evil.example'))).toBe('https://grc.example.org');
    expect(await trustedBase(settings(''), req('localhost:8080'))).toBe('http://localhost:8080');
    const refused = await trustedBase(settings(''), req('grc.example.org')).catch((e) => e);
    expect(refused).toBeInstanceOf(ApiError);
    expect(refused).toMatchObject({ status: 409, code: 'public_url_required' });
    expect(refused.message).toContain('auth.public_url');
  });
});
